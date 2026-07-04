/**
 * A deliberately-DRIFTED copy of the dress-shop navigation graph.
 *
 * This is the "someone shipped an app change, the graph didn't keep up" state.
 * It is byte-for-byte the real graph (src/agent-layer/graph.ts) EXCEPT for the
 * three lines marked `// DRIFT` — each a realistic way the graph goes stale as
 * the app evolves. The drift-demo runs the linter against BOTH and shows the
 * exact regressions the harness catches. The real app is untouched.
 *
 *   DRIFT 1 (control): add-to-cart's enable rule now reads state the app never
 *                      produces — as if the button's disable logic changed.
 *   DRIFT 2 (page):    a `wishlist` page nothing navigates to — as if the app
 *                      removed its entry point but the graph kept the page.
 *   DRIFT 3 (flow):    a `gift-order` skill whose step is gated on removed
 *                      eligibility state — a skill that can never finish.
 */
import { buildNavigationGraph } from 'hcifootprint';
import type { Binding } from 'hcifootprint';

const btn = (name: string): Binding =>
  ({ kind: 'element', locator: { role: 'button', name }, actuation: 'click' });
const link = (name: string): Binding =>
  ({ kind: 'element', locator: { role: 'link', name }, actuation: 'click' });

export function driftedDressShopGraph() {
  return buildNavigationGraph('dress-shop', {
    does: 'A small dress store',
    pages: {
      home: {
        route: '/',
        tools: {
          'browse-dresses': { does: 'Browse the dress catalog', binding: link('Shop dresses'), goTo: 'catalog' },
        },
      },
      catalog: {
        route: '/dresses',
        tools: {
          'search-dresses': {
            does: 'Search dresses by name or color',
            binding: { kind: 'element', locator: { role: 'searchbox', name: 'Search' }, actuation: 'type' },
            input: {
              type: 'object',
              properties: { query: { type: 'string' } },
              required: ['query'],
              additionalProperties: false,
            },
            writes: ['resultIds', 'resultCount'],
          },
          'filter-by-color': {
            does: 'Filter the current results by color',
            binding: { kind: 'element', locator: { role: 'combobox', name: 'Color' }, actuation: 'select' },
            when: { resultCount: { gt: 0 } },
            input: {
              type: 'object',
              properties: { color: { type: 'string' } },
              required: ['color'],
              additionalProperties: false,
            },
            writes: ['resultIds', 'resultCount', 'activeColor'],
          },
          'view-dress': {
            does: 'Open one dress from the results',
            binding: link('View dress'),
            when: { resultCount: { gt: 0 } },
            input: {
              type: 'object',
              properties: { dressId: { type: 'string' } },
              required: ['dressId'],
              additionalProperties: false,
            },
            writes: ['selectedDressId'],
            goTo: 'product',
          },
        },
      },
      product: {
        route: '/dresses/:id',
        tools: {
          'add-to-cart': {
            does: 'Add the open dress to the cart',
            binding: btn('Add to cart'),
            when: { selectedInStock: { eq: true } }, // DRIFT 1 (control): app never produces `selectedInStock` (was `selectedDressId`)
            writes: ['cartIds', 'cartCount'],
          },
        },
      },
      cart: {
        route: '/cart',
        tools: {
          'proceed-to-checkout': {
            does: 'Proceed to checkout',
            binding: btn('Checkout'),
            when: { cartCount: { gt: 0 } },
            goTo: 'checkout',
          },
        },
      },
      checkout: {
        route: '/checkout',
        tools: {
          'place-order': {
            does: 'Place the order for everything in the cart',
            binding: btn('Place order'),
            when: { cartCount: { gt: 0 } },
            writes: ['lastOrderId', 'orderCount', 'cartIds', 'cartCount'],
            confirm: true,
          },
          'apply-gift-wrap': {
            does: 'Add gift wrapping to the order',
            binding: btn('Gift wrap'),
            when: { giftEligible: { eq: true } }, // DRIFT 3 (flow): app removed gift-eligibility; nothing produces `giftEligible`
            writes: ['giftWrapped'],
          },
        },
      },
      orders: {
        route: '/orders',
        tools: {
          'check-order-status': {
            does: 'Look up the status of one order',
            binding: btn('Check status'),
            when: { orderCount: { gt: 0 } },
            input: {
              type: 'object',
              properties: { orderId: { type: 'string' } },
              required: ['orderId'],
              additionalProperties: false,
            },
            writes: ['orderStatusMessage'],
          },
        },
      },
      // DRIFT 2 (page): the app removed the wishlist link, but the graph kept the page — nothing navigates here.
      wishlist: {
        route: '/wishlist',
        tools: {
          'clear-wishlist': { does: 'Clear the wishlist', binding: btn('Clear'), writes: ['wishlistCount'] },
        },
      },
    },

    tools: {
      'go-to-cart': { does: 'Open the shopping cart', binding: link('Cart'), on: ['catalog', 'product'], goTo: 'cart' },
      'view-orders': {
        does: 'Open your past orders',
        binding: link('My orders'),
        on: ['home', 'catalog', 'cart', 'checkout'],
        goTo: 'orders',
        role: 'next',
      },
    },

    skills: {
      'find-dress': {
        does: 'Find a dress: search the catalog, optionally filter by color, open one',
        steps: ['search-dresses', 'filter-by-color', 'view-dress'],
      },
      purchase: {
        does: 'Buy the open dress: add it to the cart, check out, place the order',
        steps: ['add-to-cart', 'go-to-cart', 'proceed-to-checkout', 'place-order'],
      },
      'track-order': {
        does: 'Check on a past order',
        steps: ['view-orders', 'check-order-status'],
        when: { orderCount: { gt: 0 } },
      },
      // DRIFT 3 (flow): a skill whose gift-wrap step can never satisfy its guard.
      'gift-order': {
        does: 'Buy the open dress and add gift wrapping',
        steps: ['add-to-cart', 'apply-gift-wrap'],
      },
    },
  });
}
