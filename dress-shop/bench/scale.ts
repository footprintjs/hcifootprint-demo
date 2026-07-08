/**
 * The scaling experiment — the paper's load-bearing measurement.
 *
 * ONE fixed task (open-emerald: the simplest, so tokens ≈ pure interface
 * overhead) run against catalog sizes N = 10, 50, 200, 500 across all three
 * modalities. Hypothesis: perception modalities (dom-dump, ax-tree) re-serialize
 * the app surface every turn, so their tokens grow with N; hcifootprint's typed
 * position slice + fixed tool surface is size-independent, so its tokens stay
 * ~flat.
 *
 * Alongside each cell we record `surfaceChars`: the size of ONE full-catalog
 * perception (the rendered catalog page in that modality's own encoding). It
 * is measured OUTSIDE the run (no tokens spent) and explains WHY a modality's
 * tokens grew — the mechanism, not just the outcome.
 *
 * The page-count axis was considered and skipped: the demo app's pages are a
 * closed union (Page type + hand-written renderers), so "extra pages" would
 * mean benchmarking a different app, not a bigger one. Catalog size is the
 * clean, honest axis.
 */
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { anthropic } from 'agentfootprint/llm-providers';
import { chromium } from 'playwright-core';
import { loadDotEnv } from '../src/chatbot/env.js';
import { DressShop } from '../src/app/shop.js';
import type { Dress } from '../src/app/data.js';
import { taskById } from './tasks.js';
import { createCountingProvider } from './token-provider.js';
import { MODALITIES } from './run.js';
import { makeCatalog } from './scale-catalog.js';
import { StorefrontView } from './modalities/render-html.js';
import { startShopHost } from './web-host.js';
import { CHROMIUM_EXECUTABLE, pruneSnapshot } from './modalities/ax-tree.js';
import { RESULTS_DIR } from './config.js';

export const SCALE_SIZES = [10, 50, 200, 500] as const;
export const SCALE_MODALITIES = ['hcifootprint', 'dom-dump', 'ax-tree'] as const;
const SCALE_TASK = 'open-emerald';
const MODEL = 'claude-haiku-4-5';
const MAX_ITERATIONS = 20;
const TIMEOUT_MS = 240_000;

export interface ScaleRecord {
  readonly ts: string;
  readonly size: number;
  readonly modality: string;
  readonly model: string;
  readonly taskId: string;
  readonly success: boolean;
  readonly oracleDetail: string;
  readonly errored: boolean;
  readonly timedOut: boolean;
  readonly llmCalls: number;
  readonly toolCalls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly wallMs: number;
  /** Chars of ONE full-catalog perception in this modality's encoding (0 = n/a: fixed tool surface). */
  readonly surfaceChars: number;
  readonly reply: string;
}

/**
 * Measure one full-catalog perception per modality, outside any run.
 *   dom-dump  → StorefrontView catalog HTML after search('')
 *   ax-tree   → pruned AX snapshot of the real catalog page after search('')
 *   hcifootprint → 0 (its per-turn surface is the fixed tool list + position
 *                  slice; there IS no full-catalog perception unless a search
 *                  returns the whole catalog, which the task never needs)
 */
