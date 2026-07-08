/**
 * Modality C — the pruned accessibility-tree baseline (the honest rival).
 *
 * This is the SeeAct / WebArena / Playwright-MCP class of agent: a real
 * Chromium (playwright-core, cached headless shell) drives the REAL storefront
 * (src/web/page.ts served by bench/web-host.ts), and each turn the model sees
 * the page's ACCESSIBILITY snapshot — Playwright's own `_snapshotForAI()`, the
 * exact format `browser_snapshot` hands MCP agents: a YAML role/name/state
 * tree with stable `[ref=eN]` handles. Scripts and styles are absent by
 * construction (it is the AX tree, not the DOM). Measured at N=15, one full
 * catalog perception is ~6.5k chars here vs ~3.7k for dom-dump's reader-mode
 * serialization — the AX tree of the REAL page carries the whole storefront
 * (hero, footer, assistant button), where dom-dump renders a hand-tuned
 * minimal view. This modality is the ecosystem-standard baseline; dom-dump is
 * the hand-optimized one.
 *
 * Actions resolve refs via Playwright's `aria-ref=` selector engine — the same
 * mechanism Playwright MCP uses — so clicks are never ambiguous.
 *
 * Same Agent loop, same model, same token meter as the other two modalities.
 */
import { Agent, defineTool, isPaused } from 'agentfootprint';
import { chromium } from 'playwright-core';
import type { Page } from 'playwright-core';
import { DressShop } from '../../src/app/shop.js';
import { startShopHost } from '../web-host.js';
import type { Modality, ModalityRunOptions, ModalityRunResult } from './types.js';
import type { BenchTask } from '../tasks.js';

/** The cached headless shell (contract-pinned; playwright-core downloads nothing). */
export const CHROMIUM_EXECUTABLE =
  '/Users/sanjay/Library/Caches/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-mac-arm64/chrome-headless-shell';

/** The storefront re-renders right after each action's fetch round-trip. */
const SETTLE_MS = 250;

/**
 * Prune a snapshot for the model: drop `- /url:` child lines (the SPA's hrefs
 * are all "#" — pure noise) and the `[cursor=pointer]` decoration. Roles,
 * names, states, and [ref=eN] handles are untouched. Pure — unit-tested.
 */
export function pruneSnapshot(yaml: string): string {
  return yaml
    .split('\n')
    .filter((line) => !/^\s*-\s*\/url:/.test(line))
    .map((line) => line.replace(/ \[cursor=pointer\]/g, ''))
    .join('\n');
}

const AX_SYSTEM = `You are an autonomous web agent operating a live dress-store website through a real browser.
Each observation is the page's ACCESSIBILITY TREE: a YAML outline of roles, names, and states. Every
interactive element carries a [ref=eN] handle — refs are how you act on elements.

Your tools:
1. read_page() — returns the current page's accessibility tree.
2. click(ref) — click the element with that ref (e.g. "e12").
3. fill(ref, value) — type into the textbox with that ref (the search box).
4. goto(path) — "/" reloads the storefront. This is a single-page app: every other destination is
   reached by clicking its navigation button or link in the tree.
Every action returns the RESULTING accessibility tree, so you do not need read_page after acting.

Method, every turn: read the tree, pick the single element that moves the task forward, act on its ref,
then read the tree that comes back. Refs can change after a render — always use refs from the LATEST tree.
- The header has buttons: Home, Dresses, Cart, Orders. The catalog page has a search textbox, a Search
  button, color filter buttons (red, black, …), and one "View" link per dress card.
- A dress card shows its name, color, size, and price as text; click its "View" link to open it.
- To buy: open the dress, click "Add to cart", open the Cart, click "Proceed to checkout", then "Place order".
When the task is complete, reply in one short sentence describing what you did. If nothing on the site can
serve the request, say so plainly.`;

/** Snapshot the page, pruned. Falls back with a clear error if the API is missing. */
async function snapshot(page: Page): Promise<string> {
  const p = page as Page & { _snapshotForAI?: () => Promise<{ full: string } | string> };
  if (typeof p._snapshotForAI !== 'function') {
    throw new Error('playwright-core _snapshotForAI() unavailable — pin playwright-core@1.58.x');
  }
  const snap = await p._snapshotForAI();
  const full = typeof snap === 'string' ? snap : snap.full;
  return pruneSnapshot(full);
}

const normalizeRef = (ref: string): string => ref.trim().replace(/^\[?ref=/, '').replace(/\]$/, '');

