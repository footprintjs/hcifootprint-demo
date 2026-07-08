/**
 * Accounting math tests — the token meter, the medians, the per-modality
 * aggregation, and the JSONL round-trip. All pure; no API calls.
 */
import { mkdtempSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createCountingProvider, sumCalls } from './token-provider.js';
import { aggregateByModality, aggregateByTaskModality, formatReport, latestPerCell, median, readRecords } from './report.js';
import type { RunRecord } from './run.js';
import type { LLMProvider } from 'agentfootprint/llm-providers';

const tmp = mkdtempSync(join(tmpdir(), 'bench-accounting-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('sumCalls', () => {
  it('sums per-call records into headline totals', () => {
    const totals = sumCalls([
      { inputTokens: 100, outputTokens: 20, cacheReadTokens: 5, cacheWriteTokens: 0, toolCalls: 1 },
      { inputTokens: 250, outputTokens: 30, cacheReadTokens: 0, cacheWriteTokens: 7, toolCalls: 2 },
    ]);
    expect(totals.llmCalls).toBe(2);
    expect(totals.toolCalls).toBe(3);
    expect(totals.inputTokens).toBe(350);
    expect(totals.outputTokens).toBe(50);
    expect(totals.totalTokens).toBe(400);
    expect(totals.cacheReadTokens).toBe(5);
    expect(totals.cacheWriteTokens).toBe(7);
  });
  it('is all-zero for no calls', () => {
    expect(sumCalls([]).totalTokens).toBe(0);
    expect(sumCalls([]).llmCalls).toBe(0);
  });
});

describe('createCountingProvider', () => {
  it('records exactly what the inner provider reports, per call', async () => {
    const inner: LLMProvider = {
      name: 'fake',
      complete: async () => ({
        content: 'ok',
        toolCalls: [{ id: 't1', name: 'x', args: {} }],
        usage: { input: 42, output: 7, cacheRead: 3 },
        stopReason: 'tool_use',
      }),
    };
    const counting = createCountingProvider(inner);
    await counting.provider.complete({ model: 'm', messages: [{ role: 'user', content: 'hi' }] });
    await counting.provider.complete({ model: 'm', messages: [{ role: 'user', content: 'hi' }] });
    expect(counting.calls).toHaveLength(2);
    expect(counting.calls[0]).toMatchObject({ inputTokens: 42, outputTokens: 7, cacheReadTokens: 3, toolCalls: 1 });
    expect(counting.totals()).toMatchObject({ llmCalls: 2, toolCalls: 2, inputTokens: 84, outputTokens: 14, totalTokens: 98 });
  });

  it('does not expose stream() when the inner provider lacks it', () => {
    const inner: LLMProvider = {
      name: 'no-stream',
      complete: async () => ({ content: '', toolCalls: [], usage: { input: 1, output: 1 }, stopReason: 'stop' }),
    };
    expect(createCountingProvider(inner).provider.stream).toBeUndefined();
  });
});

describe('median', () => {
  it('handles odd, even, and empty lists', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBe(0);
    expect(median([7])).toBe(7);
  });
});

function row(partial: Partial<RunRecord>): RunRecord {
  return {
    ts: '2026-07-09T00:00:00.000Z',
    taskId: 'open-emerald',
    modality: 'hcifootprint',
    model: 'claude-haiku-4-5',
    seed: 1,
    success: true,
    oracleDetail: 'ok',
    errored: false,
    timedOut: false,
    confirmations: 0,
    llmCalls: 4,
    toolCalls: 3,
    inputTokens: 900,
    outputTokens: 100,
    totalTokens: 1000,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    wallMs: 5000,
    reply: 'done',
    ...partial,
  };
}

describe('aggregation', () => {
  const records: RunRecord[] = [
    row({ modality: 'hcifootprint', totalTokens: 1000, llmCalls: 4, success: true }),
    row({ modality: 'hcifootprint', totalTokens: 2000, llmCalls: 5, success: false, taskId: 'filter-red' }),
    row({ modality: 'dom-dump', totalTokens: 8000, llmCalls: 8, success: true }),
    row({ modality: 'dom-dump', totalTokens: 6000, llmCalls: 6, success: true, taskId: 'filter-red' }),
  ];

  it('aggregates per modality: success rate + medians', () => {
    const stats = aggregateByModality(records);
    const hci = stats.find((s) => s.modality === 'hcifootprint')!;
    const dom = stats.find((s) => s.modality === 'dom-dump')!;
    expect(hci.runs).toBe(2);
    expect(hci.successRate).toBe(0.5);
    expect(hci.medianTokens).toBe(1500);
    expect(hci.medianTurns).toBe(4.5);
    expect(dom.successRate).toBe(1);
    expect(dom.medianTokens).toBe(7000);
    // tokens/turn medians: hci = median(250, 400) = 325; dom = median(1000, 1000) = 1000
    expect(hci.medianTokensPerTurn).toBe(325);
    expect(dom.medianTokensPerTurn).toBe(1000);
  });

  it('aggregates per task × modality', () => {
    const cells = aggregateByTaskModality(records);
    expect(cells).toHaveLength(4);
    const cell = cells.find((c) => c.taskId === 'filter-red' && c.modality === 'dom-dump')!;
    expect(cell.medianTokens).toBe(6000);
    expect(cell.successRate).toBe(1);
  });

  it('formatReport prints the H9 headline when both modalities are present', () => {
    const report = formatReport(records);
    expect(report).toContain('Per-modality summary');
    expect(report).toContain('hcifootprint');
    expect(report).toContain('dom-dump');
    expect(report).toContain('H9 vs dom-dump:');
    expect(report).toContain('fewer'); // 1500 vs 7000 → savings sentence
  });
});

describe('latestPerCell', () => {
  it('a rerun row supersedes the earlier row for the same cell', () => {
    const first = row({ taskId: 'filter-red', ts: '2026-07-09T01:00:00.000Z', success: false });
    const rerun = row({ taskId: 'filter-red', ts: '2026-07-09T02:00:00.000Z', success: true });
    const untouched = row({ taskId: 'open-emerald', ts: '2026-07-09T01:00:00.000Z' });
    const latest = latestPerCell([first, untouched, rerun]);
    expect(latest).toHaveLength(2);
    expect(latest.find((r) => r.taskId === 'filter-red')).toEqual(rerun);
    expect(latest.find((r) => r.taskId === 'open-emerald')).toEqual(untouched);
  });
  it('different modalities/seeds are different cells', () => {
    const a = row({ modality: 'hcifootprint' });
    const b = row({ modality: 'dom-dump' });
    const c = row({ modality: 'dom-dump', seed: 2 });
    expect(latestPerCell([a, b, c])).toHaveLength(3);
  });
});

describe('JSONL round-trip', () => {
  it('reads back exactly what the runner writes', () => {
    const file = join(tmp, 'roundtrip.jsonl');
    const rows = [row({}), row({ modality: 'dom-dump', success: false, transcriptPath: '/tmp/x.txt' })];
    for (const r of rows) appendFileSync(file, JSON.stringify(r) + '\n', 'utf8');
    const back = readRecords(file);
    expect(back).toEqual(rows);
  });
});
