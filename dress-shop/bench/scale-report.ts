/**
 * The scaling matrix — catalog size × modality, cell = total tokens for the
 * SAME task (open-emerald). A failed cell is printed with a ✗ so a cheap
 * "win" by giving up early can never masquerade as efficiency.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { RESULTS_DIR } from './config.js';
import { readRecords } from './report.js';
import type { ScaleRecord } from './scale.js';

/** Latest row per {size × modality} (reruns supersede). */
export function latestScaleCells(records: readonly ScaleRecord[]): ScaleRecord[] {
  const byCell = new Map<string, ScaleRecord>();
  for (const r of records) {
    const key = `${r.size}|${r.modality}`;
    const prior = byCell.get(key);
    if (!prior || r.ts >= prior.ts) byCell.set(key, r);
  }
  return [...byCell.values()];
}

const fmtTok = (r: ScaleRecord | undefined): string =>
  r === undefined ? '—' : `${r.success ? '' : '✗'}${r.totalTokens}`;

export function formatScaleMatrix(records: readonly ScaleRecord[]): string {
  if (records.length === 0) return 'No scale runs found. Run `npm run bench:scale` first.';
  const cells = latestScaleCells(records);
  const sizes = [...new Set(cells.map((r) => r.size))].sort((a, b) => a - b);
  const modalities = [...new Set(cells.map((r) => r.modality))];
  const cell = (size: number, m: string) => cells.find((r) => r.size === size && r.modality === m);

  const lines: string[] = [];
  lines.push('Scaling matrix — total tokens for the SAME task (open-emerald) as the app grows');
  lines.push('(✗ prefix = that run failed its oracle; surface = one full-catalog perception, chars)');
  lines.push('═'.repeat(80));
  const w = [10, ...modalities.map(() => 22)];
  lines.push(pad(['catalog N', ...modalities.map((m) => `${m} tok (surface)`)], w));
  lines.push(pad(w.map((x) => '─'.repeat(x)), w));
  for (const size of sizes) {
    lines.push(
      pad(
        [
          String(size),
          ...modalities.map((m) => {
            const r = cell(size, m);
            if (!r) return '—';
            const surface = r.surfaceChars > 0 ? ` (${r.surfaceChars})` : '';
            return `${fmtTok(r)}${surface}`;
          }),
        ],
        w,
      ),
    );
  }

  // Growth line: tokens at max N over tokens at min N, per modality.
  const nMin = sizes[0];
  const nMax = sizes[sizes.length - 1];
  if (sizes.length >= 2) {
    lines.push('');
    for (const m of modalities) {
      const lo = cell(nMin, m);
      const hi = cell(nMax, m);
      if (lo && hi && lo.totalTokens > 0) {
        lines.push(
          `${m}: ${lo.totalTokens} → ${hi.totalTokens} tokens (${(hi.totalTokens / lo.totalTokens).toFixed(2)}× from N=${nMin} to N=${nMax})`,
        );
      }
    }
  }
  return lines.join('\n');
}

function pad(cells: string[], widths: number[]): string {
  return cells.map((c, i) => c.padEnd(widths[i])).join('  ');
}

function main(): void {
  const file = process.argv[2] ?? join(RESULTS_DIR, 'scale.jsonl');
  if (!existsSync(file)) {
    console.error(`No scale results at ${file}. Run \`npm run bench:scale\` first.`);
    process.exit(1);
  }
  console.log(`\nReading ${file}\n`);
  console.log(formatScaleMatrix(readRecords(file) as unknown as ScaleRecord[]));
  console.log('');
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) main();
