/**
 * The shop assistant, framework-side — an agentfootprint Agent that drives the
 * app entirely OVER MCP. Its app-facing tools are the fixed set served by
 * hcifootprint's MCP server (one tool per skill + whats_here / do_action),
 * reached through an MCP `Client` (see agent-layer/mcp-bridge.ts). What is
 * fireable RIGHT NOW arrives inside each tool result (readySteps); the model
 * acts by calling the same skill tool again with {step}. The tool array never
 * changes, so the prompt cache stays warm — and because it's real MCP, any MCP
 * host (LangGraph, Claude Desktop, …) could drive the same session identically.
 *
 * agentfootprint here is just the host running the loop; report_gap / explain
 * are two demo-side helpers that read the session directly for telemetry.
 *
 * A turn returns one of two things:
 *   { type: 'reply',   text }              — the agent finished
 *   { type: 'confirm', question, ... }     — the run PAUSED for approval; call
 *                                            assistant.confirm(approved) to resume
 */
import { Agent, askHuman, defineTool, isPaused } from 'agentfootprint';
import { anthropic, type LLMProvider } from 'agentfootprint/llm-providers';
import { agentThinkingTrace } from 'agentfootprint/observe';
import type { AttTrace } from 'agentfootprint/observe';
import { toolChoiceRecorder } from 'agentfootprint/observe';
import type { ToolChoiceRecorderHandle } from 'agentfootprint/observe';
import type { Embedder } from 'agentfootprint/memory';
import { explainChoice, snippetUnits, type AttributionUnit, type ChoiceExplanation } from 'agentfootprint/debug';
import type { Session } from 'hcifootprint';
import type { AppMcp } from '../agent-layer/mcp-bridge.js';

const MODEL = process.env['ANTHROPIC_MODEL'] ?? 'claude-opus-4-8';

const SYSTEM = `You are the shopping assistant for a small dress store, acting on the LIVE app.
Your tools are FIXED: one tool per skill, plus whats_here and do_action.
Work method, every turn:
1. Call whats_here first — it tells you where the user is, what happened since your last look,
   and which actions and skills exist right now.
2. For a multi-step task, call its skill tool with NO arguments to open it: the result lists
   readySteps (what is fireable right now, with expected inputs). Act by calling the SAME skill
   tool again with {step, input}. Steps are data in results — never separate tools.
3. When a step returns a "data" field (e.g. search results), READ it as data: it lists the items
   you can act on next, with their ids. Use those ids to fill the next step's input (e.g. take a
   dressId from the search results before calling view-dress). Never invent an id.
4. One-off actions outside a flow go through do_action({action, input}).
4. High-effect steps come back as judgment "needs-confirm". You must then call
   request_confirmation — the user answers directly — and only after approval call the skill
   tool again with confirm: true. Never pass confirm: true without an approval.
5. If a result is rejected (guard failed, wrong page), read its reason and evidence and replan;
   never retry blindly. A "STILL_MOUNTING" rejection is retriable.
6. If NO action or skill can serve the request, call report_gap with the user's ask BEFORE
   telling them you can't help — that is how the team learns what to build next.
Keep replies short and grounded in what actually happened (tool results), never in intentions.`;

/**
 * Split the system prompt into its numbered rules as attribution units — the
 * input to agentfootprint's `attributeChoice`. A "procedural pick" (e.g.
 * whats_here) is caused by one of THESE rules, not by the user's task, so the
 * debugger attributes each pick to the rule that best explains it.
 *
 * Parsed by ORDER (labelled rule-1, rule-2, …), not by the printed number, so
 * the prompt's two "4." lines stay two distinct units. Continuation lines
 * (indented) fold into the current rule; the first un-numbered, un-indented
 * line (the "Keep replies short…" tail) ends the list.
 */