export async function measureSurfaceChars(modality: string, catalog: readonly Dress[]): Promise<number> {
  if (modality === 'dom-dump') {
    const shop = new DressShop(catalog);
    const view = new StorefrontView(shop);
    view.goto('/dresses'); // browse + search('') → all N cards
    return view.html().length;
  }
  if (modality === 'ax-tree') {
    const shop = new DressShop(catalog);
    shop.browseCatalog();
    shop.search('');
    const host = await startShopHost(shop);
    const browser = await chromium.launch({ executablePath: CHROMIUM_EXECUTABLE });
    try {
      const page = await browser.newPage();
      await page.goto(host.url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(400); // first render of the N-card grid
      const snap = await (page as unknown as { _snapshotForAI: () => Promise<{ full: string }> })._snapshotForAI();
      return pruneSnapshot(snap.full).length;
    } finally {
      await browser.close().catch(() => undefined);
      await host.close().catch(() => undefined);
    }
  }
  return 0; // hcifootprint: fixed tool surface — nothing scales with N by construction
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<{ timedOut: false; value: T } | { timedOut: true }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p.then((value) => ({ timedOut: false as const, value })),
      new Promise<{ timedOut: true }>((resolve) => {
        timer = setTimeout(() => resolve({ timedOut: true }), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  if (!process.env['ANTHROPIC_API_KEY']) {
    console.error('No ANTHROPIC_API_KEY — put it in dress-shop/.env. Aborting (real API calls).');
    process.exit(1);
  }

  mkdirSync(RESULTS_DIR, { recursive: true });
  const outFile = join(RESULTS_DIR, 'scale.jsonl');
  if (!process.argv.includes('--append')) {
    rmSync(outFile, { force: true });
    writeFileSync(outFile, '', 'utf8');
  }
  const only = /^--only=(.+)$/.exec(process.argv.find((a) => a.startsWith('--only=')) ?? '')?.[1];
  const cells = only ? new Set(only.split(',').map((s) => s.trim())) : null; // "500/ax-tree" form

  const task = taskById(SCALE_TASK);
  console.log(`\n  H9 scaling — task=${SCALE_TASK}, sizes=${SCALE_SIZES.join('/')}, model=${MODEL}`);
  console.log(`  writing → ${outFile}\n`);

  for (const size of SCALE_SIZES) {
    const catalog = makeCatalog(size);
    for (const modalityId of SCALE_MODALITIES) {
      if (cells && !cells.has(`${size}/${modalityId}`)) continue;
      const modality = MODALITIES[modalityId];
      const surfaceChars = await measureSurfaceChars(modalityId, catalog);
      const counting = createCountingProvider(anthropic({ defaultModel: MODEL, timeout: 120_000, maxRetries: 3 }));

      console.log(`▶ N=${size} · ${modalityId} (surface ${surfaceChars} chars)`);
      const startMs = Date.now();
      const outcome = await withTimeout(
        modality.run(task, {
          provider: counting.provider,
          maxIterations: MAX_ITERATIONS,
          autoApprove: true,
          catalog,
        }),
        TIMEOUT_MS,
      );
      const wallMs = Date.now() - startMs;
      const totals = counting.totals();

      let record: ScaleRecord;
      if (outcome.timedOut) {
        record = {
          ts: new Date().toISOString(), size, modality: modalityId, model: MODEL, taskId: SCALE_TASK,
          success: false, oracleDetail: `exceeded ${TIMEOUT_MS}ms`, errored: true, timedOut: true,
          llmCalls: totals.llmCalls, toolCalls: totals.toolCalls, inputTokens: totals.inputTokens,
          outputTokens: totals.outputTokens, totalTokens: totals.totalTokens, wallMs, surfaceChars,
          reply: '[timeout]',
        };
      } else {
        const { shop, result } = outcome.value;
        const oracle = task.oracle(shop);
        record = {
          ts: new Date().toISOString(), size, modality: modalityId, model: MODEL, taskId: SCALE_TASK,
          success: oracle.pass && !result.errored, oracleDetail: oracle.detail, errored: result.errored,
          timedOut: false, llmCalls: totals.llmCalls, toolCalls: totals.toolCalls,
          inputTokens: totals.inputTokens, outputTokens: totals.outputTokens, totalTokens: totals.totalTokens,
          wallMs, surfaceChars, reply: result.reply.slice(0, 300),
        };
      }
      appendFileSync(outFile, JSON.stringify(record) + '\n', 'utf8');
      console.log(
        `    ${record.success ? '✓ pass' : '✗ fail'} · ${record.totalTokens} tok · ${record.llmCalls} turns · ${wallMs}ms`,
      );
    }
  }
  console.log('\n  done. Matrix: npm run bench:scale-report\n');
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
