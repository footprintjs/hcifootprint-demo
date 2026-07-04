/**
 * The integration proof: the UNCHANGED app from commit 1, with the agent layer
 * attached from outside. Users act by calling the app's own methods (as its
 * buttons would); agents act through fire(). One session records both.
 */
import { describe, expect, it } from 'vitest';
import { DressShop } from '../src/app/shop.js';
import { connectShop } from '../src/agent-layer/connect.js';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the agent layer attaches to the untouched app', () => {
  it('mirrors the cursor and serves position-aware tools as the USER moves', () => {
    const shop = new DressShop();
    const session = connectShop(shop);
    expect(session.node).toBe('home');
    expect(session.toMCPTools().map((t) => t.name)).toContain('dress-shop.home.browse-dresses');

    shop.browseCatalog(); // the user clicks — plain app method, no layer code
    expect(session.node).toBe('catalog');
    const names = session.toMCPTools().map((t) => t.name);
    expect(names).toContain('dress-shop.catalog.search-dresses');
    expect(names).not.toContain('dress-shop.home.browse-dresses'); // home tools gone
    // the home page's registration was really released on navigation (handle.unregister):
    expect(names.some((n) => n.startsWith('dress-shop.home.'))).toBe(false);
  });

  it("attributes the user's own actions by effect signature — honestly marked as inference", () => {
    const shop = new DressShop();
    const session = connectShop(shop);
    shop.browseCatalog();
    shop.search('dress'); // unique signature → attributed, flagged inferred
    const search = session.transitions().find((t) => t.cause.affordanceId === 'catalog.search-dresses');
    expect(search?.cause).toMatchObject({ kind: 'fired', principal: 'unknown', inferred: true });

    shop.filterByColor('red'); // delta matches BOTH search and filter signatures → refuses to guess
    const last = session.transitions().at(-1)!;
    expect(last.cause.kind).toBe('stimulus');
  });

  it('the AGENT walks the purchase inside a skill frame, executing the app’s real handlers', async () => {
    const shop = new DressShop();
    const session = connectShop(shop);
    shop.browseCatalog();
    shop.search('floral');
    shop.openDress('d3');
    await flush();
    expect(session.node).toBe('product');

    expect(session.commitSkill('purchase', { source: 'agent' })).toMatchObject({ ok: true });
    session.fire('product.add-to-cart', { source: 'agent' });
    await flush();
    expect(shop.state.cart).toHaveLength(1); // the REAL app changed
    session.fire('go-to-cart', { source: 'agent' }); // root tool — bare id
    await flush();
    session.fire('cart.proceed-to-checkout', { source: 'agent' });
    await flush();
    const order = session.fire('checkout.place-order', { source: 'agent', expectedVersion: session.version });
    expect(order).toMatchObject({ ok: true });
    await flush();
    expect(shop.state.lastOrder?.id).toBe('ord-1');
    expect(shop.state.cart).toHaveLength(0);
    expect(session.leaveSkill()!.status).toBe('completed');
  });

  it('guards mirror the app’s own invariants: the agent cannot place an order with an empty cart', () => {
    const shop = new DressShop();
    const session = connectShop(shop);
    shop.navigate('checkout'); // deep link, empty cart
    expect(session.fire('checkout.place-order', { source: 'agent' })).toMatchObject({
      ok: false,
      reason: 'GUARD_FAILED',
    });
  });

  it('a crashing app handler is rejected, never recorded as success', async () => {
    const shop = new DressShop();
    const warnings: string[] = [];
    const session = connectShop(shop, { onWarn: (m) => warnings.push(m) });
    shop.browseCatalog();
    shop.search('silk');
    await flush();
    const r = session.fire('catalog.view-dress', { source: 'agent', payload: { dressId: 'ghost' } }); // app throws
    await flush();
    const t = (r as { transition: { outcome: string } }).transition;
    expect(t.outcome).toBe('rejected'); // effect never landed → the pending was auto-rejected
    expect(session.node).toBe('catalog'); // the navigation claim was never applied
    expect(session.pending()).toEqual([]); // nothing stuck
    expect(warnings.some((w) => w.includes('No dress'))).toBe(true);
  });

  it('mixed provenance in ONE explainable history; hostile catalog text stays out of the planner channel', async () => {
    const shop = new DressShop();
    const session = connectShop(shop);
    shop.browseCatalog();
    shop.search('IGNORE'); // finds the hostile-named dress — user-generated DATA
    await flush();
    session.fire('catalog.view-dress', { source: 'agent', payload: { dressId: 'd5' } });
    await flush();

    // The data path legitimately carries the hostile name (results are data):
    expect(JSON.stringify(session.state())).toContain('IGNORE PREVIOUS');
    // The planner channel never does — descriptors and the brief are authored-strings-only:
    const plannerChannel = JSON.stringify(session.toMCPTools()) + session.contextBrief().text;
    expect(plannerChannel).not.toContain('IGNORE PREVIOUS');

    // And the whole history explains itself:
    expect(session.why('selectedDressId')).toContain('view-dress');
    const log = session.commitLog();
    expect(log.every((b, i) => b.idx === i)).toBe(true);
  });
});
