/**
 * The contract every modality implements, and the metrics one run produces.
 *
 * A modality is the perception+action interface the agent drives the SAME app
 * through. Everything else (model, provider, token meter, task, oracle) is held
 * constant by the runner, so the ONLY thing that varies between modalities is
 * how the agent sees the app and acts on it — which is exactly what H9 tests.
 */
import type { LLMProvider } from 'agentfootprint/llm-providers';
import type { DressShop } from '../../src/app/shop.js';
import type { Dress } from '../../src/app/data.js';
import type { BenchTask } from '../tasks.js';

export interface ModalityRunOptions {
  /** The token-counting provider (already wrapping the real/mock provider). */
  readonly provider: LLMProvider;
  /** ReAct iteration cap — identical for every modality. */
  readonly maxIterations: number;
  /** For the confirm-gate flow: auto-answer confirmation prompts (approve). */
  readonly autoApprove: boolean;
  /** Optional progress line sink (the runner logs these when verbose). */
  readonly onActivity?: (status: string) => void;
  /**
   * Catalog variant for the scaling experiment (bench/scale.ts). Omitted →
   * the demo's 15-dress catalog. Every modality seeds its DressShop with this,
   * so all three drive the same-size app.
   */
  readonly catalog?: readonly Dress[];
}

export interface ModalityRunResult {
  /** The agent's final natural-language reply (or an error string). */
  readonly reply: string;
  /** Full transcript of prompts/tool-calls/results for the failure log. */
  readonly transcript: string;
  /** True if the agent loop errored (as opposed to just failing the oracle). */
  readonly errored: boolean;
  /** How many confirmation prompts were auto-approved (0 for the DOM baseline). */
  readonly confirmations: number;
}

export interface Modality {
  readonly id: string;
  readonly label: string;
  /**
   * Build a fresh app, run the task to completion (or the iteration cap), and
   * return what happened. The shop is created HERE and returned so the runner's
   * oracle can read its final state directly — never the transcript.
   */
  run(task: BenchTask, opts: ModalityRunOptions): Promise<{ shop: DressShop; result: ModalityRunResult }>;
}
