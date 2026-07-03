/** Vanilla behavioral tests — written for the app itself, no agent layer in sight. */
import { describe, expect, it } from 'vitest';
import { DressShop } from '../src/app/shop.js';

describe('DressShop', () => {
  it('searches and filters the catalog', () => {
    const shop = new DressShop();
    shop.browseCatalog();
    expect(shop.state.page).toBe('catalog');
    const results = shop.search('dress');
    expect(results.length).toBeGreaterThan(0);
    const red = shop.filterByColor('red');
    expect(red.every((d) => d.color === 'red')).toBe(true);
    expect(shop.state.activeColor).toBe('red');
  });

  it('walks the purchase flow', () => {
    const shop = new DressShop();
    shop.browseCatalog();
    shop.search('floral');
    shop.openDress('d3');
    expect(shop.state.page).toBe('product');
    shop.addToCart();
    expect(shop.state.cart).toHaveLength(1);
    shop.openCart();
    shop.checkout();
    const order = shop.placeOrder();
    expect(order.id).toBe('ord-1');
    expect(order.total).toBe(120);
    expect(shop.state.cart).toHaveLength(0);
    expect(shop.state.lastOrder?.id).toBe('ord-1');
  });

  it('guards its own invariants with plain errors', () => {
    const shop = new DressShop();
    expect(() => shop.addToCart()).toThrow(/Open a dress/);
    expect(() => shop.checkout()).toThrow(/cart is empty/i);
    expect(() => shop.placeOrder()).toThrow(/cart is empty/i);
    expect(() => shop.openDress('ghost')).toThrow(/No dress/);
  });

  it('answers order-status questions', () => {
    const shop = new DressShop();
    shop.browseCatalog();
    shop.search('silk');
    shop.openDress('d2');
    shop.addToCart();
    shop.placeOrder();
    shop.openOrders();
    expect(shop.checkOrderStatus('ord-1')).toBe('ord-1: processing');
    expect(shop.checkOrderStatus('ord-9')).toBe('ord-9: not found');
  });

  it('notifies store subscribers with (next, previous) and router listeners on page change', () => {
    const shop = new DressShop();
    const stateEvents: string[] = [];
    const navEvents: string[] = [];
    shop.subscribe((next, prev) => stateEvents.push(`cart:${prev.cart.length}->${next.cart.length}`));
    shop.onNavigate((page, prev) => navEvents.push(`${prev}->${page}`));

    shop.browseCatalog();
    shop.search('floral');
    shop.openDress('d3');
    shop.addToCart();

    expect(navEvents).toEqual(['home->catalog', 'catalog->product']);
    expect(stateEvents.at(-1)).toBe('cart:0->1');

    const unsubscribe = shop.subscribe(() => stateEvents.push('extra'));
    unsubscribe();
    shop.addToCart();
    expect(stateEvents.filter((e) => e === 'extra')).toHaveLength(0);
  });

  it('navigate() serves back-button/deep-link jumps', () => {
    const shop = new DressShop();
    shop.navigate('orders');
    expect(shop.state.page).toBe('orders');
  });
});
