/**
 * The storefront as HTML — a server-side, reader-mode serialization of exactly
 * what the browser SPA (src/web/page.ts) renders for the human, driven by the
 * SAME app state.
 *
 * WHY serialize rather than screenshot the real page: page.ts renders entirely
 * client-side (an inline <script> builds the DOM from /api/view). The visible,
 * actionable content — nav, search, color filters, product cards with ids /
 * names / prices, cart, checkout, orders — is reproduced here faithfully, with
 * the decorative SVG/CSS chrome dropped. That chrome carries no information a
 * shopper acts on; dropping it gives the DOM baseline the LEANEST fair view
 * (an accessibility-tree / reader-mode of the page), so any token gap measured
 * against it is conservative. Every interactive element gets a stable
 * `data-testid` AND its visible text, so the agent has an unambiguous handle.
 *
 * `StorefrontView` also IS the browser: click / fill / goto resolve a selector
 * to the app handler the human's click would fire (shop.openDress, shop.search,
 * …). The raw DressShop has no confirm dialog — that is a property of the
 * hcifootprint skill graph, not the app — so placing an order here fires
 * directly, exactly as the storefront's "Place order" button does.
 */
import type { DressShop, Page } from '../../src/app/shop.js';
import type { Dress } from '../../src/app/data.js';

const COLORS = ['red', 'black', 'white', 'blue', 'green', 'pink', 'yellow'] as const;
const PREVIEW_IDS = ['d3', 'd10', 'd2', 'd8'] as const; // home "Just in" (mirrors page.ts DUMMY_PREVIEW)

/** One actionable element in the current render: how to find it, and what it does. */
interface Interactive {
  readonly testid: string;
  readonly role: string;
  readonly text: string;
  readonly run: () => void;
}

export interface ActionResult {
  readonly ok: boolean;
  /** Short human-readable outcome ("clicked View on d3" / "no element matched …"). */
  readonly message: string;
  /** The resulting page's HTML — so the agent perceives the new state without a second call. */
  readonly html: string;
}

/** Escape untrusted text (dress names are UGC — d5 is a prompt-injection probe). */
export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Remove <script>/<style> blocks and collapse blank lines. Applied to any HTML
 *  before it reaches the agent, so script/style noise can never cost it tokens.
 *  (Our own render emits none — this also guards a future real-DOM source.) */