export function systemRuleUnits(system: string = SYSTEM): AttributionUnit[] {
  const rules: string[] = [];
  let current: string | null = null;
  for (const line of system.split('\n')) {
    const numbered = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (numbered) {
      if (current !== null) rules.push(current.trim());
      current = numbered[1];
    } else if (current !== null && /^\s+\S/.test(line)) {
      current += ' ' + line.trim(); // indented continuation of the current rule
    } else if (current !== null) {
      rules.push(current.trim()); // an un-indented, un-numbered line ends the rules
      current = null;
    }
  }
  if (current !== null) rules.push(current.trim());
  return rules.map((text, i) => ({ id: `rule-${i + 1}`, channel: 'system', text }));
}

/** The dress-shop system prompt's rules, parsed once for choice attribution. */
const RULE_UNITS = systemRuleUnits();

/** One channel meter of the Why panel's verdict card (atui types/trace.d.ts — WhyChannel). */
export interface WhyChannel {
  id: string;
  label: string;
  share: number;
  quote?: string;
  citeLabel?: string;
}

/** What gets stamped on an ask step (atui types/trace.d.ts — WhyAttribution).
 *  `headline` is deliberately absent: with `channels` present, atui leads with
 *  the verdict card, which supersedes it. */
export interface WhyAttribution {
  rows: { label: string; score: number; quote?: string; picked?: boolean; channel?: string }[];
  channels: WhyChannel[];
  note: string;
}

/** Plain display label per channel — atui falls back to raw ids without these. */
const CHANNEL_LABELS: Record<string, string> = {
  system: 'The rules',
  task: 'Your request',
  data: 'Earlier results',
};

/** How the winning channel reads in the note's plain sentence. */
const CHANNEL_IN_A_SENTENCE: Record<string, string> = {
  system: "the agent's own rules",
  task: 'your request',
  data: 'data returned by an earlier step',
};

/** rule-3 → 'Rule 3', task → 'your request', data-2 → 'result 2'; else the raw id. */
function unitLabel(id: string): string {
  if (id === 'task') return 'your request';
  const rule = /^rule-(\d+)$/.exec(id);
  if (rule) return `Rule ${rule[1]}`;
  const data = /^data-(\d+)$/.exec(id);
  if (data) return `result ${data[1]}`;
  return id;
}

/** Short citation label for a channel's top unit ('Rule 3' / 'your request' / …). */
function channelCiteLabel(channel: string, unitId: string): string | undefined {
  if (channel === 'system') return unitLabel(unitId);
  if (channel === 'task') return 'your request';
  if (channel === 'data') return 'a result from the previous step';
  return undefined;
}

/**
 * Map agentfootprint's `explainChoice` verdict into atui's WhyAttribution shape:
 * one labelled meter per channel (winner first — the sort is upstream's), the
 * ranked units as rows (capped at 8), and one plain sentence naming the winner.
 * Pure — unit-tested directly in test/attribution.test.ts.
 */
export function toWhyAttribution(explanation: ChoiceExplanation): WhyAttribution {
  const channels: WhyChannel[] = explanation.channels.map((c) => {
    const channel: WhyChannel = {
      id: c.channel,
      label: CHANNEL_LABELS[c.channel] ?? c.channel,
      share: c.share,
    };
    if (c.top) {
      channel.quote = c.top.text;
      const cite = channelCiteLabel(c.channel, c.top.id);
      if (cite !== undefined) channel.citeLabel = cite;
    }
    return channel;
  });
  const rows = explanation.units.slice(0, 8).map((u) => ({
    label: unitLabel(u.id),
    score: u.score,
    quote: u.text,
    picked: u.id === explanation.top.id,
    channel: u.channel,
  }));
  const winner = explanation.channels[0]?.channel ?? '';
  const note = `Best explanation: ${CHANNEL_IN_A_SENTENCE[winner] ?? winner}. (similarity estimate — not a mind-read)`;
  return { channels, rows, note };
}

/**
 * Cut a tool description down to what DISTINGUISHES the tool. The MCP bridge
 * appends the SAME how-to-call suffix to every tool ("Call with no arguments
 * to open this skill…") — constant boilerplate across all tools adds zero
 * discrimination (same argument as excluding the constant system prompt from
 * margin scoring), and its procedural vocabulary drags every pick toward the
 * rules channel. Descriptions without the marker pass through unchanged.
 * Pure — unit-tested directly in test/attribution.test.ts.
 */
