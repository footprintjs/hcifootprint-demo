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
import { loadDotEnv } from '../chatbot/env.js';
import { createAssistant } from '../chatbot/assistant.js';
import type { TurnResult } from '../chatbot/assistant.js';
import { PAGE } from './page.js';

loadDotEnv();

const shop = new DressShop();
const session = connectShop(shop);
const assistant = createAssistant(session);

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
      if (req.method === 'POST' && req.url === '/api/chat') {
        const { message } = await readBody(req);
        if (typeof message !== 'string' || !message.trim()) {
          return send(res, 400, { error: 'message required' });
        }
        return send(res, 200, turnToJSON(await assistant.send(message)));
      }
      if (req.method === 'POST' && req.url === '/api/confirm') {
        const { approved } = await readBody(req);
        return send(res, 200, turnToJSON(await assistant.confirm(approved === true)));
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
  console.log(`\n  dress-shop assistant → http://localhost:${PORT}\n`);
  console.log('  Try: "find me a red floral dress and buy it" — you\'ll be asked to confirm the order.');
  console.log('  The right panel shows live app state and the gap ledger.\n');
});
