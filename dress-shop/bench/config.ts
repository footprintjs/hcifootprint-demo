/**
 * The benchmark matrix + caps. The instrument runs the cross product
 * {task × modality × model × seed}; everything a reviewer needs to reproduce a
 * number is in one object.
 *
 * On "seed": the Anthropic API is not deterministically seedable, so a seed
 * here is a REPETITION INDEX — repeated independent samples of the same cell,
 * not a determinism knob. The pilot uses one; the real study raises it.
 */
import { fileURLToPath } from 'node:url';

export interface BenchConfig {
  /** Task ids from bench/tasks.ts. */
  readonly taskIds: readonly string[];
  /** Modality ids: 'hcifootprint' | 'dom-dump'. */
  readonly modalities: readonly string[];
  /** Agent-under-test model ids (sent to the provider). */
  readonly models: readonly string[];
  /** Repetition indices. */
  readonly seeds: readonly number[];
  /** ReAct iteration cap — identical for both modalities. */
  readonly maxIterations: number;
  /** Per-run wall-clock cap (ms). A run past this is killed and recorded failed. */
  readonly timeoutMs: number;
  /** Auto-approve confirmation prompts (needed for the confirm-gate task). */
  readonly autoApprove: boolean;
  /** Label for the JSONL output file (bench/results/<label>.jsonl). */
  readonly label: string;
}

/** Absolute path to bench/results/. */
export const RESULTS_DIR = fileURLToPath(new URL('./results/', import.meta.url));

/**
 * Phase-1 pilot: 2 modalities × 3 tasks × 1 seed, cheap model. Includes the
 * confirm-gate flagship (buy-cheapest-red). Expected spend well under $1.
 */
export const PILOT_CONFIG: BenchConfig = {
  taskIds: ['open-emerald', 'filter-red', 'buy-cheapest-red'],
  modalities: ['hcifootprint', 'dom-dump'],
  models: ['claude-haiku-4-5'],
  seeds: [1],
  // Pilot 1 ran at 16 (the shipped assistant's default) and the skill-graph
  // agent exhausted it ONE step short of the confirm gate on buy-cheapest-red.
  // 20 is the contract's stated ceiling; both modalities share the same bound.
  maxIterations: 20,
  timeoutMs: 180_000,
  autoApprove: true,
  label: 'pilot',
};

/** The full Phase-1 task set (all 5), for the report/CLI to reference. */
export const ALL_TASK_IDS = [
  'open-emerald',
  'filter-red',
  'buy-cheapest-red',
  'track-order',
  'buy-denim-pinafore',
] as const;