export function descriptionEssence(description: string): string {
  const marker = description.indexOf('Call with no arguments');
  if (marker === -1) return description;
  return description.slice(0, marker).replace(/[\s.,;:—–-]+$/, '');
}

/**
 * Unwrap the MCP bridge's result envelope before cutting data units. Tool
 * outputs arrive as `{ value: "<pretty-printed JSON string>" }` — cutting that
 * raw JSON text yields brace-noise lines, not citable rows. If `value` is a
 * string that parses as JSON, return the parsed value (so snippetUnits sees
 * real rows like `id: d3, name: …, price: …`); a non-JSON string passes
 * through as the string; anything else is returned unchanged.
 * Pure — unit-tested directly in test/attribution.test.ts.
 */
export function unwrapResult(output: unknown): unknown {
  if (typeof output === 'object' && output !== null && 'value' in output) {
    const value = (output as { value: unknown }).value;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          return JSON.parse(trimmed);
        } catch {
          return value; // looked like JSON but wasn't — quote the string itself
        }
      }
      return value;
    }
  }
  return output;
}

export interface ConfirmQuestion {
  affordanceId: string;
  summary: string;
}

export type TurnResult =
  | { type: 'reply'; text: string }
  | { type: 'confirm'; question: ConfirmQuestion };

export interface AssistantOptions {
  /**
   * Live progress: called with a short human-readable status BEFORE each tool
   * runs ("Searching the catalog…", "Placing the order…"). The web front-end
   * polls these so the user sees what the agent is doing, not just "thinking".
   */
  onActivity?: (status: string) => void;
  /**
   * Optional embedding model for SEMANTIC tool-choice scoring. When present, the
   * assistant attaches agentfootprint's toolChoiceRecorder and stamps each tool's
   * margin score onto the trace (real ranked bars in the debugger). When null,
   * scoring stays off — the debugger shows "Semantic score: off". Never faked.
   */
  embedder?: Embedder | null;
  /**
   * Inject the LLM provider instead of the default `anthropic({...})`. The
   * benchmark harness (bench/) passes a token-counting wrapper so it can meter
   * the exact input/output tokens per call — the same instrument it hands the
   * DOM baseline, so both modalities are measured identically. Omit in normal
   * use to keep the shipped Anthropic behavior (generous timeout + retries).
   */
  provider?: LLMProvider;
  /**
   * Override the ReAct iteration cap (default 16). The benchmark sets this from
   * its per-run turn cap so both modalities run under the identical bound.
   */
  maxIterations?: number;
}

export interface Assistant {
  /** Send a user message. Resolves to a reply, or a pause awaiting confirmation. */
  send(userMessage: string): Promise<TurnResult>;
  /** Answer a pending confirmation; resolves to a reply, or another pause. */
  confirm(approved: boolean, answerText?: string): Promise<TurnResult>;
  /** True while a confirmation is outstanding. */
  readonly awaitingConfirmation: boolean;
  /**
   * The current turn's reasoning as an AgentThinkingUI trace (prompt → ask →
   * return → answer beats). Grows live during a run — the /debug page polls it.
   * Async because, with a semantic embedder, it enriches tools with real
   * choice-margin scores (embedded lazily) before returning.
   */
  trace(): Promise<AttTrace>;
}

/** Shopper-friendly status per action id — what the agent is doing, in plain words. */
const PRETTY: Record<string, string> = {
  'browse-dresses': 'Opening the catalog…',
  'search-dresses': 'Searching the catalog…',
  'filter-by-color': 'Filtering by color…',
  'view-dress': 'Opening a dress…',
  'add-to-cart': 'Adding to the cart…',
  'go-to-cart': 'Opening the cart…',
  'proceed-to-checkout': 'Going to checkout…',
  'place-order': 'Placing the order…',
  'view-orders': 'Opening your orders…',
  'check-order-status': 'Checking your order…',
};

