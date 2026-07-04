/**
 * The shop assistant, framework-side — an agentfootprint Agent served in
 * MODE B (D18): the tool array is FIXED for the whole conversation — one tool
 * per skill plus whats_here / do_action (from hcifootprint's skillsAsTools),
 * plus the human-in-the-loop confirmation tools. What is fireable RIGHT NOW
 * arrives inside each tool result (readySteps); the model acts by calling the
 * same skill tool again with {step}. Navigation never touches the tool array,
 * so the prompt cache stays warm and any MCP host could serve this identically.
 *
 * A turn returns one of two things:
 *   { type: 'reply',   text }              — the agent finished
 *   { type: 'confirm', question, ... }     — the run PAUSED for approval; call
 *                                            assistant.confirm(approved) to resume
 */
import { Agent, askHuman, defineTool, isPaused } from 'agentfootprint';
import { anthropic } from 'agentfootprint/llm-providers';
import type { Session } from 'hcifootprint';
import { skillsAsTools } from 'hcifootprint';

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
}

export interface Assistant {
  /** Send a user message. Resolves to a reply, or a pause awaiting confirmation. */
  send(userMessage: string): Promise<TurnResult>;
  /** Answer a pending confirmation; resolves to a reply, or another pause. */
  confirm(approved: boolean, answerText?: string): Promise<TurnResult>;
  /** True while a confirmation is outstanding. */
  readonly awaitingConfirmation: boolean;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

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
  if (step && PRETTY[step]) return PRETTY[step];
  if (kind.type === 'whats_here') return 'Looking around the shop…';
  if (kind.type === 'skill' && !step) return `Planning: ${kind.id.replace(/-/g, ' ')}…`;
  if (step) return `Working on ${step.replace(/-/g, ' ')}…`;
  return 'Working…';
}

/** Anthropic tool names allow [a-zA-Z0-9_-] only — map the port's dotted MCP names. */
const apiName = (portName: string) => portName.replace(/^dress-shop\./, '').replace(/[^a-zA-Z0-9_-]/g, '_');

export function createAssistant(session: Session, options?: AssistantOptions): Assistant {
  const emit = (status: string) => options?.onActivity?.(status);
  // The HARD human-in-the-loop gate. The serve layer stops high-effect steps
  // at needs-confirm; this set is what an APPROVAL (and only an approval)
  // unlocks — the model saying confirm:true on its own is bounced back.
  const approvals = new Set<string>();
  const transcript: string[] = [];
  let pausedCheckpoint: unknown = null;
  let pausedAffordanceId: string | null = null;

  const port = skillsAsTools(session, { source: 'agent' });
  const portNameByApiName = new Map<string, string>();

  const modeBTools = port.tools().map((tool) => {
    const name = apiName(tool.name);
    portNameByApiName.set(name, tool.name);
    const kind: { type: 'skill'; id: string } | { type: 'whats_here' } | { type: 'do_action' } =
      tool.name.includes('.skill.')
        ? { type: 'skill', id: tool.name.split('.skill.')[1] }
        : tool.name.endsWith('.whats_here')
          ? { type: 'whats_here' }
          : { type: 'do_action' };
    return defineTool({
      name,
      description: tool.description,
      inputSchema: tool.inputSchema as Record<string, unknown>,
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
        const result = port.call(portNameByApiName.get(name)!, args);
        if (result['ok'] === true && args.confirm === true && stepKey !== undefined) {
          approvals.delete(stepKey); // one approval = one fire
        }
        await flush(); // let the app's handler run and the tap settle
        // Attach what the fired action RETURNED (search results, order status) —
        // the "act → data back" channel, so the model can pick real ids next.
        if (typeof result['transitionId'] === 'string') {
          const produced = session.producedFor(result['transitionId']);
          if (produced !== undefined) result['data'] = produced;
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
    // out" — it retries instead.
    provider: anthropic({ defaultModel: MODEL, timeout: 120_000, maxRetries: 3 }),
    name: 'dress-shop-assistant',
    model: 'anthropic',
  })
    .system(SYSTEM)
    .maxIterations(16);
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
    async send(userMessage: string): Promise<TurnResult> {
      const message =
        (transcript.length > 0 ? `Recent conversation:\n${transcript.slice(-6).join('\n')}\n\n` : '') +
        `User: ${userMessage}`;
      transcript.push(`User: ${userMessage}`);
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
