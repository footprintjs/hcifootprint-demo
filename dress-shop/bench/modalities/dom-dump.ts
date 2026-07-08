/**
 * Modality B — the DOM baseline ("perceive the app each turn").
 *
 * The SAME agentfootprint Agent loop, the SAME model, the SAME token meter as
 * modality A — the ONLY difference is the tool surface. Instead of a typed
 * skill graph with readySteps, the agent gets four generic browser tools over
 * a reader-mode serialization of the real storefront: read_page / click / fill
 * / goto, all operating the SAME DressShop the human clicks (see render-html.ts).
 *
 * Fairness levers (see bench/README notes):
 *   • Every action tool RETURNS the resulting page HTML, so the agent never
 *     has to spend a turn re-reading after acting — the leanest baseline.
 *   • The HTML is script/style-free and every control carries a data-testid,
 *     so no token is wasted on chrome and no click is ambiguous.
 *   • The system prompt teaches the browsing method at the same specificity as
 *     modality A's, and leaks no task answers.
 */
import { Agent, defineTool, isPaused } from 'agentfootprint';
import { DressShop } from '../../src/app/shop.js';
import { StorefrontView } from './render-html.js';
import type { Modality, ModalityRunOptions, ModalityRunResult } from './types.js';
import type { BenchTask } from '../tasks.js';

const DOM_SYSTEM = `You are an autonomous web agent operating a live dress-store website through a browser.
You cannot see images — you read each page as HTML. Every interactive element carries a data-testid
attribute and visible text.

Your tools:
1. read_page() — returns the current page's HTML.
2. goto(path) — open a URL path: "/", "/dresses", "/dresses/<id>", "/cart", "/orders", "/checkout".
3. fill(selector, value) — type into a field (the search box).
4. click(selector) — click an element. Prefer its data-testid (e.g. "nav-cart", "view-d3", "place-order");
   the visible text also works. click, fill, and goto ALREADY return the resulting page HTML, so you do
   not need to call read_page again after acting.

Method, every turn: read what the page shows, choose the single UI action that moves you forward, do it,
then read the HTML that comes back. Repeat until the task is done.
- To search the catalog: fill the search box, then click "search-run".
- To narrow by color: on the catalog, click the color's filter button (e.g. "filter-red").
- To buy a dress: open it (its "view-<id>" link), click "add-to-cart", open the cart ("nav-cart"),
  click "checkout", then click "place-order".
- Dress ids like d3 appear as data-dress-id and inside the "view-<id>" testids; each card's text lists
  its name, color, size, and price. Use the exact id shown — never invent one.
When the task is complete, reply in one short sentence describing what you did. If nothing on the site
can serve the request, say so plainly.`;

export const domDumpModality: Modality = {
  id: 'dom-dump',
  label: 'DOM baseline (read HTML)',
  async run(task: BenchTask, opts: ModalityRunOptions): Promise<{ shop: DressShop; result: ModalityRunResult }> {
    const shop = new DressShop(opts.catalog);
    task.setup?.(shop);
    const view = new StorefrontView(shop);

    const log: string[] = [`TASK: ${task.instruction}`];
    const note = (line: string): void => {
      log.push(line);
      opts.onActivity?.(line);
    };

    const readPage = defineTool({
      name: 'read_page',
      description: 'Return the current storefront page as HTML. Call this first to see where you are.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      execute: () => {
        note('read_page');
        return view.html();
      },
    });

    const click = defineTool({
      name: 'click',
      description:
        'Click an interactive element by its data-testid (preferred) or visible text. Returns { ok, message, page } ' +
        'where page is the resulting HTML.',
      inputSchema: {
        type: 'object',
        properties: { selector: { type: 'string', description: 'data-testid or visible text of the element' } },
        required: ['selector'],
        additionalProperties: false,
      },
      execute: (args: { selector: string }) => {
        const r = view.click(args.selector);
        note(`click(${args.selector}) → ${r.ok ? 'ok' : 'fail'}: ${r.message}`);
        return JSON.stringify({ ok: r.ok, message: r.message, page: r.html });
      },
    });

    const fill = defineTool({
      name: 'fill',
      description: 'Type a value into a field (the search box). Returns { ok, message, page }.',
      inputSchema: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'data-testid of the field, e.g. "search-input"' },
          value: { type: 'string' },
        },
        required: ['selector', 'value'],
        additionalProperties: false,
      },
      execute: (args: { selector: string; value: string }) => {
        const r = view.fill(args.selector, args.value);
        note(`fill(${args.selector}, "${args.value}") → ${r.ok ? 'ok' : 'fail'}`);
        return JSON.stringify({ ok: r.ok, message: r.message, page: r.html });
      },
    });

    const goto = defineTool({
      name: 'goto',
      description: 'Open a URL path (/, /dresses, /dresses/<id>, /cart, /orders, /checkout). Returns { ok, message, page }.',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
        additionalProperties: false,
      },
      execute: (args: { path: string }) => {
        const r = view.goto(args.path);
        note(`goto(${args.path}) → ${r.ok ? 'ok' : 'fail'}: ${r.message}`);
        return JSON.stringify({ ok: r.ok, message: r.message, page: r.html });
      },
    });

    const agent = Agent.create({ provider: opts.provider, name: 'dom-baseline', model: 'anthropic' })
      .system(DOM_SYSTEM)
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
      // The raw DressShop has no confirm gate — the DOM baseline never pauses.
      reply = isPaused(out) ? '[unexpected pause]' : String(out);
    } catch (error) {
      errored = true;
      reply = `[error] ${error instanceof Error ? error.message : String(error)}`;
    }
    log.push(`REPLY: ${reply}`);

    return { shop, result: { reply, transcript: log.join('\n'), errored, confirmations: 0 } };
  },
};