export const axTreeModality: Modality = {
  id: 'ax-tree',
  label: 'AX-tree baseline (browser snapshot)',
  async run(task: BenchTask, opts: ModalityRunOptions): Promise<{ shop: DressShop; result: ModalityRunResult }> {
    const shop = new DressShop(opts.catalog);
    task.setup?.(shop);

    const host = await startShopHost(shop);
    const browser = await chromium.launch({ executablePath: CHROMIUM_EXECUTABLE });
    const page = await browser.newPage();
    await page.goto(host.url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(SETTLE_MS); // first client-side render

    const log: string[] = [`TASK: ${task.instruction}`];
    const note = (line: string): void => {
      log.push(line);
      opts.onActivity?.(line);
    };

    const settleAndSnapshot = async (): Promise<string> => {
      await page.waitForTimeout(SETTLE_MS);
      return snapshot(page);
    };

    const readPage = defineTool({
      name: 'read_page',
      description: 'Return the current page as an accessibility tree with [ref=eN] handles.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      execute: async () => {
        note('read_page');
        return snapshot(page);
      },
    });

    const click = defineTool({
      name: 'click',
      description: 'Click the element with the given ref from the latest tree. Returns { ok, message, page }.',
      inputSchema: {
        type: 'object',
        properties: { ref: { type: 'string', description: 'the [ref=eN] handle, e.g. "e12"' } },
        required: ['ref'],
        additionalProperties: false,
      },
      execute: async (args: { ref: string }) => {
        const ref = normalizeRef(args.ref);
        try {
          await page.locator(`aria-ref=${ref}`).click({ timeout: 3000 });
          note(`click(${ref}) → ok`);
          return JSON.stringify({ ok: true, message: `clicked ${ref}`, page: await settleAndSnapshot() });
        } catch (error) {
          const message = `click ${ref} failed: ${firstLine(error)}`;
          note(`click(${ref}) → fail`);
          return JSON.stringify({ ok: false, message, page: await settleAndSnapshot() });
        }
      },
    });

    const fill = defineTool({
      name: 'fill',
      description: 'Type a value into the textbox with the given ref. Returns { ok, message, page }.',
      inputSchema: {
        type: 'object',
        properties: { ref: { type: 'string' }, value: { type: 'string' } },
        required: ['ref', 'value'],
        additionalProperties: false,
      },
      execute: async (args: { ref: string; value: string }) => {
        const ref = normalizeRef(args.ref);
        try {
          await page.locator(`aria-ref=${ref}`).fill(args.value, { timeout: 3000 });
          note(`fill(${ref}, "${args.value}") → ok`);
          return JSON.stringify({
            ok: true,
            message: `typed "${args.value}" into ${ref} (click the Search button to run a search)`,
            page: await settleAndSnapshot(),
          });
        } catch (error) {
          note(`fill(${ref}) → fail`);
          return JSON.stringify({ ok: false, message: `fill ${ref} failed: ${firstLine(error)}`, page: await settleAndSnapshot() });
        }
      },
    });

    const goto = defineTool({
      name: 'goto',
      description: 'Reload the storefront ("/"). Other destinations are reached by clicking navigation in the tree.',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
        additionalProperties: false,
      },
      execute: async (args: { path: string }) => {
        if (args.path.trim() === '/' || args.path.trim() === '') {
          await page.goto(host.url, { waitUntil: 'domcontentloaded' });
          note('goto(/) → ok');
          return JSON.stringify({ ok: true, message: 'reloaded the storefront', page: await settleAndSnapshot() });
        }
        note(`goto(${args.path}) → not a route`);
        return JSON.stringify({
          ok: false,
          message: `this is a single-page app — '${args.path}' is not a URL route. Click the matching navigation button or link instead.`,
          page: await settleAndSnapshot(),
        });
      },
    });

    const agent = Agent.create({ provider: opts.provider, name: 'ax-tree-baseline', model: 'anthropic' })
      .system(AX_SYSTEM)
      .maxIterations(opts.maxIterations)
      .tool(readPage)
      .tool(click)
      .tool(fill)
      .tool(goto)
      .build();

    let reply = '';
    let errored = false;
    try {
      const out = await agent.run({ message: task.instruction });
      reply = isPaused(out) ? '[unexpected pause]' : String(out); // the raw app has no confirm gate
    } catch (error) {
      errored = true;
      reply = `[error] ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      await browser.close().catch(() => undefined);
      await host.close().catch(() => undefined);
    }
    log.push(`REPLY: ${reply}`);

    return { shop, result: { reply, transcript: log.join('\n'), errored, confirmations: 0 } };
  },
};

function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split('\n')[0];
}
