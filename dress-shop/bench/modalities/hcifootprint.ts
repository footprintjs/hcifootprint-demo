/**
 * Modality A — the hcifootprint typed skill graph (Mode B).
 *
 * This is the EXISTING shipped assistant, unmodified in behavior: the same
 * `createAssistant` wiring the storefront uses (skillsAsTools over the direct
 * in-process port, one tool per skill, readySteps in every result, the confirm
 * gate). The only benchmark seam is the injected token-counting provider — the
 * same one handed to the DOM baseline — so both modalities are metered
 * identically. No HTTP: we use `connectDirect`, exactly as the demo's
 * `HCI_MODE=direct` path does.
 *
 * The runner owns the confirm gate: when the agent pauses for approval and
 * `autoApprove` is set, we approve and resume — this is the "auto-approval
 * configured" the confirm-gate task needs.
 */
import { DressShop } from '../../src/app/shop.js';
import { connectShop } from '../../src/agent-layer/connect.js';
import { connectDirect } from '../../src/agent-layer/mcp-bridge.js';
import { createAssistant } from '../../src/chatbot/assistant.js';
import type { Modality, ModalityRunOptions, ModalityRunResult } from './types.js';
import type { BenchTask } from '../tasks.js';

/** Hard ceiling on approval round-trips, so a mis-looping agent can't spin. */
const MAX_CONFIRMS = 4;

export const hcifootprintModality: Modality = {
  id: 'hcifootprint',
  label: 'hcifootprint (skill graph)',
  async run(task: BenchTask, opts: ModalityRunOptions): Promise<{ shop: DressShop; result: ModalityRunResult }> {
    const shop = new DressShop(opts.catalog);
    task.setup?.(shop); // deterministic pre-state, BEFORE the session snapshots it

    const session = connectShop(shop);
    const appMcp = connectDirect(session);

    const activity: string[] = [];
    const assistant = createAssistant(session, appMcp, {
      provider: opts.provider,
      maxIterations: opts.maxIterations,
      embedder: null, // API-only: no embedding calls muddy the token count
      onActivity: (status) => {
        activity.push(status);
        opts.onActivity?.(status);
      },
    });

    let confirmations = 0;
    let reply = '';
    let errored = false;
    try {
      let turn = await assistant.send(task.instruction);
      while (turn.type === 'confirm') {
        if (!opts.autoApprove || confirmations >= MAX_CONFIRMS) {
          activity.push(`declined: ${turn.question.summary}`);
          turn = await assistant.confirm(false);
          break; // one decline ends the exchange — the agent wraps up in its reply
        }
        confirmations++;
        activity.push(`auto-approved: ${turn.question.summary}`);
        turn = await assistant.confirm(true);
      }
      if (turn.type === 'reply') reply = turn.text;
      else reply = '[still awaiting confirmation after decline]';
    } catch (error) {
      errored = true;
      reply = `[error] ${error instanceof Error ? error.message : String(error)}`;
    }

    const transcript = [`TASK: ${task.instruction}`, ...activity.map((a) => `  · ${a}`), `REPLY: ${reply}`].join('\n');
    return { shop, result: { reply, transcript, errored, confirmations } };
  },
};
