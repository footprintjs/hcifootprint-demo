/**
 * THE INTEGRATION — every line in this repo that touches HCIFootprint lives in
 * this file and graph.ts. The application (src/app/) is not modified at all;
 * the layer attaches through the three wires any app already exposes:
 *
 *   wire 1  store subscription  →  session.updateState(delta)     (the tap)
 *   wire 2  router events       →  registerTools + session.sync   (mount/unmount + cursor)
 *   wire 3  existing handlers   →  registered by REFERENCE        (fire() executes them)
 */
import type { Session, ToolHandler } from 'hcifootprint';
import type { DressShop, Page, ShopState } from '../app/shop.js';
import { dressShopGraph } from './graph.js';

/** The lean projection the agent layer watches — flat keys the guards can read. */
export function project(state: Readonly<ShopState>): Record<string, unknown> {
  return {
    resultIds: state.results.map((d) => d.id),
    resultCount: state.results.length,
    // Runtime DATA (may contain user-generated text) — never becomes planner instructions:
    resultNames: state.results.map((d) => d.name),
    activeColor: state.activeColor ?? '',
    selectedDressId: state.selectedDress?.id ?? '',
    selectedDressName: state.selectedDress?.name ?? '',
    cartIds: state.cart.map((d) => d.id),
    cartCount: state.cart.length,
    orderCount: state.orders.length,
    lastOrderId: state.lastOrder?.id ?? '',
    orderStatusMessage: state.orderStatusMessage ?? '',
  };
}

/** Which of the app's EXISTING handlers is live on which page (mirrors what is rendered). */
function pageTools(shop: DressShop): Record<Page, Record<string, ToolHandler>> {
  return {
    home: {
      'browse-dresses': () => shop.browseCatalog(),
      'view-orders': () => shop.openOrders(),
    },
    catalog: {
      'search-dresses': (payload) => shop.search((payload as { query: string }).query),
      'filter-by-color': (payload) => shop.filterByColor((payload as { color: string }).color),
      'view-dress': (payload) => shop.openDress((payload as { dressId: string }).dressId),
      'go-to-cart': () => shop.openCart(),
      'view-orders': () => shop.openOrders(),
    },
    product: {
      'add-to-cart': () => shop.addToCart(),
      'go-to-cart': () => shop.openCart(),
    },
    cart: {
      'proceed-to-checkout': () => shop.checkout(),
      'view-orders': () => shop.openOrders(),
    },
    checkout: {
      'place-order': () => shop.placeOrder(),
      'view-orders': () => shop.openOrders(),
    },
    orders: {
      'check-order-status': (payload) => shop.checkOrderStatus((payload as { orderId: string }).orderId),
    },
  };
}

/** Attach the agent layer to a running shop. Purely additive — the shop never knows. */
export function connectShop(shop: DressShop, opts?: { onWarn?: (m: string) => void }): Session {
  const graph = dressShopGraph();
  const session = graph.createSession({
    node: shop.state.page,
    state: project(shop.state),
    onWarn: opts?.onWarn,
  });
  const tools = pageTools(shop);

  // wire 1 — the tap
  shop.subscribe((next, previous) => {
    const delta = shallowDelta(project(previous), project(next));
    if (Object.keys(delta).length > 0) session.updateState(delta);
  });

  // wire 2 — the router (+ lazy tool groups)
  const mount = (page: Page, previous?: Page): void => {
    if (previous) session.unregisterGroup(`page:${previous}`);
    session.registerTools({ group: `page:${page}`, tools: tools[page] });
    session.sync(page);
  };
  shop.onNavigate((page, previous) => mount(page, previous));
  mount(shop.state.page);

  return session;
}

function shallowDelta(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const delta: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(next)) {
    if (JSON.stringify(previous[key]) !== JSON.stringify(value)) delta[key] = value;
  }
  return delta;
}
