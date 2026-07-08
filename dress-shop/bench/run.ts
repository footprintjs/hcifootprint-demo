/**
 * The benchmark runner.
 *
 * For every {task × modality × model × seed} cell it: builds a fresh app, wraps
 * the model in the token meter (bench/token-provider.ts — the SAME meter for
 * both modalities), runs the modality under a wall-clock + iteration cap, then
 * runs the task's oracle against the FINAL app state (never the transcript). It
 * writes one JSONL row per run to bench/results/<label>.jsonl and dumps a
 * transcript file for every failure.
 *
 * `runMatrix` is the reusable core (tests inject a mock providerFactory);
 * `main()` is the CLI that wires the real Anthropic provider from dress-shop/.env.
 */
import { mkdirSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { LLMProvider } from 'agentfootprint/llm-providers';
import { anthropic } from 'agentfootprint/llm-providers';
import { loadDotEnv } from '../src/chatbot/env.js';
import { taskById } from './tasks.js';
import { createCountingProvider } from './token-provider.js';
import { hcifootprintModality } from './modalities/hcifootprint.js';
import { domDumpModality } from './modalities/dom-dump.js';
import { axTreeModality } from './modalities/ax-tree.js';
import type { Modality } from './modalities/types.js';
import { PILOT_CONFIG, RESULTS_DIR, type BenchConfig } from './config.js';

/** All registered modalities — shared with bench/scale.ts. */
export const MODALITIES: Record<string, Modality> = {
  [hcifootprintModality.id]: hcifootprintModality,
  [domDumpModality.id]: domDumpModality,
  [axTreeModality.id]: axTreeModality,
};

/** One JSONL row — everything captured for a single run. */
export interface RunRecord {
  readonly ts: string;
  readonly taskId: string;
  readonly modality: string;
  readonly model: string;
  readonly seed: number;
  readonly success: boolean;
  readonly oracleDetail: string;
  readonly errored: boolean;
  readonly timedOut: boolean;
  readonly confirmations: number;
  readonly llmCalls: number;
  readonly toolCalls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly wallMs: number;
  readonly reply: string;
  /** Present only on failed/errored runs. */
  readonly transcriptPath?: string;
}

/** Returns the BASE provider for a cell (runMatrix wraps it in the token meter). */
export type ProviderFactory = (ctx: {
  taskId: string;
  modalityId: string;
  model: string;
  seed: number;
}) => LLMProvider;

export interface RunMatrixDeps {
  readonly providerFactory: ProviderFactory;
  /** Sink for each finished row. Default: append JSONL to the results file. */
  readonly writeRow?: (row: RunRecord) => void;
  /** Where failure transcripts are written. Default: RESULTS_DIR/transcripts. */
  readonly transcriptDir?: string;
  readonly log?: (line: string) => void;
}

/** Race a promise against a wall-clock cap. Resolves `{ timedOut: true }` on cap. */
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<{ timedOut: false; value: T } | { timedOut: true }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ timedOut: true }>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), ms);
  });
  try {
    const value = await Promise.race([p.then((v) => ({ timedOut: false as const, value: v })), timeout]);
    return value;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Slug-safe fragment for a transcript filename. */
function slug(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export async function runMatrix(config: BenchConfig, deps: RunMatrixDeps): Promise<RunRecord[]> {
  const log = deps.log ?? (() => {});
  const transcriptDir = deps.transcriptDir ?? join(RESULTS_DIR, 'transcripts');
  const writeRow = deps.writeRow ?? (() => {});
  const records: RunRecord[] = [];

  for (const model of config.models) {
    for (const seed of config.seeds) {
      for (const taskId of config.taskIds) {
        const task = taskById(taskId);
        for (const modalityId of config.modalities) {
          const modality = MODALITIES[modalityId];
          if (!modality) throw new Error(`Unknown modality '${modalityId}'.`);

          const base = deps.providerFactory({ taskId, modalityId, model, seed });
          const counting = createCountingProvider(base);
          log(`▶ ${taskId} · ${modalityId} · ${model} · seed ${seed}`);

          const startMs = Date.now();
          const outcome = await withTimeout(
            modality.run(task, {
              provider: counting.provider,
              maxIterations: config.maxIterations,
              autoApprove: config.autoApprove,
              onActivity: (s) => log(`    ${s}`),
            }),
            config.timeoutMs,
          );
          const wallMs = Date.now() - startMs;
          const totals = counting.totals();

          let success = false;
          let oracleDetail: string;
          let errored: boolean;
          let confirmations = 0;
          let reply: string;
          let transcript: string;

          if (outcome.timedOut) {
            oracleDetail = `run exceeded the ${config.timeoutMs}ms cap — recorded as failure`;
            errored = true;
            reply = '[timeout]';
            transcript = `TASK: ${task.instruction}\n[timed out after ${config.timeoutMs}ms]`;
          } else {
            const { shop, result } = outcome.value;
            const oracle = task.oracle(shop);
            success = oracle.pass && !result.errored;
            oracleDetail = oracle.detail;
            errored = result.errored;
            confirmations = result.confirmations;
            reply = result.reply;
            transcript = result.transcript;
          }

          let transcriptPath: string | undefined;
          if (!success) {
            mkdirSync(transcriptDir, { recursive: true });
            transcriptPath = join(transcriptDir, `${slug(taskId)}__${slug(modalityId)}__seed${seed}__${Date.now()}.txt`);
            writeFileSync(transcriptPath, transcript, 'utf8');
          }

          const record: RunRecord = {
            ts: new Date().toISOString(),
            taskId,
            modality: modalityId,
            model,
            seed,
            success,
            oracleDetail,
            errored,
            timedOut: outcome.timedOut,
            confirmations,
            llmCalls: totals.llmCalls,
            toolCalls: totals.toolCalls,
            inputTokens: totals.inputTokens,
            outputTokens: totals.outputTokens,
            totalTokens: totals.totalTokens,
            cacheReadTokens: totals.cacheReadTokens,
            cacheWriteTokens: totals.cacheWriteTokens,
            wallMs,
            reply,
            ...(transcriptPath ? { transcriptPath } : {}),
          };
          records.push(record);
          writeRow(record);
          log(
            `    ${success ? '✓ pass' : '✗ fail'} · ${totals.totalTokens} tok · ${totals.llmCalls} turns · ` +
              `${totals.toolCalls} tool calls · ${wallMs}ms — ${oracleDetail}`,
          );
        }
      }
    }
  }
  return records;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

/** `--tasks=a,b --modalities=ax-tree --label=pilot-2` — rerun a subset without
 *  re-spending passing cells. The report merges files, keeping the LATEST run
 *  per cell. New rows for a new modality simply add cells. */
function configFromArgv(argv: readonly string[]): BenchConfig {
  let config = PILOT_CONFIG;
  const list = (csv: string): string[] => csv.split(',').map((t) => t.trim()).filter(Boolean);
  for (const arg of argv) {
    const tasks = /^--tasks=(.+)$/.exec(arg);
    if (tasks) config = { ...config, taskIds: list(tasks[1]) };
    const modalities = /^--modalities=(.+)$/.exec(arg);
    if (modalities) config = { ...config, modalities: list(modalities[1]) };
    const label = /^--label=(.+)$/.exec(arg);
    if (label) config = { ...config, label: label[1] };
  }
  return config;
}

async function main(): Promise<void> {
  loadDotEnv();
  const config = configFromArgv(process.argv.slice(2));

  if (!process.env['ANTHROPIC_API_KEY']) {
    console.error('No ANTHROPIC_API_KEY — put it in dress-shop/.env. Aborting (the pilot makes real API calls).');
    process.exit(1);
  }

  mkdirSync(RESULTS_DIR, { recursive: true });
  const outFile = join(RESULTS_DIR, `${config.label}.jsonl`);
  const append = process.argv.includes('--append');
  if (!append) {
    rmSync(outFile, { force: true }); // fresh file unless --append
    writeFileSync(outFile, '', 'utf8');
  }

  const providerFactory: ProviderFactory = ({ model }) =>
    anthropic({ defaultModel: model, timeout: 120_000, maxRetries: 3 });

  console.log(`\n  hcifootprint H9 pilot — ${config.taskIds.length} tasks × ${config.modalities.length} modalities × ` +
    `${config.seeds.length} seed(s), model=${config.models.join(',')}`);
  console.log(`  writing → ${outFile}\n`);

  const records = await runMatrix(config, {
    providerFactory,
    writeRow: (row) => appendFileSync(outFile, JSON.stringify(row) + '\n', 'utf8'),
    log: (line) => console.log(line),
  });

  const passed = records.filter((r) => r.success).length;
  console.log(`\n  done — ${passed}/${records.length} runs passed. Report: npm run bench:report\n`);
}

// Run only when invoked directly (not when imported by a test).
const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
