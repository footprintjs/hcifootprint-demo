/**
 * End-to-end runner test — the WHOLE matrix loop (modality → agent loop →
 * oracle → JSONL row → failure transcript) driven by agentfootprint's mock
 * provider with scripted replies. Zero API calls.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { mock } from 'agentfootprint/llm-providers';
import { runMatrix, type RunRecord } from './run.js';
import type { BenchConfig } from './config.js';

const tmp = mkdtempSync(join(tmpdir(), 'bench-runner-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const baseConfig: Omit<BenchConfig, 'taskIds' | 'modalities'> = {
  models: ['mock-model'],
  seeds: [1],
  maxIterations: 6,
  timeoutMs: 30_000,
  autoApprove: true,
  label: 'test',
};

describe('runMatrix end-to-end (mock provider, scripted agent)', () => {
  it('scripted DOM-baseline agent completes open-emerald and the oracle passes', async () => {
    const rows: RunRecord[] = [];
    const records = await runMatrix(
      { ...baseConfig, taskIds: ['open-emerald'], modalities: ['dom-dump'] },
      {
        providerFactory: () =>
          mock({
            replies: [
              { toolCalls: [{ id: 't1', name: 'goto', args: { path: '/dresses/d13' } }] },
              'Opened the Emerald Satin Wrap product page.',
            ],
          }),
        writeRow: (r) => rows.push(r),
        transcriptDir: tmp,
      },
    );

    expect(records).toHaveLength(1);
    const r = records[0];
    expect(r.success).toBe(true);
    expect(r.errored).toBe(false);
    expect(r.timedOut).toBe(false);
    expect(r.llmCalls).toBe(2); // one tool turn + one answer turn
    expect(r.toolCalls).toBe(1);
    expect(r.totalTokens).toBeGreaterThan(0);
    expect(r.inputTokens + r.outputTokens).toBe(r.totalTokens);
    expect(r.oracleDetail).toContain('d13');
    expect(r.transcriptPath).toBeUndefined(); // successes leave no transcript file
    expect(rows).toEqual(records); // writeRow saw exactly the returned rows
  });

  it('an agent that does nothing FAILS the oracle and leaves a failure transcript', async () => {
    const records = await runMatrix(
      { ...baseConfig, taskIds: ['filter-red'], modalities: ['hcifootprint'] },
      {
        // Plain text, no tool calls — the assistant answers without acting.
        providerFactory: () => mock({ reply: 'All set!' }),
        transcriptDir: tmp,
      },
    );

    expect(records).toHaveLength(1);
    const r = records[0];
    expect(r.success).toBe(false);
    expect(r.errored).toBe(false); // clean run, wrong outcome — oracle catches it
    expect(r.oracleDetail).toContain('expected catalog filtered to red-only');
    expect(r.transcriptPath).toBeDefined();
    expect(existsSync(r.transcriptPath!)).toBe(true);
    const transcript = readFileSync(r.transcriptPath!, 'utf8');
    expect(transcript).toContain("TASK: Using the catalog's color filter");
    expect(r.llmCalls).toBeGreaterThan(0); // the meter counted the mock call(s)
  });

  it('a run past the wall-clock cap is killed and recorded as a timeout failure', async () => {
    const records = await runMatrix(
      { ...baseConfig, taskIds: ['open-emerald'], modalities: ['dom-dump'], timeoutMs: 40 },
      {
        providerFactory: () => mock({ reply: 'slow…', thinkingMs: 500 }),
        transcriptDir: tmp,
      },
    );

    const r = records[0];
    expect(r.timedOut).toBe(true);
    expect(r.success).toBe(false);
    expect(r.errored).toBe(true);
    expect(r.reply).toBe('[timeout]');
    expect(r.transcriptPath).toBeDefined();
  });

  it('auto-approves the confirm gate: pause → confirm(true) → resume, tokens still metered', async () => {
    // Script the assistant to call request_confirmation (its real HITL tool):
    // the run PAUSES, the harness must auto-approve and resume, and the resumed
    // LLM call must land in the same token meter. Pilot 1 note: this path never
    // fired live because the 16-turn cap exhausted first — this test pins the
    // wiring itself, independent of model behavior.
    const records = await runMatrix(
      { ...baseConfig, taskIds: ['buy-denim-pinafore'], modalities: ['hcifootprint'] },
      {
        providerFactory: () =>
          mock({
            replies: [
              {
                toolCalls: [
                  {
                    id: 'c1',
                    name: 'request_confirmation',
                    args: { affordanceId: 'checkout.place-order', summary: 'Place the order for $58?' },
                  },
                ],
              },
              'Order placed after your approval.',
            ],
          }),
        transcriptDir: tmp,
      },
    );

    expect(records).toHaveLength(1);
    const r = records[0];
    expect(r.confirmations).toBe(1); // the gate was crossed via auto-approval
    expect(r.reply).toBe('Order placed after your approval.');
    expect(r.llmCalls).toBe(2); // pre-pause call + post-resume call, both metered
    expect(r.errored).toBe(false);
    // The oracle still fails (no order was actually placed — the mock never drove
    // the purchase steps): approval plumbing must never be mistaken for success.
    expect(r.success).toBe(false);
    const transcript = readFileSync(r.transcriptPath!, 'utf8');
    expect(transcript).toContain('auto-approved: Place the order for $58?');
  });

  it('with autoApprove OFF a confirm pause is declined and recorded', async () => {
    const records = await runMatrix(
      { ...baseConfig, taskIds: ['buy-denim-pinafore'], modalities: ['hcifootprint'], autoApprove: false },
      {
        providerFactory: () =>
          mock({
            replies: [
              {
                toolCalls: [
                  { id: 'c1', name: 'request_confirmation', args: { affordanceId: 'checkout.place-order', summary: 'Place it?' } },
                ],
              },
              'Understood — not placing the order.',
            ],
          }),
        transcriptDir: tmp,
      },
    );
    const r = records[0];
    expect(r.confirmations).toBe(0);
    expect(r.success).toBe(false);
    expect(r.reply).toBe('Understood — not placing the order.'); // the declined agent wraps up
    const transcript = readFileSync(r.transcriptPath!, 'utf8');
    expect(transcript).toContain('declined: Place it?');
  });

  it('runs the full 2×2 sub-matrix and emits one row per cell', async () => {
    const records = await runMatrix(
      { ...baseConfig, taskIds: ['open-emerald', 'filter-red'], modalities: ['dom-dump', 'hcifootprint'] },
      {
        providerFactory: () => mock({ reply: 'noop' }),
        transcriptDir: tmp,
      },
    );
    expect(records).toHaveLength(4);
    const keys = records.map((r) => `${r.taskId}/${r.modality}`);
    expect(new Set(keys).size).toBe(4);
  });
});