export function stripHtml(raw: string): string {
  return raw
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export class StorefrontView {
  #searchDraft = '';
  constructor(private readonly shop: DressShop) {}

  /** The current page's clean HTML (script/style-free by construction). */
  html(): string {
    return stripHtml(this.#render());
  }

  fill(selector: string, value: string): ActionResult {
    const testid = normalizeTestid(selector);
    if (testid === 'search-input' || /search/i.test(selector)) {
      this.#searchDraft = value;
      return this.#ok(`typed "${value}" into the search box (press Search to run it)`);
    }
    return this.#fail(`no fillable field matched '${selector}' (only the search box accepts input)`);
  }

  goto(path: string): ActionResult {
    const clean = path.trim().toLowerCase();
    const dressMatch = /^\/?dresses\/([a-z0-9]+)$/.exec(clean);
    try {
      if (dressMatch) {
        this.shop.openDress(dressMatch[1]);
        return this.#ok(`navigated to product ${dressMatch[1]}`);
      }
      if (clean === '/' || clean === '/home' || clean === 'home') {
        this.shop.navigate('home');
        return this.#ok('navigated to home');
      }
      if (clean === '/dresses' || clean === '/catalog' || clean === 'catalog' || clean === 'dresses') {
        this.#openCatalog();
        return this.#ok('navigated to the catalog');
      }
      const page = clean.replace(/^\//, '') as Page;
      if (['cart', 'orders', 'checkout', 'product'].includes(page)) {
        this.shop.navigate(page);
        return this.#ok(`navigated to ${page}`);
      }
      return this.#fail(`unknown path '${path}'. Try /, /dresses, /dresses/<id>, /cart, /orders, /checkout`);
    } catch (error) {
      return this.#fail(errMsg(error));
    }
  }

  click(selector: string): ActionResult {
    const elements = this.#elements();
    const el = matchElement(elements, selector);
    if (!el) {
      const available = elements.map((e) => `${e.testid} ("${e.text}")`).join(', ');
      return this.#fail(`no clickable element matched '${selector}'. Clickable now: ${available || '(none)'}`);
    }
    try {
      el.run();
      return this.#ok(`clicked ${el.testid} ("${el.text}")`);
    } catch (error) {
      return this.#fail(`clicking ${el.testid} failed: ${errMsg(error)}`);
    }
  }

  // ── internals ──────────────────────────────────────────────────────────

  #openCatalog(): void {
    this.shop.browseCatalog();
    if (this.shop.state.results.length === 0) this.shop.search(''); // mirror page.ts openCatalog()
  }

  #ok(message: string): ActionResult {
    return { ok: true, message, html: this.html() };
  }
  #fail(message: string): ActionResult {
    return { ok: false, message, html: this.html() };
  }

  /** Interactive elements available on the CURRENT page (nav is always present). */
  #elements(): Interactive[] {
    const s = this.shop.state;
    const els: Interactive[] = [
      { testid: 'nav-home', role: 'link', text: 'Home', run: () => this.shop.navigate('home') },
      { testid: 'nav-catalog', role: 'link', text: 'Dresses', run: () => this.#openCatalog() },
      { testid: 'nav-cart', role: 'link', text: `Cart (${s.cart.length})`, run: () => this.shop.navigate('cart') },
      { testid: 'nav-orders', role: 'link', text: 'Orders', run: () => this.shop.navigate('orders') },
    ];

    if (s.page === 'home') {
      els.push({ testid: 'shop-collection', role: 'button', text: 'Shop the collection', run: () => this.#openCatalog() });
      for (const id of PREVIEW_IDS) {
        els.push({ testid: `view-${id}`, role: 'link', text: 'View', run: () => this.shop.openDress(id) });
      }
    }

    if (s.page === 'catalog') {
      els.push({ testid: 'search-run', role: 'button', text: 'Search', run: () => this.shop.search(this.#searchDraft) });
      els.push({ testid: 'filter-all', role: 'button', text: 'All', run: () => this.shop.search('') });
      for (const c of COLORS) {
        els.push({ testid: `filter-${c}`, role: 'button', text: c, run: () => this.shop.filterByColor(c) });
      }
      for (const d of s.results) {
        els.push({ testid: `view-${d.id}`, role: 'link', text: 'View', run: () => this.shop.openDress(d.id) });
      }
    }

    if (s.page === 'product' && s.selectedDress) {
      els.push({ testid: 'add-to-cart', role: 'button', text: 'Add to cart', run: () => this.shop.addToCart() });
      els.push({ testid: 'back-to-catalog', role: 'button', text: 'Back', run: () => this.shop.navigate('catalog') });
    }

    if (s.page === 'cart' && s.cart.length > 0) {
      // Matches the render: no checkout button on an empty cart.
      els.push({ testid: 'checkout', role: 'button', text: 'Proceed to checkout', run: () => this.shop.checkout() });
    }

    if (s.page === 'checkout') {
      els.push({ testid: 'place-order', role: 'button', text: 'Place order', run: () => this.shop.placeOrder() });
    }

    if (s.page === 'orders') {
      for (const o of s.orders) {
        els.push({
          testid: `check-status-${o.id}`,
          role: 'button',
          text: `Check status of ${o.id}`,
          run: () => this.shop.checkOrderStatus(o.id),
        });
      }
    }

    return els;
  }

  #render(): string {
    const s = this.shop.state;
    const parts: string[] = [];
    parts.push(this.#nav());
    parts.push(`<main data-page="${s.page}">`);
    switch (s.page) {
      case 'home':
        parts.push(this.#home());
        break;
      case 'catalog':
        parts.push(this.#catalog());
        break;
      case 'product':
        parts.push(this.#product());
        break;
      case 'cart':
        parts.push(this.#cart());
        break;
      case 'checkout':
        parts.push(this.#checkout());
        break;
      case 'orders':
        parts.push(this.#orders());
        break;
    }
    parts.push('</main>');
    return parts.join('\n');
  }

  #nav(): string {
    const s = this.shop.state;
    return [
      '<header><nav aria-label="Primary">',
      `  <button data-testid="nav-home">Home</button>`,
      `  <button data-testid="nav-catalog">Dresses</button>`,
      `  <button data-testid="nav-cart">Cart (${s.cart.length})</button>`,
      `  <button data-testid="nav-orders">Orders</button>`,
      `  <span class="here">You are on: ${s.page}</span>`,
      '</nav></header>',
    ].join('\n');
  }

  #home(): string {
    const rows = PREVIEW_IDS.map((id) => {
      const d = findDress(this.shop, id);
      return d ? this.#card(d, `view-${id}`) : '';
    }).join('\n');
    return [
      '<section><h1>Maison — modern dresses</h1>',
      '<p>Browse the collection, or shop by hand.</p>',
      '<button data-testid="shop-collection">Shop the collection</button>',
      '<h2>Just in</h2>',
      `<div class="grid">\n${rows}\n</div>`,
      '</section>',
    ].join('\n');
  }

  #catalog(): string {
    const s = this.shop.state;
    const filterNote = s.activeColor ? ` · filtered: ${esc(s.activeColor)}` : '';
    const chips = COLORS.map((c) => `<button data-testid="filter-${c}">${c}</button>`).join('\n  ');
    const cards = s.results.length
      ? s.results.map((d) => this.#card(d, `view-${d.id}`)).join('\n')
      : '<p class="empty">No dresses match — press "All" to reset.</p>';
    return [
      `<section><h1>Dresses (${s.results.length} result${s.results.length === 1 ? '' : 's'}${filterNote})</h1>`,
      '<form role="search">',
      `  <input data-testid="search-input" type="search" aria-label="Search" placeholder="Search silk, red, linen…" value="${esc(this.#searchDraft)}" />`,
      '  <button data-testid="search-run">Search</button>',
      '</form>',
      '<div class="filters">',
      `  <button data-testid="filter-all">All</button>`,
      `  ${chips}`,
      '</div>',
      `<div class="grid">\n${cards}\n</div>`,
      '</section>',
    ].join('\n');
  }

  #card(d: Dress, viewTestid: string): string {
    return [
      `<article class="card" data-dress-id="${esc(d.id)}">`,
      `  <h3>${esc(d.name)}</h3>`,
      `  <p class="meta">${esc(d.color)} · size ${esc(d.size)} · $${d.price}</p>`,
      `  <a data-testid="${viewTestid}" role="link">View</a>`,
      '</article>',
    ].join('\n');
  }

  #product(): string {
    const d = this.shop.state.selectedDress;
    if (!d) return '<section><p class="empty">No dress selected.</p></section>';
    return [
      `<section data-dress-id="${esc(d.id)}"><h1>${esc(d.name)}</h1>`,
      `<p class="meta">${esc(d.color)} · size ${esc(d.size)}</p>`,
      `<p class="price">$${d.price}</p>`,
      '<button data-testid="add-to-cart">Add to cart</button>',
      '<button data-testid="back-to-catalog">Back</button>',
      '</section>',
    ].join('\n');
  }

  #cart(): string {
    const s = this.shop.state;
    if (s.cart.length === 0) return '<section><h1>Your cart</h1><p class="empty">Your cart is empty.</p></section>';
    const total = s.cart.reduce((sum, d) => sum + d.price, 0);
    const rows = s.cart
      .map((d) => `<li data-dress-id="${esc(d.id)}">${esc(d.name)} — ${esc(d.color)} · size ${esc(d.size)} · $${d.price}</li>`)
      .join('\n');
    return [
      `<section><h1>Your cart (${s.cart.length} item${s.cart.length === 1 ? '' : 's'}, $${total})</h1>`,
      `<ul>\n${rows}\n</ul>`,
      '<button data-testid="checkout">Proceed to checkout</button>',
      '</section>',
    ].join('\n');
  }

  #checkout(): string {
    const s = this.shop.state;
    const total = s.cart.reduce((sum, d) => sum + d.price, 0);
    const rows = s.cart
      .map((d) => `<li data-dress-id="${esc(d.id)}">${esc(d.name)} · $${d.price}</li>`)
      .join('\n');
    const note = s.lastOrder ? `<p class="note">Order ${esc(s.lastOrder.id)} placed — $${s.lastOrder.total}.</p>` : '';
    return [
      `<section><h1>Checkout (${s.cart.length} item${s.cart.length === 1 ? '' : 's'}, $${total})</h1>`,
      `<ul>\n${rows}\n</ul>`,
      '<button data-testid="place-order">Place order</button>',
      note,
      '</section>',
    ].join('\n');
  }

  #orders(): string {
    const s = this.shop.state;
    if (s.orders.length === 0) return '<section><h1>Your orders</h1><p class="empty">No orders yet.</p></section>';
    const rows = s.orders
      .map(
        (o) =>
          `<li data-order-id="${esc(o.id)}">${esc(o.id)} — ${o.items.length} item${o.items.length === 1 ? '' : 's'} · $${o.total} · status: ${esc(o.status)} ` +
          `<button data-testid="check-status-${esc(o.id)}">Check status of ${esc(o.id)}</button></li>`,
      )
      .join('\n');
    const note = s.orderStatusMessage ? `<p class="note">${esc(s.orderStatusMessage)}</p>` : '';
    return [`<section><h1>Your orders (${s.orders.length})</h1>`, `<ul>\n${rows}\n</ul>`, note, '</section>'].join('\n');
  }
}

// ── selector matching ──────────────────────────────────────────────────────

/** Pull a bare testid out of common selector spellings the model produces. */
function normalizeTestid(selector: string): string {
  const attr = /\[?data-testid\s*=\s*["']?([^"'\]]+)["']?\]?/i.exec(selector);
  if (attr) return attr[1].trim();
  return selector.replace(/^[#.]/, '').trim();
}

/** Resolve a selector to an element: by data-testid, then by visible text. */
function matchElement(elements: Interactive[], selector: string): Interactive | undefined {
  const testid = normalizeTestid(selector);
  const byId = elements.find((e) => e.testid === testid);
  if (byId) return byId;
  const dressAttr = /\[?data-dress-id\s*=\s*["']?([^"'\]]+)["']?\]?/i.exec(selector);
  if (dressAttr) {
    const byDress = elements.find((e) => e.testid === `view-${dressAttr[1].trim()}`);
    if (byDress) return byDress;
  }
  const needle = selector.trim().toLowerCase();
  const byText = elements.find((e) => e.text.toLowerCase() === needle);
  if (byText) return byText;
  return elements.find((e) => e.text.toLowerCase().includes(needle) && needle.length >= 3);
}

function findDress(shop: DressShop, id: string): Dress | undefined {
  // Read from the live catalog without mutating state (home preview is static).
  return shop.state.results.find((d) => d.id === id) ?? PREVIEW_FALLBACK[id];
}

// Static fallback so home preview cards render before any search populates results.
const PREVIEW_FALLBACK: Record<string, Dress> = {
  d2: { id: 'd2', name: 'Evening Silk Gown', color: 'black', size: 'S', price: 249 },
  d3: { id: 'd3', name: 'Floral Wrap Dress', color: 'red', size: 'M', price: 120 },
  d8: { id: 'd8', name: 'Ocean Breeze Maxi', color: 'blue', size: 'S', price: 110 },
  d10: { id: 'd10', name: 'Blush Tulle Gown', color: 'pink', size: 'S', price: 210 },
};

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
