/**
 * A minimal per-run host for the REAL storefront — the ax-tree modality's app
 * surface. Serves the exact same PAGE html the human uses (src/web/page.ts)
 * plus the two endpoints its inline script needs: /api/view (render state) and
 * /api/app (the app's own handlers, as the buttons call them). No assistant, no
 * MCP, no debugger — the browser-driving agent IS the user here.
 *
 * The DressShop instance is supplied by the caller (the modality), so the
 * benchmark oracle reads the same object the browser drives.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { DressShop } from '../src/app/shop.js';
import { PAGE } from '../src/web/page.js';

export interface ShopHost {
  /** http://127.0.0.1:<port> */
  readonly url: string;
  close(): Promise<void>;
}

export async function startShopHost(shop: DressShop): Promise<ShopHost> {
  // The PAGE polls /api/view and re-renders when `version` changes — mirror the
  // session's version counter with a plain local one.
  let version = 0;
  shop.subscribe(() => {
    version++;
  });
  shop.onNavigate(() => {
    version++;
  });

  const server = http.createServer((req, res) => {
    void (async () => {
      const send = (status: number, body: unknown, type = 'application/json'): void => {
        res.writeHead(status, { 'content-type': type });
        res.end(type === 'application/json' ? JSON.stringify(body) : String(body));
      };
      try {
        if (req.method === 'GET' && req.url === '/') {
          return send(200, PAGE, 'text/html; charset=utf-8');
        }
        if (req.method === 'GET' && req.url === '/api/view') {
          const s = shop.state;
          return send(200, {
            node: s.page,
            version,
            results: s.results,
            activeColor: s.activeColor,
            selectedDress: s.selectedDress,
            cart: s.cart,
            orders: s.orders.map((o) => ({ id: o.id, total: o.total, status: o.status, count: o.items.length })),
            lastOrder: s.lastOrder ? { id: s.lastOrder.id, total: s.lastOrder.total } : null,
            orderStatusMessage: s.orderStatusMessage,
            gaps: 0,
            awaitingConfirmation: false,
            mode: 'bench', // footer badge only; the storefront renders regardless
          });
        }
        if (req.method === 'POST' && req.url === '/api/app') {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const { method, args } = (chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}) as {
            method?: string;
            args?: Record<string, unknown>;
          };
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
              default: return send(400, { ok: false, error: 'unknown method' });
            }
            return send(200, { ok: true });
          } catch (error) {
            return send(200, { ok: false, error: String(error instanceof Error ? error.message : error) });
          }
        }
        // Endpoints the full demo server has but the bench host deliberately
        // doesn't (chat, activity, health, debug): answer harmlessly.
        if (req.method === 'GET' && req.url === '/api/activity') return send(200, { active: false, steps: [] });
        send(404, { error: 'not part of the bench host' });
      } catch (error) {
        send(500, { error: String(error) });
      }
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}
