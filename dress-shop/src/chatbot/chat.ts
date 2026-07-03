/**
 * The shop assistant — an agentfootprint agent driving the UNCHANGED app
 * through the HCIFootprint session. The whole footprintjs family in one loop:
 *
 *   you (chat) ──▶ agentfootprint Agent (Claude, your key)
 *                    │ tools = the app's live action space (hcifootprint)
 *                    ▼
 *                  dress shop app (commit-1 code, untouched)
 *
 * Human-in-the-loop: placing an order is high-effect, so the agent must call
 * request_confirmation — which PAUSES the agent run (footprint's checkpoint
 * pause/resume, surfaced as agentfootprint's askHuman). You answer at the
 * prompt; the run RESUMES from the checkpoint with your answer as the tool's
 * result. The dispatcher only lets `act` fire a high-effect action after a
 * real approval — the model cannot skip the human.
 *
 * Run: npm run chat   (reads .env — copy .env.template and add your key)
 */
import fs from 'node:fs';
import readline from 'node:readline/promises';
import { Agent, askHuman, defineTool, isPaused } from 'agentfootprint';
import { anthropic } from 'agentfootprint/llm-providers';
import { DressShop } from '../app/shop.js';
import { connectShop } from '../agent-layer/connect.js';

loadDotEnv();
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
Keep replies short and grounded in what actually happened (tool results), never in intentions.`;

async function main(): Promise<void> {
  const shop = new DressShop();
  const session = connectShop(shop);
  const approvals = new Set<string>();
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  const tools = [
    defineTool({
      name: 'get_app_context',
      description:
        'Where the user is, what happened since your last look, the actions available right now ' +
        '(with schemas and the version token), and skill feasibility. Call this first, every turn.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      execute: async () => {
        const brief = session.contextBrief();
        return JSON.stringify(
          {
            brief: brief.text,
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
        );
      },
    }),
    defineTool({
      name: 'plan_skill',
      description: "A skill's step plan: derived dependencies + live status (done/ready/blocked/off-node).",
      inputSchema: {
        type: 'object',
        properties: { skillId: { type: 'string' } },
        required: ['skillId'],
      },
      execute: async (args: { skillId: string }) => JSON.stringify(session.skillPlan(args.skillId), null, 1),
    }),
    defineTool({
      name: 'start_skill',
      description: 'Commit to a skill before walking its steps (narrows the action space to it).',
      inputSchema: {
        type: 'object',
        properties: { skillId: { type: 'string' } },
        required: ['skillId'],
      },
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
        'Their answer comes back as this tool\'s result.',
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
          .some(
            (t) =>
              t.name === `dress-shop.${args.affordanceId}` && t.description.includes('[high-effect'),
          );
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
            ? {
                ok: true,
                outcome: result.transition.outcome,
                nowOn: session.node,
                pending: session.pending().map((p) => p.affordanceId),
              }
            : result,
          null,
          1,
        );
      },
    }),
    defineTool({
      name: 'explain',
      description: 'Why does a state key have its value — the causal chain of recorded actions.',
      inputSchema: {
        type: 'object',
        properties: { key: { type: 'string' } },
        required: ['key'],
      },
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

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const transcript: string[] = [];
  console.log(`dress-shop assistant (${MODEL}) — chat normally; /state /brief /quit are local.\n`);

  for (;;) {
    const line = (await rl.question('you> ')).trim();
    if (!line) continue;
    if (line === '/quit') break;
    if (line === '/state') {
      console.log(JSON.stringify(session.state(), null, 2));
      continue;
    }
    if (line === '/brief') {
      console.log(session.contextBrief().text);
      continue;
    }

    const message =
      (transcript.length > 0 ? `Recent conversation:\n${transcript.slice(-6).join('\n')}\n\n` : '') +
      `User: ${line}`;
    let result = await agent.run({ message });

    // ── human-in-the-loop: the run PAUSED for confirmation ──────────────────
    while (isPaused(result)) {
      const ask = result.pauseData as { affordanceId: string; summary: string };
      const answer = (await rl.question(`confirm> ${ask.summary} (yes/no) `)).trim().toLowerCase();
      const approved = answer === 'y' || answer === 'yes';
      if (approved) approvals.add(ask.affordanceId);
      result = await agent.resume(
        result.checkpoint,
        approved ? 'The user APPROVED. Proceed with the action.' : `The user DECLINED: "${answer}". Do not fire it.`,
      );
    }

    console.log(`assistant> ${result}`);
    transcript.push(`User: ${line}`, `Assistant: ${String(result).slice(0, 300)}`);
  }
  rl.close();
}

/** Minimal .env loader — no dependency needed for a demo. */
function loadDotEnv(): void {
  try {
    const lines = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').split('\n');
    for (const line of lines) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
    }
  } catch {
    // no .env — fine; the environment may already carry the key
  }
}

main().catch((error) => {
  if (String(error).toLowerCase().includes('api key') || String(error).includes('401')) {
    console.error('No usable Claude API key. Copy .env.template to .env and add ANTHROPIC_API_KEY.');
    process.exit(1);
  }
  throw error;
});
