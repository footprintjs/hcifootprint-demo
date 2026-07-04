/**
 * The DECLARED navigation graph for the dress shop — the agent layer's map of
 * the application, written against the app's observable behavior (its pages,
 * handlers, and state), not by changing any of it. `does` strings are the only
 * text an LLM ever receives as instructions.
 *
 * This is the D18 tree API: pages own their tools; `go-to-cart` / `view-orders`
 * are root tools offered on several pages at once. Tool ids the agent sees are
 * qualified dot paths (`catalog.search-dresses`); skills reference steps by
 * their unambiguous suffix.
 */
import { buildNavigationGraph } from 'hcifootprint';
import type { Binding } from 'hcifootprint';

const btn = (name: string): Binding =>
  ({ kind: 'element', locator: { role: 'button', name }, actuation: 'click' });
const link = (name: string): Binding =>
  ({ kind: 'element', locator: { role: 'link', name }, actuation: 'click' });

export function dressShopGraph() {
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
              properties: { query: { type: 'string', description: 'search text, e.g. "silk" or "red"' } },
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
            when: { selectedDressId: { ne: '' } },
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
            confirm: true, // high-effect → the human-in-the-loop gate
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
    },

    // Root tools — offered on several pages at once.
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
    },
  });
}
