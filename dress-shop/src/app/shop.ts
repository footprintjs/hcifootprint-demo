/**
 * The dress shop — plain application logic, the way any frontend team writes it:
 * a store with state + subscribers (redux-ish) and a tiny router (navigation
 * events). Methods are the app's real handlers; in a web build they'd be wired
 * to buttons. Nothing here knows about agents, LLMs, or any observation layer.
 */
import { DRESSES } from './data.js';
import type { Dress } from './data.js';

export type Page = 'home' | 'catalog' | 'product' | 'cart' | 'checkout' | 'orders';

export interface Order {
  id: string;
  items: Dress[];
  total: number;
  status: 'processing' | 'shipped' | 'delivered';
}

export interface ShopState {
  page: Page;
  results: Dress[];
  activeColor: string | null;
  selectedDress: Dress | null;
  cart: Dress[];
  orders: Order[];
  lastOrder: Order | null;
  orderStatusMessage: string | null;
}

export type StateListener = (state: Readonly<ShopState>, previous: Readonly<ShopState>) => void;
export type NavigateListener = (page: Page, previous: Page) => void;

export class DressShop {
  #state: ShopState = {
    page: 'home',
    results: [],
    activeColor: null,
    selectedDress: null,
    cart: [],
    orders: [],
    lastOrder: null,
    orderStatusMessage: null,
  };
  #stateListeners = new Set<StateListener>();
  #navigateListeners = new Set<NavigateListener>();
  #orderCounter = 1;

  get state(): Readonly<ShopState> {
    return this.#state;
  }

  /** Store subscription — fires on every state change with (next, previous). */
  subscribe(listener: StateListener): () => void {
    this.#stateListeners.add(listener);
    return () => this.#stateListeners.delete(listener);
  }

  /** Router subscription — fires on every page change. */
  onNavigate(listener: NavigateListener): () => void {
    this.#navigateListeners.add(listener);
    return () => this.#navigateListeners.delete(listener);
  }

  // ── the app's handlers (business logic) ──────────────────────────────────

  browseCatalog(): void {
    this.#go('catalog');
  }

  search(query: string): Dress[] {
    const q = query.toLowerCase();
    const results = DRESSES.filter(
      (d) => d.name.toLowerCase().includes(q) || d.color.includes(q),
    );
    this.#setState({ results, activeColor: null });
    return results;
  }

  filterByColor(color: string): Dress[] {
    const results = this.#state.results.filter((d) => d.color === color.toLowerCase());
    this.#setState({ results, activeColor: color.toLowerCase() });
    return results;
  }

  openDress(dressId: string): void {
    const dress = DRESSES.find((d) => d.id === dressId);
    if (!dress) throw new Error(`No dress with id '${dressId}'.`);
    this.#setState({ selectedDress: dress });
    this.#go('product');
  }

  addToCart(): void {
    const dress = this.#state.selectedDress;
    if (!dress) throw new Error('Open a dress before adding to the cart.');
    this.#setState({ cart: [...this.#state.cart, dress] });
  }

  openCart(): void {
    this.#go('cart');
  }

  checkout(): void {
    if (this.#state.cart.length === 0) throw new Error('The cart is empty.');
    this.#go('checkout');
  }

  placeOrder(): Order {
    const { cart } = this.#state;
    if (cart.length === 0) throw new Error('The cart is empty.');
    const order: Order = {
      id: `ord-${this.#orderCounter++}`,
      items: cart,
      total: cart.reduce((sum, d) => sum + d.price, 0),
      status: 'processing',
    };
    this.#setState({ orders: [...this.#state.orders, order], lastOrder: order, cart: [] });
    return order;
  }

  openOrders(): void {
    this.#go('orders');
  }

  checkOrderStatus(orderId: string): string {
    const order = this.#state.orders.find((o) => o.id === orderId);
    const message = order ? `${order.id}: ${order.status}` : `${orderId}: not found`;
    this.#setState({ orderStatusMessage: message });
    return message;
  }

  /** Direct navigation (address bar / back button in a web build). */
  navigate(page: Page): void {
    this.#go(page);
  }

  // ── internals ─────────────────────────────────────────────────────────────

  #setState(patch: Partial<ShopState>): void {
    const previous = this.#state;
    this.#state = { ...previous, ...patch };
    for (const listener of this.#stateListeners) listener(this.#state, previous);
  }

  #go(page: Page): void {
    if (page === this.#state.page) return;
    const previous = this.#state.page;
    this.#state = { ...this.#state, page };
    for (const listener of this.#navigateListeners) listener(page, previous);
  }
}
