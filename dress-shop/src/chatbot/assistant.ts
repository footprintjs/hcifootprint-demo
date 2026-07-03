/**
 * The shop assistant, framework-side — an agentfootprint Agent whose tools ARE
 * the HCIFootprint session surface. Shared by both front-ends (CLI and web) so
 * the human-in-the-loop pause/resume logic lives in exactly one place.
 *
 * A turn returns one of two things:
 *   { type: 'reply',   text }              — the agent finished
 *   { type: 'confirm', question, ... }     — the run PAUSED for approval; call
 *                                            assistant.confirm(approved) to resume
 */
import { Agent, askHuman, defineTool, isPaused } from 'agentfootprint';
import { anthropic } from 'agentfootprint/llm-providers';
import type { Session } from 'hcifootprint';

const MODEL = process.env['ANTHROPIC_MODEL'] ?? 'claude-opus-4-8';

const SYSTEM = `You are the shopping assistant for a small dress store, acting on the LIVE app.
Work method, every turn:
1. Call get_app_context first — it tells you where the user is, what they did since your last
   turn, which actions exist RIGHT NOW (with input schemas and the current version), and which
   multi-step skills are feasible.
2. For multi-step tasks, call start_skill before walking the steps and finish_skill after.
3. Act with act({affordanceId, payload, plannedVersion}) — always pass the version you planned
   against (from get_app_context). If an action is rejected (guard failed, stale version),
   call get_app_context again and replan; never retry blindly.
4. High-effect actions (marked in the action list) require request_confirmation FIRST — the
   user answers directly; only an approval lets the action fire.
5. If NO available action or skill can serve the request, call report_gap with the user's ask
   BEFORE telling them you can't help — that is how the team learns what to build next.
Keep replies short and grounded in what actually happened (tool results), never in intentions.`;

export interface ConfirmQuestion {
  affordanceId: string;
  summary: string;
}

export type TurnResult =
  | { type: 'reply'; text: string }
  | { type: 'confirm'; question: ConfirmQuestion };

export interface Assistant {
  /** Send a user message. Resolves to a reply, or a pause awaiting confirmation. */
  send(userMessage: string): Promise<TurnResult>;
  /** Answer a pending confirmation; resolves to a reply, or another pause. */
  confirm(approved: boolean, answerText?: string): Promise<TurnResult>;
  /** True while a confirmation is outstanding. */
  readonly awaitingConfirmation: boolean;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

export function createAssistant(session: Session): Assistant {
  const approvals = new Set<string>();
  const transcript: string[] = [];
  // The checkpoint + pending affordance held between a pause and its confirm().
  let pausedCheckpoint: unknown = null;
  let pausedAffordanceId: string | null = null;

  const tools = [
    defineTool({
      name: 'get_app_context',
      description:
        'Where the user is, what happened since your last look, the actions available right now ' +
        '(with schemas and the version token), and skill feasibility. Call this first, every turn.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      execute: async () =>
        JSON.stringify(
          {
            brief: session.contextBrief().text,
            version: session.version,
            actions: session.toMCPTools().map((t) => ({
              affordanceId: t.name.replace(/^dress-shop\./, ''),
              description: t.description,
              inputSchema: t.inputSchema,
            })),
            skills: session.availableSkills().skills,
            openSkillFrame: session.skillFrame(),
          },
          null,
          1,
        ),
    }),
    defineTool({
      name: 'plan_skill',
      description: "A skill's step plan: derived dependencies + live status (done/ready/blocked/off-node).",
      inputSchema: { type: 'object', properties: { skillId: { type: 'string' } }, required: ['skillId'] },
      execute: async (args: { skillId: string }) => JSON.stringify(session.skillPlan(args.skillId), null, 1),
    }),
    defineTool({
      name: 'start_skill',
      description: 'Commit to a skill before walking its steps (narrows the action space to it).',
      inputSchema: { type: 'object', properties: { skillId: { type: 'string' } }, required: ['skillId'] },
      execute: async (args: { skillId: string }) =>
        JSON.stringify(session.commitSkill(args.skillId, { source: 'agent' }), null, 1),
    }),
    defineTool({
      name: 'finish_skill',
      description: 'Close the open skill frame (done or plans changed).',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      execute: async () => JSON.stringify(session.leaveSkill() ?? { note: 'no frame was open' }),
    }),
    defineTool({
      name: 'request_confirmation',
      description:
        'REQUIRED before any high-effect action: pauses this run and asks the user directly. ' +
        "Their answer comes back as this tool's result.",
      inputSchema: {
        type: 'object',
        properties: {
          affordanceId: { type: 'string' },
          summary: { type: 'string', description: 'One sentence: what will happen if approved.' },
        },
        required: ['affordanceId', 'summary'],
      },
      execute: async (args: { affordanceId: string; summary: string }) => {
        askHuman({ affordanceId: args.affordanceId, summary: args.summary });
        return ''; // unreachable — askHuman always pauses
      },
    }),
    defineTool({
      name: 'act',
      description:
        'Fire one currently-available action. Pass plannedVersion from get_app_context; a stale ' +
        'version or failing guard is rejected with the reason — replan, do not retry blindly.',
      inputSchema: {
        type: 'object',
        properties: {
          affordanceId: { type: 'string' },
          payload: { type: 'object' },
          plannedVersion: { type: 'number' },
        },
        required: ['affordanceId'],
      },
      execute: async (args: { affordanceId: string; payload?: Record<string, unknown>; plannedVersion?: number }) => {
        const highEffect = session
          .toMCPTools()
          .some((t) => t.name === `dress-shop.${args.affordanceId}` && t.description.includes('[high-effect'));
        if (highEffect && !approvals.has(args.affordanceId)) {
          return JSON.stringify({
            ok: false,
            reason: 'CONFIRMATION_REQUIRED',
            hint: 'Call request_confirmation for this action first; the user must approve.',
          });
        }
        const result = session.fire(args.affordanceId, {
          source: 'agent',
          payload: args.payload,
          expectedVersion: args.plannedVersion,
        });
        if (result.ok && highEffect) approvals.delete(args.affordanceId); // one approval = one fire
        await flush(); // let the app's handler run and the tap settle
        return JSON.stringify(
          result.ok
            ? { ok: true, outcome: result.transition.outcome, nowOn: session.node, pending: session.pending().map((p) => p.affordanceId) }
            : result,
          null,
          1,
        );
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
    provider: anthropic({ defaultModel: MODEL }),
    name: 'dress-shop-assistant',
    model: 'anthropic',
  })
    .system(SYSTEM)
    .maxIterations(12);
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
        ? 'The user APPROVED. Proceed with the action.'
        : `The user DECLINED${answerText ? `: "${answerText}"` : ''}. Do not fire it.`;
      return settle(await agent.resume(checkpoint, answer));
    },
  };
}
