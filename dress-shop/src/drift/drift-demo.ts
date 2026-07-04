/**
 * drift-demo — proof that hcifootprint/testing catches the graph drifting from
 * the app, BEFORE production. Run it:
 *
 *   npm run drift
 *
 * Three real things (the real linter + the real session — no mocks of the
 * harness itself):
 *   1. checkGraph() the REAL dress-shop graph — one call, healthy.
 *   2. checkGraph() a deliberately-DRIFTED copy (see drifted-graph.ts) — the
 *      findings come back grouped by the kind of drift a frontend dev knows:
 *      control (buttons/inputs), page, and flow (skills).
 *   3. Drive the purchase flow with a handler that quietly stopped doing what
 *      the graph declares — and catch the BEHAVIORAL drift via effectVerified.
 *
 * Every issue ends the same way: update the graph, or revert the app change —
 * the tool surfaces the drift, your team decides the fix.
 */
import { checkGraph, testApp } from 'hcifootprint/testing';
import { dressShopGraph } from '../agent-layer/graph.js';
import { driftedDressShopGraph } from './drifted-graph.js';

// The app's projected state at startup (see connect.ts `project()`), so the
// checker is GROUNDED — an unproducible key is a provable error, not a guess.
const PROJECTED_INITIAL = {
  resultIds: [] as string[],
  resultCount: 0,
  activeColor: '',
  selectedDressId: '',
  cartIds: [] as string[],
  cartCount: 0,
  orderCount: 0,
  lastOrderId: '',
  orderStatusMessage: '',
};

const rule = (label: string): string => `\n━━━ ${label} ${'━'.repeat(Math.max(0, 58 - label.length))}`;

async function main(): Promise<void> {
  // ── 1. Healthy baseline — one call ──────────────────────────────────────────
  console.log(rule('① HEALTHY BASELINE — the graph matches the app'));
  const healthy = checkGraph(dressShopGraph(), { initialState: PROJECTED_INITIAL });
  console.log('  ' + healthy.summary.split('\n').slice(1).join('\n  ').trim());

  // ── 2. After an app change: the graph drifted ──────────────────────────────
  console.log(rule('② AFTER AN APP CHANGE — the graph drifted'));
  const drifted = checkGraph(driftedDressShopGraph(), { initialState: PROJECTED_INITIAL });
  console.log(drifted.summary.split('\n').slice(1).join('\n')); // skip the title line
  console.log(`\n  Skills still feasible: ${drifted.skills.filter((s) => s.feasible).map((s) => s.id).join(', ') || '(none)'}`);
  console.log(`  Skills that can no longer finish: ${drifted.skills.filter((s) => !s.feasible).map((s) => s.id).join(', ') || '(none)'}`);

  // ── 3. Behavioral drift — a handler no longer matches its declared effect ────
  console.log(rule('③ BEHAVIORAL DRIFT — a handler no longer does what the graph declares'));
  const app = testApp(dressShopGraph(), {
    initialState: PROJECTED_INITIAL,
    resolvers: {
      'search-dresses': () => ({ patch: { resultIds: ['d1'], resultCount: 1 } }),
      'view-dress': (payload) => ({
        patch: { selectedDressId: (payload as { dressId?: string })?.dressId ?? 'd1' },
      }),
      // The real add-to-cart handler was changed and now forgets to update
      // cartIds — the graph still DECLARES writes: ['cartIds', 'cartCount'].
      'add-to-cart': (_p, { state }) => ({ patch: { cartCount: (state.cartCount as number) + 1 } }),
    },
  });

  await app.user.fire('browse-dresses'); // home → catalog
  await app.user.fire('search-dresses', { payload: { query: 'silk' } });
  await app.user.fire('view-dress', { payload: { dressId: 'd1' } }); // catalog → product
  await app.user.fire('add-to-cart'); // the drifted handler runs here

  const report = app.report();
  if (report.ok) {
    console.log('  ✓ every action changed exactly what the graph declares.');
  } else {
    console.log(`  ✗ ${report.effectDrift.length} action(s) drifted from their declared effect:\n`);
    for (const d of report.effectDrift) {
      console.log(`     • ${d.affordanceId} claims to write ${d.declaredWrites.join(', ')},`);
      console.log(`       but the handler's change did not cover that  (effectVerified = false).`);
      console.log(`       → Update the graph's writes to match the handler, or fix the handler. Your call.\n`);
    }
  }

  console.log(
    '\nEvery issue above is a choice: update the graph to match the app, or revert the app change.\n' +
      'hcifootprint/testing only surfaces the drift — your team owns the fix.\n',
  );
}

void main();
