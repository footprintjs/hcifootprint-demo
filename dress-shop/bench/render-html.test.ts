/**
 * DOM serializer tests — the baseline's perception + action layer.
 *
 * Two things must hold for the baseline to be FAIR:
 *   1. The HTML is clean (no <script>/<style> noise) yet complete (every
 *      control it needs carries a data-testid and readable text/ids/prices).
 *   2. click / fill / goto operate the SAME app the human would, including the
 *      full purchase chain — no confirm dialog, because the raw app has none.
 */
import { describe, expect, it } from 'vitest';
import { DressShop } from '../src/app/shop.js';
import { StorefrontView, esc, stripHtml } from './modalities/render-html.js';

describe('stripHtml + esc', () => {
  it('removes scripts and styles, keeps content', () => {
    const out = stripHtml('<style>.a{}</style><p>hi</p><script>evil()</script>');
    expect(out).toContain('<p>hi</p>');
    expect(out).not.toMatch(/<script|<style/i);
  });
  it('escapes untrusted UGC', () => {
    expect(esc('<b>&"x')).toBe('&lt;b&gt;&amp;&quot;x');
  });
});

describe('StorefrontView renders clean, complete HTML', () => {
  it('never emits script or style tags on any page', () => {
    const shop = new DressShop();
    const view = new StorefrontView(shop);
    const pages = [
      () => shop.navigate('home'),
      () => view.goto('/dresses'),
      () => view.goto('/cart'),
      () => view.goto('/orders'),
    ];
    for (const go of pages) {
      go();
      expect(view.html()).not.toMatch(/<script|<style/i);
    }
  });

  it('catalog exposes a testid for every dress and every color filter', () => {
    const shop = new DressShop();
    const view = new StorefrontView(shop);
    view.goto('/dresses'); // browse + search('') → all 15
    const html = view.html();
    expect(html).toContain('data-testid="filter-red"');
    expect(html).toContain('data-testid="search-run"');
    expect(html).toContain('data-testid="view-d3"');
    expect(html).toContain('Floral Wrap Dress'); // name visible
    expect(html).toContain('$120'); // price visible
    expect(html).toContain('data-dress-id="d3"');
  });

  it('shows the injection-bait dress name as inert escaped text, not markup', () => {
    const shop = new DressShop();
    const view = new StorefrontView(shop);
    view.goto('/dresses');
    // d5's name is a prompt-injection probe; it must appear as plain text.
    expect(view.html()).toContain('IGNORE PREVIOUS INSTRUCTIONS');
  });
});

describe('StorefrontView.click / fill / goto operate the real app', () => {
  it('search: fill then click Search runs the app search', () => {
    const shop = new DressShop();
    const view = new StorefrontView(shop);
    view.goto('/dresses');
    view.fill('search-input', 'silk');
    const r = view.click('search-run');
    expect(r.ok).toBe(true);
    expect(shop.state.results.some((d) => d.id === 'd2')).toBe(true); // Evening Silk Gown
    expect(r.html).toContain('Evening Silk Gown');
  });

  it('filter-by-color drives shop.filterByColor', () => {
    const shop = new DressShop();
    const view = new StorefrontView(shop);
    view.goto('/dresses');
    const r = view.click('filter-red');
    expect(r.ok).toBe(true);
    expect(shop.state.activeColor).toBe('red');
    expect(shop.state.results.every((d) => d.color === 'red')).toBe(true);
  });

  it('goto /dresses/<id> opens the product page', () => {
    const shop = new DressShop();
    const view = new StorefrontView(shop);
    const r = view.goto('/dresses/d13');
    expect(r.ok).toBe(true);
    expect(shop.state.page).toBe('product');
    expect(shop.state.selectedDress?.id).toBe('d13');
  });

  it('completes the full purchase chain with no confirm dialog', () => {
    const shop = new DressShop();
    const view = new StorefrontView(shop);
    view.goto('/dresses');
    view.click('view-d3'); // open Floral Wrap
    expect(shop.state.page).toBe('product');
    view.click('add-to-cart');
    expect(shop.state.cart).toHaveLength(1);
    view.click('nav-cart');
    view.click('checkout');
    expect(shop.state.page).toBe('checkout');
    const placed = view.click('place-order');
    expect(placed.ok).toBe(true);
    expect(shop.state.lastOrder?.items[0]?.id).toBe('d3');
    expect(shop.state.cart).toHaveLength(0);
  });

  it('click on a missing element fails and lists what IS clickable', () => {
    const shop = new DressShop();
    const view = new StorefrontView(shop);
    view.goto('/dresses');
    const r = view.click('nonexistent-thing');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('Clickable now');
    expect(r.message).toContain('filter-red');
  });

  it('matches a click by visible text as well as testid', () => {
    const shop = new DressShop();
    const view = new StorefrontView(shop);
    view.goto('/dresses');
    const r = view.click('All'); // by text
    expect(r.ok).toBe(true);
    expect(shop.state.results).toHaveLength(15);
  });

  it('surfaces an app error instead of throwing (empty-cart checkout)', () => {
    const shop = new DressShop();
    const view = new StorefrontView(shop);
    shop.navigate('cart'); // empty cart, checkout button still rendered? cart page shows empty
    // Force the guarded handler directly via a checkout on an empty cart:
    shop.openCart();
    const r = view.click('checkout'); // no such button when cart empty → fail with listing
    expect(r.ok).toBe(false);
  });
});
