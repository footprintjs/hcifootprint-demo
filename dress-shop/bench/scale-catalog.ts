/**
 * Catalog variants for the scaling experiment — grow the app's CONTENT around
 * a fixed task. Deterministic (no RNG): the same N always yields byte-identical
 * data, so scale runs are reproducible.
 *
 * Invariants the fixed task (open-emerald) depends on:
 *   • d13 "Emerald Satin Wrap" is present in EVERY variant, exactly once.
 *   • No generated name contains "emerald" (or "satin wrap"), so searching
 *     stays exactly as discriminative at N=500 as at N=15 — the growth measures
 *     SURFACE size, not task difficulty.
 *   • Generated colors come from the storefront's 7-color palette so the real
 *     web UI renders every card and filter normally.
 */
import { DRESSES } from '../src/app/data.js';
import type { Dress } from '../src/app/data.js';

const COLORS = ['red', 'black', 'white', 'blue', 'green', 'pink', 'yellow'] as const;
const SIZES = ['XS', 'S', 'M', 'L'] as const;
const FABRICS = ['Linen', 'Cotton', 'Chiffon', 'Velvet', 'Jersey', 'Tweed', 'Denim', 'Crepe', 'Organza', 'Poplin'] as const;
const STYLES = ['Shift', 'A-Line', 'Maxi', 'Midi', 'Slip', 'Tea Dress', 'Sundress', 'Sheath', 'Smock', 'Pinafore'] as const;

/** Dress ids the storefront's static home preview links to (must resolve). */
const PREVIEW_IDS = ['d2', 'd3', 'd8', 'd10'];
/** The fixed task's target. */
const TARGET_ID = 'd13';

/**
 * A catalog of exactly `n` dresses. n <= 15 subsets the demo catalog (target +
 * home-preview dresses first, then the rest in order); n > 15 appends
 * deterministic filler with ids gen-16 … gen-N.
 */
export function makeCatalog(n: number): Dress[] {
  if (n < 5) throw new Error('makeCatalog: n must be at least 5 (target + the 4 preview dresses).');
  if (n <= DRESSES.length) {
    const priority = [TARGET_ID, ...PREVIEW_IDS];
    const first = DRESSES.filter((d) => priority.includes(d.id));
    const rest = DRESSES.filter((d) => !priority.includes(d.id));
    return [...first, ...rest].slice(0, n).sort(byCatalogOrder);
  }
  const filler: Dress[] = [];
  for (let i = DRESSES.length + 1; i <= n; i++) {
    filler.push({
      id: `gen-${i}`,
      name: `${FABRICS[i % FABRICS.length]} ${STYLES[i % STYLES.length]} No. ${i}`,
      color: COLORS[i % COLORS.length],
      size: SIZES[i % SIZES.length],
      price: 40 + ((i * 7) % 200), // 40..239, deterministic spread
    });
  }
  return [...DRESSES, ...filler];
}

/** Keep demo dresses in their original order (stable ids d1..d15 sort naturally). */
function byCatalogOrder(a: Dress, b: Dress): number {
  return Number(a.id.slice(1)) - Number(b.id.slice(1));
}
