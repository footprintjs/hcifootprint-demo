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
import { DressShop } from '../app/shop.js';
import { connectShop } from '../agent-layer/connect.js';
import { connectDirect, connectOverMcp } from '../agent-layer/mcp-bridge.js';
import { loadDotEnv } from '../chatbot/env.js';
import { createAssistant } from '../chatbot/assistant.js';
import type { TurnResult } from '../chatbot/assistant.js';
import { PAGE } from './page.js';

loadDotEnv();

const shop = new DressShop();
const session = connectShop(shop);
// HCI_MODE=direct → the assistant calls the session in-process; anything else
// (default) → it drives the session over a REAL MCP connection (see mcp-bridge).
// Same behavior either way — the MCP layer is plumbing, not logic.
const MODE: 'mcp' | 'direct' = process.env['HCI_MODE'] === 'direct' ? 'direct' : 'mcp';
const appMcp = MODE === 'mcp' ? await connectOverMcp(session) : connectDirect(session);

// Live progress for the dock: the assistant emits a status before each tool
// runs; we buffer the current turn's steps so the browser can poll and show
// what's happening ("Searching the catalog…") instead of a static "thinking".
let activity: string[] = [];
let turnActive = false;
const assistant = createAssistant(session, appMcp, {
  onActivity: (status) => {
    activity.push(status);
    if (activity.length > 24) activity.shift();
  },
});

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
      if (req.method === 'GET' && req.url === '/') {
        return send(res, 200, PAGE, 'text/html; charset=utf-8');
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
