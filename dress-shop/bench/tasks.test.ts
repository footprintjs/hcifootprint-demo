/**
 * Oracle tests — drive the UNTOUCHED app programmatically into both a passing
 * and a failing state for every task, proving each oracle reads app state (not
 * the transcript) and actually discriminates success from failure.
 */
import { describe, expect, it } from 'vitest';
import { DressShop } from '../src/app/shop.js';
import { taskById, TASKS } from './tasks.js';

/** Fresh shop with the task's setup applied (if any). */
function shopFor(id: string): { shop: DressShop; task: ReturnType<typeof taskById> } {
  const task = taskById(id);
  const shop = new DressShop();
  task.setup?.(shop);
  return { shop, task };
}

describe('bench task oracles', () => {
  it('exposes exactly 5 tasks with unique ids', () => {
    expect(TASKS).toHaveLength(5);
    expect(new Set(TASKS.map((t) => t.id)).size).toBe(5);
  });

  it('open-emerald: pass iff the d13 product page is open', () => {
    const { shop, task } = shopFor('open-emerald');
    expect(task.oracle(shop).pass).toBe(false); // fresh home page
    shop.browseCatalog();
    shop.search('');
    shop.openDress('d1'); // wrong dress
    expect(task.oracle(shop).pass).toBe(false);
    shop.openDress('d13'); // Emerald Satin Wrap
    const ok = task.oracle(shop);
    expect(ok.pass).toBe(true);
    expect(ok.detail).toContain('d13');
  });

  it('filter-red: pass iff catalog is filtered to red-only', () => {
    const { shop, task } = shopFor('filter-red');
    shop.browseCatalog();
    shop.search('');
    expect(task.oracle(shop).pass).toBe(false); // searched but not filtered
    shop.filterByColor('red');
    const ok = task.oracle(shop);
    expect(ok.pass).toBe(true);
    expect(shop.state.results.every((d) => d.color === 'red')).toBe(true);
  });

  it('buy-cheapest-red: pass iff the placed order is exactly d3 ($120)', () => {
    const { shop, task } = shopFor('buy-cheapest-red');
    // Wrong: buy d6 (also red, under $150, but not the cheapest)
    shop.browseCatalog();
    shop.search('');
    shop.openDress('d6');
    shop.addToCart();
    shop.placeOrder();
    expect(task.oracle(shop).pass).toBe(false);

    // Right: a fresh shop, buy d3
    const shop2 = new DressShop();
    shop2.browseCatalog();
    shop2.search('');
    shop2.openDress('d3');
    shop2.addToCart();
    shop2.placeOrder();
    const ok = task.oracle(shop2);
    expect(ok.pass).toBe(true);
    expect(shop2.state.cart).toHaveLength(0);
  });

  it('track-order: setup seeds ord-1; pass iff its status was looked up', () => {
    const { shop, task } = shopFor('track-order');
    expect(shop.state.orders).toHaveLength(1); // setup placed one
    expect(shop.state.orders[0].id).toBe('ord-1');
    expect(task.oracle(shop).pass).toBe(false); // not yet checked
    shop.checkOrderStatus('ord-1');
    expect(task.oracle(shop).pass).toBe(true);
  });

  it('buy-denim-pinafore: pass iff the placed order is exactly d15', () => {
    const { shop, task } = shopFor('buy-denim-pinafore');
    shop.browseCatalog();
    shop.search('');
    shop.openDress('d1'); // wrong dress
    shop.addToCart();
    shop.placeOrder();
    expect(task.oracle(shop).pass).toBe(false);

    const shop2 = new DressShop();
    shop2.browseCatalog();
    shop2.search('');
    shop2.openDress('d15'); // Denim Pinafore
    shop2.addToCart();
    shop2.placeOrder();
    expect(task.oracle(shop2).pass).toBe(true);
  });

  it('marks the two purchase tasks as confirm-gate crossings', () => {
    expect(taskById('buy-cheapest-red').crossesConfirmGate).toBe(true);
    expect(taskById('buy-denim-pinafore').crossesConfirmGate).toBe(true);
    expect(taskById('filter-red').crossesConfirmGate).toBe(false);
  });
});
