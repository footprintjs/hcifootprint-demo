/**
 * Phase-2 unit tests — the scaling instrument's deterministic parts and the
 * AX snapshot pruner. No API calls; the browser smoke test lives in
 * ax-tree.test.ts (skipped when the pinned chromium is absent).
 */
import { describe, expect, it } from 'vitest';
import { makeCatalog } from './scale-catalog.js';
import { pruneSnapshot } from './modalities/ax-tree.js';
import { formatScaleMatrix, latestScaleCells } from './scale-report.js';
import type { ScaleRecord } from './scale.js';
import { DressShop } from '../src/app/shop.js';
import { taskById } from './tasks.js';

describe('makeCatalog', () => {
  it('produces exactly N dresses for every scale size', () => {
    for (const n of [10, 50, 200, 500]) {
      expect(makeCatalog(n)).toHaveLength(n);
    }
  });

  it('always contains the fixed task target d13 exactly once', () => {
    for (const n of [10, 15, 50, 500]) {
      const catalog = makeCatalog(n);
      const emeralds = catalog.filter((d) => d.id === 'd13');
      expect(emeralds).toHaveLength(1);
      expect(emeralds[0].name).toBe('Emerald Satin Wrap');
    }
  });

  it('keeps the storefront home-preview dresses resolvable at small N', () => {
    const ids = new Set(makeCatalog(10).map((d) => d.id));
    for (const id of ['d2', 'd3', 'd8', 'd10', 'd13']) expect(ids.has(id)).toBe(true);
  });

  it('generated filler never collides with the search target', () => {
    const catalog = makeCatalog(500);
    const filler = catalog.filter((d) => d.id.startsWith('gen-'));
    expect(filler).toHaveLength(485);
    expect(filler.some((d) => d.name.toLowerCase().includes('emerald'))).toBe(false);
    expect(filler.some((d) => d.name.toLowerCase().includes('satin wrap'))).toBe(false);
    expect(new Set(catalog.map((d) => d.id)).size).toBe(500); // unique ids
  });

  it('is deterministic', () => {
    expect(makeCatalog(200)).toEqual(makeCatalog(200));
  });

  it('the fixed task is completable at every size (oracle passes when driven)', () => {
    const task = taskById('open-emerald');
    for (const n of [10, 500]) {
      const shop = new DressShop(makeCatalog(n));
      shop.browseCatalog();
      const hits = shop.search('emerald');
      expect(hits.map((d) => d.id)).toEqual(['d13']); // exactly as discriminative at 500 as at 10
      shop.openDress('d13');
      expect(task.oracle(shop).pass).toBe(true);
    }
  });
});

describe('pruneSnapshot', () => {
  const raw = [
    '- navigation [ref=e2]:',
    '  - button "Home" [ref=e3] [cursor=pointer]',
    '  - link "View" [ref=e9] [cursor=pointer]:',
    '    - /url: "#"',
    '  - textbox "Search silk, red" [ref=e10]',
  ].join('\n');

  it('drops /url lines and cursor decoration, keeps roles/names/refs', () => {
    const out = pruneSnapshot(raw);
    expect(out).not.toContain('/url');
    expect(out).not.toContain('cursor=pointer');
    expect(out).toContain('button "Home" [ref=e3]');
    expect(out).toContain('link "View" [ref=e9]');
    expect(out).toContain('textbox "Search silk, red" [ref=e10]');
  });
});

function scaleRow(partial: Partial<ScaleRecord>): ScaleRecord {
  return {
    ts: '2026-07-09T00:00:00.000Z',
    size: 10,
    modality: 'hcifootprint',
    model: 'claude-haiku-4-5',
    taskId: 'open-emerald',
    success: true,
    oracleDetail: 'ok',
    errored: false,
    timedOut: false,
    llmCalls: 5,
    toolCalls: 4,
    inputTokens: 900,
    outputTokens: 100,
    totalTokens: 1000,
    wallMs: 8000,
    surfaceChars: 0,
    reply: 'done',
    ...partial,
  };
}

describe('scale matrix', () => {
  it('latestScaleCells: a rerun supersedes its cell', () => {
    const first = scaleRow({ size: 500, modality: 'ax-tree', ts: '2026-07-09T01:00:00.000Z', totalTokens: 1 });
    const rerun = scaleRow({ size: 500, modality: 'ax-tree', ts: '2026-07-09T02:00:00.000Z', totalTokens: 2 });
    const cells = latestScaleCells([first, rerun]);
    expect(cells).toHaveLength(1);
    expect(cells[0].totalTokens).toBe(2);
  });

  it('formats rows per size, columns per modality, with growth ratios and failure marks', () => {
    const records: ScaleRecord[] = [
      scaleRow({ size: 10, modality: 'hcifootprint', totalTokens: 20000 }),
      scaleRow({ size: 500, modality: 'hcifootprint', totalTokens: 21000 }),
      scaleRow({ size: 10, modality: 'dom-dump', totalTokens: 11000, surfaceChars: 4000 }),
      scaleRow({ size: 500, modality: 'dom-dump', totalTokens: 90000, surfaceChars: 90000, success: false }),
    ];
    const out = formatScaleMatrix(records);
    expect(out).toContain('catalog N');
    expect(out).toContain('hcifootprint');
    expect(out).toContain('dom-dump');
    expect(out).toContain('✗90000'); // the failed cell is marked, not hidden
    expect(out).toContain('(90000)'); // surface chars shown
    expect(out).toContain('hcifootprint: 20000 → 21000 tokens (1.05× from N=10 to N=500)');
    expect(out).toContain('dom-dump: 11000 → 90000 tokens (8.18× from N=10 to N=500)');
  });
});
