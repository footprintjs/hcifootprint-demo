/**
 * Local web front-end for the dress-shop assistant — a real browser URL.
 *
 * Dependency-free (Node's built-in http). One process holds one shop + session
 * + assistant (single-user local demo). Endpoints:
 *   GET  /             → the chat UI (inline HTML)
 *   POST /api/chat     → { message } → a reply, or a confirmation request
 *   POST /api/confirm  → { approved } → resumes the paused agent run
 *   GET  /api/inspect  → live projected state, cursor, and the gap ledger
 *
 * Run: npm run serve   (reads .env for ANTHROPIC_API_KEY)
 */
import http from 'node:http';
import Anthropic from '@anthropic-ai/sdk';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { DressShop } from '../app/shop.js';
import { connectShop } from '../agent-layer/connect.js';
import { connectDirect, connectOverMcp } from '../agent-layer/mcp-bridge.js';
import { checkGraph } from 'hcifootprint/testing';
import { dressShopGraph } from '../agent-layer/graph.js';
import { driftedDressShopGraph } from '../drift/drifted-graph.js';
import { loadDotEnv } from '../chatbot/env.js';
import { createAssistant } from '../chatbot/assistant.js';
import type { TurnResult } from '../chatbot/assistant.js';
import { PAGE } from './page.js';
import { DEBUG_PAGE } from './debug-page.js';

loadDotEnv();

// HCI_MODE=direct → the assistant calls the session in-process; anything else
// (default) → it drives the session over a REAL MCP connection (see mcp-bridge).
// Same behavior either way — the MCP layer is plumbing, not logic.
const MODE: 'mcp' | 'direct' = process.env['HCI_MODE'] === 'direct' ? 'direct' : 'mcp';

// Serve the LOCAL AgentThinkingUI build (not the CDN) so the debugger uses our
// hardened proxy behavior + works offline. Read once at boot.
const require2 = createRequire(import.meta.url);
const ATUI_UMD = readFileSync(require2.resolve('agentthinkingui/umd'), 'utf8');
const ATUI_CSS = readFileSync(require2.resolve('agentthinkingui/styles.css'), 'utf8');
const EXPLAIN_MODEL = process.env['ANTHROPIC_MODEL'] ?? 'claude-opus-4-8';

// Live progress for the dock: the assistant emits a status before each tool
// runs; we buffer the current turn's steps so the browser can poll and show
// what's happening ("Searching the catalog…") instead of a static "thinking".
let activity: string[] = [];
let turnActive = false;

/**
 * One live app instance: a fresh shop + session + MCP/direct port + assistant.
 * "New session" (POST /api/reset) swaps this out — the whole point of the
 * library is that a session is cheap and ephemeral, so starting fresh just
 * means building a new one, not resetting state in place.
 */
interface Live {
  shop: DressShop;
  session: ReturnType<typeof connectShop>;
  appMcp: Awaited<ReturnType<typeof connectOverMcp>>;
  assistant: ReturnType<typeof createAssistant>;
}

async function buildLive(): Promise<Live> {
  const shop = new DressShop();
  const session = connectShop(shop);
  const appMcp = MODE === 'mcp' ? await connectOverMcp(session) : connectDirect(session);
  const assistant = createAssistant(session, appMcp, {
    onActivity: (status) => {
      activity.push(status);
      if (activity.length > 24) activity.shift();
    },
  });
  return { shop, session, appMcp, assistant };
}

let live = await buildLive();

/** Run one assistant turn with a fresh activity buffer the browser can poll. */
async function withActivity(run: () => Promise<TurnResult>): Promise<TurnResult> {
  activity = [];
  turnActive = true;
  try {
    return await run();
  } finally {
    turnActive = false;
  }
}

function turnToJSON(turn: TurnResult): Record<string, unknown> {
  return turn.type === 'confirm'
    ? { type: 'confirm', summary: turn.question.summary, affordanceId: turn.question.affordanceId }
    : { type: 'reply', text: turn.text };
}

async function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

function send(res: http.ServerResponse, status: number, body: unknown, type = 'application/json'): void {
  const payload = type === 'application/json' ? JSON.stringify(body) : String(body);
  res.writeHead(status, { 'content-type': type });
  res.end(payload);
}