function activityLabel(kind: { type: 'skill'; id: string } | { type: 'whats_here' } | { type: 'do_action' }, step: string | undefined): string {
  const leaf = step?.split('.').pop(); // steps are qualified paths ('catalog.search-dresses')
  if (leaf && PRETTY[leaf]) return PRETTY[leaf];
  if (kind.type === 'whats_here') return 'Looking around the shop…';
  if (kind.type === 'skill' && !step) return `Planning: ${kind.id.replace(/-/g, ' ')}…`;
  if (leaf) return `Working on ${leaf.replace(/-/g, ' ')}…`;
  return 'Working…';
}

/** Anthropic tool names allow [a-zA-Z0-9_-] only — map the port's dotted MCP names. */
const apiName = (portName: string) => portName.replace(/^dress-shop\./, '').replace(/[^a-zA-Z0-9_-]/g, '_');

export function createAssistant(session: Session, appMcp: AppMcp, options?: AssistantOptions): Assistant {
  const emit = (status: string) => options?.onActivity?.(status);
  // The HARD human-in-the-loop gate. The MCP server stops high-effect steps at
  // needs-confirm; this set is what an APPROVAL (and only an approval) unlocks —
  // the model saying confirm:true on its own is bounced back.
  const approvals = new Set<string>();
  const transcript: string[] = [];
  let pausedCheckpoint: unknown = null;
  let pausedAffordanceId: string | null = null;
  let lastTask = '';

  // Captures each run's reasoning as an AgentThinkingUI trace — attached to the
  // agent below via .recorder(). It maps agentfootprint's emit stream (llm/tool/
  // thinking beats) straight into atui's Trace shape; no adapter needed.
  const think = agentThinkingTrace({ agent: 'Maison Stylist', model: MODEL, asker: 'you' });
  // SEMANTIC tool-choice scoring — only when an embedder is configured. Ranks
  // the offered catalog against the choice context via influence-core scoreMargin
  // (embedding cosine), lazily on read. Null embedder ⇒ no scorer ⇒ proxy stays.
  const choice: ToolChoiceRecorderHandle | null = options?.embedder
    ? toolChoiceRecorder({ embedder: options.embedder })
    : null;
  // The same embedder also drives per-pick ATTRIBUTION (agentfootprint's
  // explainChoice): which context channel — a system-prompt rule, the task,
  // or data an earlier tool returned — best explains each pick. This is what
  // recovers PROCEDURAL picks (whats_here ← "call whats_here first") that
  // semantic scoring — which never sees the system prompt — cannot.
  const attributionEmbedder: Embedder | null = options?.embedder ?? null;

  // The app-facing tools come straight from the MCP server's tools/list.
  const mcpNameByApiName = new Map<string, string>();

  const modeBTools = appMcp.tools.map((tool) => {
    const name = apiName(tool.name);
    mcpNameByApiName.set(name, tool.name);
    const kind: { type: 'skill'; id: string } | { type: 'whats_here' } | { type: 'do_action' } =
      tool.name.includes('.skill.')
        ? { type: 'skill', id: tool.name.split('.skill.')[1] }
        : tool.name.endsWith('.whats_here')
          ? { type: 'whats_here' }
          : { type: 'do_action' };
    return defineTool({
      name,
      description: tool.description ?? '',
      inputSchema: tool.inputSchema,
      execute: async (args: { step?: string; action?: string; confirm?: boolean } & Record<string, unknown>) => {
        const stepKey = args.step ?? args.action;
        emit(activityLabel(kind, stepKey));
        if (args.confirm === true && stepKey !== undefined && !approvals.has(stepKey)) {
          return JSON.stringify({
            ok: false,
            judgment: 'needs-confirm',
            hint: 'Only the user can approve a high-effect step: call request_confirmation first.',
          });
        }
        // The call goes over MCP; the result already carries any produced data
        // (search results) — the server folds it in before replying.
        const result = await appMcp.call(mcpNameByApiName.get(name)!, args);
        if (result['ok'] === true && args.confirm === true && stepKey !== undefined) {
          approvals.delete(stepKey); // one approval = one fire
        }
        return JSON.stringify(result, null, 1);
      },
    });
  });

  const tools = [
    ...modeBTools,
    defineTool({
      name: 'request_confirmation',
      description:
        'REQUIRED for any needs-confirm step: pauses this run and asks the user directly. ' +
        "Their answer comes back as this tool's result; on approval, retry the step with confirm: true.",
      inputSchema: {
        type: 'object',
        properties: {
          affordanceId: { type: 'string', description: 'The step (or action) name awaiting approval.' },
          summary: { type: 'string', description: 'One sentence: what will happen if approved.' },
        },
        required: ['affordanceId', 'summary'],
      },
      execute: async (args: { affordanceId: string; summary: string }) => {
        emit('Waiting for your approval…');
        askHuman({ affordanceId: args.affordanceId, summary: args.summary });
        return ''; // unreachable — askHuman always pauses
      },
    }),
    defineTool({
      name: 'report_gap',
      description:
        "When NO available action or skill can serve the user's request, record the unmet ask " +
        'so the team learns which capability to build next. Call this BEFORE apologizing.',
      inputSchema: {
        type: 'object',
        properties: {
          request: { type: 'string', description: "The user's ask, in their words." },
          reason: { type: 'string', enum: ['no-skill-matched', 'guard-blocked', 'needs-backend-data', 'other'] },
        },
        required: ['request'],
      },
      execute: async (args: { request: string; reason?: 'no-skill-matched' | 'guard-blocked' | 'needs-backend-data' | 'other' }) => {
        emit('Noting something we can’t do yet…');
        session.reportGap({ request: args.request, reason: args.reason, principal: 'agent' });
        return JSON.stringify({ recorded: true }); // minimal ack — never echo the ask back
      },
    }),
    defineTool({
      name: 'explain',
      description: 'Why does a state key have its value — the causal chain of recorded actions.',
      inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
      execute: async (args: { key: string }) => session.why(args.key),
    }),
  ];

  let agentBuilder = Agent.create({
    // A full buy-it-for-me flow is a long chain of Opus turns; each is a
    // non-streaming call. Give it a generous timeout + retries so one slow
    // turn (or a transient network stall) doesn't surface as "Request timed
    // out" — it retries instead. The benchmark can inject its own provider.
    provider: options?.provider ?? anthropic({ defaultModel: MODEL, timeout: 120_000, maxRetries: 3 }),
    name: 'dress-shop-assistant',
    model: 'anthropic',
  })
    .system(SYSTEM)
    .maxIterations(options?.maxIterations ?? 16)
    .recorder(think);
  if (choice) agentBuilder = agentBuilder.recorder(choice);
  for (const tool of tools) agentBuilder = agentBuilder.tool(tool);
  const agent = agentBuilder.build();

  const settle = (result: Awaited<ReturnType<typeof agent.run>>): TurnResult => {
    if (isPaused(result)) {
      const question = result.pauseData as ConfirmQuestion;
      pausedCheckpoint = result.checkpoint;
      pausedAffordanceId = question.affordanceId;
      return { type: 'confirm', question };
    }
    pausedCheckpoint = null;
    pausedAffordanceId = null;
    transcript.push(`Assistant: ${String(result).slice(0, 300)}`);
    return { type: 'reply', text: String(result) };
  };

  return {
    get awaitingConfirmation() {
      return pausedCheckpoint !== null;
    },
    async trace(): Promise<AttTrace> {
      const built = think.getTrace({ task: lastTask });
      if (!choice) return built;
      try {
        // Enrich each tool the model saw with its REAL choice-margin score, so
        // atui renders ranked bars (it uses `relevance` verbatim, skipping the
        // proxy). Match a scored call to the ask step that chose the same tool.
        const calls = await choice.getCalls();
        const used = new Set<string>();
        for (const raw of built.steps) {
          const step = raw as { kind: string; tool?: string; toolsSeen?: { name: string; relevance?: number }[] };
          if (step.kind !== 'ask' || !step.toolsSeen || !step.tool) continue;
          const stepTool = step.tool;
          const call = calls.find((c) => c.margin && !used.has(c.runtimeStageId) && c.margin.chosen.includes(stepTool));
          if (!call || !call.margin) continue;
          used.add(call.runtimeStageId);
          const byName = new Map(call.margin.scores.map((s) => [s.name, s.score]));
          for (const seen of step.toolsSeen) {
            const score = byName.get(seen.name);
            if (typeof score === 'number') seen.relevance = score;
          }
        }
      } catch {
        /* semantic scoring is best-effort — fall back to the lexical proxy */
      }

      // Per-pick ATTRIBUTION — for each pick, which context CHANNEL best
      // explains it: the system rules (procedural — whats_here ← "call
      // whats_here first"), the user's task, or DATA an earlier tool returned
      // ("open dress d42" ← the search result that listed d42). Stamped in
      // atui's WhyAttribution shape; the Why panel renders the verdict card.
      if (attributionEmbedder) {
        for (let i = 0; i < built.steps.length; i++) {
          const step = built.steps[i] as {
            kind: string;
            tool?: string;
            input?: Record<string, unknown>;
            toolsSeen?: { name: string; description?: string }[];
            attribution?: unknown;
          };
          if (step.kind !== 'ask' || !step.tool || !step.toolsSeen) continue;
          const chosen = step.toolsSeen.find((t) => t.name === step.tool);
          if (!chosen) continue;
          // The pick the model made is tool + ARGUMENTS — the arguments are
          // where the data echo lives ("view-dress with dressId d3" cites the
          // search result that returned d3). Boilerplate the bridge appends to
          // every description is cut first: constant text across all tools
          // adds zero discrimination and drags every pick toward the rules.
          const essence = chosen.description ? descriptionEssence(chosen.description) : '';
          const inputJson =
            step.input && Object.keys(step.input).length > 0 ? ` — called with ${JSON.stringify(step.input).slice(0, 200)}` : '';
          const toolText = `${chosen.name}${essence ? `: ${essence}` : ''}${inputJson}`;
          try {
            // The data channel: what the model had just read — the nearest tool
            // result BEFORE this ask. The first ask has no prior return, so its
            // verdict simply carries no data units.
            let dataUnits: AttributionUnit[] = [];
            for (let j = i - 1; j >= 0; j--) {
              const prev = built.steps[j] as { kind: string; output?: unknown };
              if (prev.kind === 'return') {
                // The bridge wraps results as { value: "<JSON string>" } —
                // unwrap so the cutter sees real rows, not raw JSON text lines.
                dataUnits = snippetUnits(unwrapResult(prev.output), { max: 10 });
                break;
              }
            }
            const explanation = await explainChoice({
              tool: { name: chosen.name, text: toolText },
              units: [{ id: 'task', channel: 'task', text: lastTask }, ...RULE_UNITS, ...dataUnits],
              embedder: attributionEmbedder,
            });
            step.attribution = toWhyAttribution(explanation);
          } catch {
            /* attribution is best-effort — on failure the panel omits the strategy */
          }
        }
      }
      return built;
    },
    async send(userMessage: string): Promise<TurnResult> {
      const message =
        (transcript.length > 0 ? `Recent conversation:\n${transcript.slice(-6).join('\n')}\n\n` : '') +
        `User: ${userMessage}`;
      transcript.push(`User: ${userMessage}`);
      lastTask = userMessage;
      think.clear(); // fresh trace per user message (the /debug view shows this turn)
      return settle(await agent.run({ message }));
    },
    async confirm(approved: boolean, answerText?: string): Promise<TurnResult> {
      if (pausedCheckpoint === null) {
        return { type: 'reply', text: 'Nothing was awaiting confirmation.' };
      }
      if (approved && pausedAffordanceId) approvals.add(pausedAffordanceId);
      const checkpoint = pausedCheckpoint as Parameters<typeof agent.resume>[0];
      pausedCheckpoint = null;
      pausedAffordanceId = null;
      const answer = approved
        ? 'The user APPROVED. Retry that step with confirm: true now.'
        : `The user DECLINED${answerText ? `: "${answerText}"` : ''}. Do not fire it.`;
      return settle(await agent.resume(checkpoint, answer));
    },
  };
}