const server = http.createServer((req, res) => {
  void (async () => {
    try {
      const { shop, session, assistant } = live; // the current instance for this request
      if (req.method === 'GET' && req.url === '/') {
        return send(res, 200, PAGE, 'text/html; charset=utf-8');
      }
      if (req.method === 'GET' && (req.url === '/debug' || req.url?.startsWith('/debug?'))) {
        // The agent debugger — atui renders the live reasoning trace. `?embed=1`
        // strips the chrome for iframing inside the storefront modal.
        return send(res, 200, DEBUG_PAGE, 'text/html; charset=utf-8');
      }
      if (req.method === 'GET' && req.url === '/api/trace') {
        // The current turn's reasoning as an AgentThinkingUI trace (grows live).
        return send(res, 200, live.assistant.trace());
      }
      if (req.method === 'GET' && req.url === '/vendor/atui.umd.js') {
        return send(res, 200, ATUI_UMD, 'application/javascript; charset=utf-8');
      }
      if (req.method === 'GET' && req.url === '/vendor/atui.css') {
        return send(res, 200, ATUI_CSS, 'text/css; charset=utf-8');
      }
      if (req.method === 'POST' && req.url === '/api/explain') {
        // The REAL "why this tool?" — hand atui's prepared prompt (task +
        // trajectory + tool menu) to Claude for the model's own reasoning.
        // This is what replaces the misleading lexical proxy.
        const { prompt } = (await readBody(req)) as { prompt?: string };
        try {
          const client = new Anthropic(); // reads ANTHROPIC_API_KEY from .env
          const message = await client.messages.create({
            model: EXPLAIN_MODEL,
            max_tokens: 500,
            messages: [{ role: 'user', content: String(prompt ?? '') }],
          });
          const reason = message.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
          return send(res, 200, { reason });
        } catch (error) {
          return send(res, 200, { error: String(error instanceof Error ? error.message : error) });
        }
      }
      if (req.method === 'POST' && req.url === '/api/reset') {
        // Start fresh: build a brand-new shop + session + assistant, then close
        // the old MCP connection. Nothing is reset in place — a session is cheap.
        const old = live;
        live = await buildLive();
        activity = [];
        await old.appMcp.close().catch(() => undefined);
        return send(res, 200, { ok: true });
      }
      if (req.method === 'GET' && req.url === '/api/health') {
        // The one-call health verdict for the live graph, and a deliberately
        // drifted example — the "Graph health" panel toggles between them.
        const initialState = {
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
        return send(res, 200, {
          real: checkGraph(dressShopGraph(), { initialState }),
          drifted: checkGraph(driftedDressShopGraph(), { initialState }),
        });
      }
      if (req.method === 'GET' && req.url === '/api/inspect') {
        return send(res, 200, {
          node: session.node,
          version: session.version,
          state: session.state(),
          gaps: session.gaps(),
        });
      }
      if (req.method === 'GET' && req.url === '/api/view') {
        // Everything the storefront renders — the SAME shop instance the agent drives.
        const shopState = shop.state;
        return send(res, 200, {
          node: session.node,
          version: session.version,
          results: shopState.results,
          activeColor: shopState.activeColor,
          selectedDress: shopState.selectedDress,
          cart: shopState.cart,
          orders: shopState.orders.map((order) => ({
            id: order.id,
            total: order.total,
            status: order.status,
            count: order.items.length,
          })),
          lastOrder: shopState.lastOrder ? { id: shopState.lastOrder.id, total: shopState.lastOrder.total } : null,
          orderStatusMessage: shopState.orderStatusMessage,
          gaps: session.gaps().length,
          awaitingConfirmation: assistant.awaitingConfirmation,
          mode: MODE,
        });
      }
      if (req.method === 'POST' && req.url === '/api/app') {
        // The website's buttons — they call the app's OWN handlers, exactly as a
        // human click would. The agent layer sees this motion only through its
        // taps (store subscription + router events); nothing here touches the
        // session directly. Human and agent drive one and the same app.
        const { method, args } = (await readBody(req)) as { method?: string; args?: Record<string, unknown> };
        try {
          switch (method) {
            case 'browseCatalog': shop.browseCatalog(); break;
            case 'search': shop.search(String(args?.['query'] ?? '')); break;
            case 'filterByColor': shop.filterByColor(String(args?.['color'] ?? '')); break;
            case 'openDress': shop.openDress(String(args?.['dressId'] ?? '')); break;
            case 'addToCart': shop.addToCart(); break;
            case 'openCart': shop.openCart(); break;
            case 'checkout': shop.checkout(); break;
            case 'placeOrder': shop.placeOrder(); break;
            case 'openOrders': shop.openOrders(); break;
            case 'checkOrderStatus': shop.checkOrderStatus(String(args?.['orderId'] ?? '')); break;
            case 'navigate': shop.navigate(String(args?.['page'] ?? 'home') as Parameters<typeof shop.navigate>[0]); break;
            default: return send(res, 400, { ok: false, error: 'unknown method' });
          }
          return send(res, 200, { ok: true });
        } catch (error) {
          return send(res, 200, { ok: false, error: String(error instanceof Error ? error.message : error) });
        }
      }
      if (req.method === 'GET' && req.url === '/api/activity') {
        // Polled by the dock while a turn is in flight — the latest line is shown live.
        return send(res, 200, { active: turnActive, steps: activity });
      }
      if (req.method === 'POST' && req.url === '/api/chat') {
        const { message } = await readBody(req);
        if (typeof message !== 'string' || !message.trim()) {
          return send(res, 400, { error: 'message required' });
        }
        return send(res, 200, turnToJSON(await withActivity(() => assistant.send(message))));
      }
      if (req.method === 'POST' && req.url === '/api/confirm') {
        const { approved } = await readBody(req);
        return send(res, 200, turnToJSON(await withActivity(() => assistant.confirm(approved === true))));
      }
      send(res, 404, { error: 'not found' });
    } catch (error) {
      const message = String(error);
      const credProblem = message.toLowerCase().includes('api key') || message.includes('401');
      send(res, credProblem ? 401 : 500, {
        error: credProblem ? 'No usable Claude API key — put ANTHROPIC_API_KEY in dress-shop/.env.' : message,
      });
    }
  })();
});

const PORT = Number(process.env['PORT'] ?? 5178);
server.listen(PORT, () => {
  const transport = MODE === 'mcp' ? 'over MCP (real protocol)' : 'direct (in-process, no MCP)';
  console.log(`\n  dress-shop assistant [${transport}] → http://localhost:${PORT}\n`);
  console.log('  Try: "find me a red floral dress and buy it" — you\'ll be asked to confirm the order.');
  console.log('  The right panel shows live app state and the gap ledger.\n');
});
