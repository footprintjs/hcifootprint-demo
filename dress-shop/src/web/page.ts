/**
 * The dress-shop WEBSITE + the assistant dock, one page. The storefront and
 * the agent drive the SAME app instance server-side: your clicks call the
 * app's real handlers via /api/app; the assistant fires the same handlers
 * through the session. Both kinds of motion show up live on both sides.
 *
 * Firewall discipline: every runtime string (dress names are untrusted UGC —
 * d5 proves it, gap asks, model text) is rendered with textContent, never
 * innerHTML.
 */
export const PAGE = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Maison Dresses · HCIFootprint demo</title>
<style>
  :root { color-scheme: light dark; --edge:#8884; --hi:#c0392b; --hi2:#e67e22; --card:#88888812; }
  * { box-sizing: border-box; }
  body { margin:0; font:15px/1.5 system-ui,sans-serif; display:grid; grid-template-columns:1fr 360px; height:100vh; }
  @media (max-width:900px){ body{grid-template-columns:1fr; height:auto} .dock{border-left:0;border-top:1px solid var(--edge); height:60vh} }

  /* ── the shop ─────────────────────────────────────────── */
  .shop { display:flex; flex-direction:column; height:100vh; overflow:hidden; }
  header { display:flex; align-items:center; gap:18px; padding:14px 22px; border-bottom:1px solid var(--edge); }
  .brand { font-size:19px; font-weight:700; letter-spacing:.02em; }
  .brand em { color:var(--hi); font-style:normal; }
  nav { display:flex; gap:4px; margin-left:auto; }
  nav button { border:0; background:none; padding:7px 12px; border-radius:9px; cursor:pointer; font:inherit; color:inherit; }
  nav button:hover { background:var(--card); }
  nav button.active { background:var(--hi); color:#fff; }
  .badge { background:var(--hi2); color:#fff; border-radius:9px; padding:0 6px; font-size:12px; margin-left:4px; }
  main { flex:1; overflow:auto; padding:22px; }

  .hero { text-align:center; padding:60px 20px; }
  .hero h1 { font-size:34px; margin:0 0 10px; }
  .hero p { opacity:.7; max-width:460px; margin:0 auto 26px; }
  .cta { background:var(--hi); color:#fff; border:0; padding:12px 26px; border-radius:12px; font:inherit; font-weight:600; cursor:pointer; }

  .toolbar { display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:18px; }
  .toolbar input { padding:9px 12px; border:1px solid var(--edge); border-radius:10px; background:transparent; color:inherit; font:inherit; min-width:220px; }
  .chip { border:1px solid var(--edge); background:none; color:inherit; padding:6px 12px; border-radius:999px; cursor:pointer; font:inherit; font-size:13px; }
  .chip.active { background:var(--hi); border-color:var(--hi); color:#fff; }

  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:16px; }
  .card { border:1px solid var(--edge); border-radius:14px; overflow:hidden; background:var(--card); display:flex; flex-direction:column; }
  .swatch { height:130px; display:flex; align-items:center; justify-content:center; font-size:42px; }
  .card .info { padding:10px 12px 12px; display:flex; flex-direction:column; gap:4px; flex:1; }
  .card .name { font-weight:600; font-size:14px; min-height:2.6em; }
  .card .meta, .meta { font-size:12.5px; opacity:.65; }
  .card .row { display:flex; align-items:center; justify-content:space-between; margin-top:auto; }
  .price { font-weight:700; }
  .mini { border:1px solid var(--hi); color:var(--hi); background:none; border-radius:8px; padding:5px 12px; cursor:pointer; font:inherit; font-size:13px; font-weight:600; }

  .product { display:flex; gap:26px; flex-wrap:wrap; }
  .product .swatch { width:280px; height:280px; border-radius:16px; font-size:96px; flex-shrink:0; }
  .product h2 { margin:2px 0 8px; }
  .lineitem { display:flex; align-items:center; gap:12px; padding:10px 0; border-bottom:1px solid var(--edge); }
  .lineitem .sw { width:44px; height:44px; border-radius:9px; display:flex; align-items:center; justify-content:center; font-size:20px; }
  .total { font-size:18px; font-weight:700; margin:14px 0; }
  .empty { opacity:.55; padding:30px 0; }
  .note { border-left:3px solid var(--hi2); padding:6px 10px; margin:10px 0; font-size:13.5px; background:var(--card); border-radius:0 8px 8px 0; }
  .order { display:flex; align-items:center; gap:14px; padding:11px 0; border-bottom:1px solid var(--edge); }

  footer { padding:8px 22px; border-top:1px solid var(--edge); font-size:12px; opacity:.65; display:flex; gap:16px; flex-wrap:wrap; }

  /* ── the assistant dock ───────────────────────────────── */
  .dock { border-left:1px solid var(--edge); display:flex; flex-direction:column; height:100vh; }
  .dock h2 { font-size:13px; text-transform:uppercase; letter-spacing:.06em; opacity:.6; margin:0; padding:14px 16px 8px; }
  #log { flex:1; overflow:auto; padding:6px 14px; display:flex; flex-direction:column; gap:9px; }
  .msg { padding:8px 12px; border-radius:12px; max-width:88%; white-space:pre-wrap; font-size:14px; }
  .user { align-self:flex-end; background:var(--hi); color:#fff; }
  .bot  { align-self:flex-start; background:#8882; }
  .sys  { align-self:center; font-size:12px; opacity:.65; text-align:center; }
  .working { opacity:.9; font-weight:600; color:var(--hi2); }
  @keyframes pulse { 0%,100%{opacity:.55} 50%{opacity:1} }
  .working { animation:pulse 1.1s ease-in-out infinite; }
  .confirm { align-self:center; background:#f39c1233; border:1px solid #f39c12; border-radius:12px; padding:11px; text-align:center; max-width:94%; font-size:14px; }
  .confirm button { margin:8px 5px 0; padding:6px 16px; border-radius:8px; border:0; cursor:pointer; font-weight:600; font:inherit; }
  .yes { background:#27ae60; color:#fff; } .no { background:#8884; color:inherit; }
  #f { display:flex; gap:8px; padding:12px 14px; border-top:1px solid var(--edge); }
  #m { flex:1; padding:9px 12px; border-radius:10px; border:1px solid var(--edge); background:transparent; color:inherit; font:inherit; }
  .send { padding:0 16px; border-radius:10px; border:0; background:var(--hi); color:#fff; cursor:pointer; font-weight:600; }
</style>
</head>
<body>
<div class="shop">
  <header>
    <div class="brand">Maison <em>Dresses</em></div>
    <nav id="nav"></nav>
  </header>
  <main id="main"></main>
  <footer><span id="whereami"></span><span id="gapcount"></span><span>you and the assistant share one live session</span></footer>
</div>
<div class="dock">
  <h2>Shop assistant · Claude Opus</h2>
  <div id="log"><div class="sys">Ask me anything — "find me a red dress under $150 and buy it", or "where is my order?"</div></div>
  <form id="f"><input id="m" autocomplete="off" placeholder="Message the assistant…" /><button class="send">Send</button></form>
</div>
<script>
const SWATCH_BG = { white:'linear-gradient(135deg,#f6f4ef,#dcd8cf)', black:'linear-gradient(135deg,#3a3a40,#17171c)',
  red:'linear-gradient(135deg,#e74c3c,#8e2418)', blue:'linear-gradient(135deg,#5dade2,#21618c)',
  green:'linear-gradient(135deg,#58d68d,#1e8449)', pink:'linear-gradient(135deg,#f5b7d0,#d4638f)',
  yellow:'linear-gradient(135deg,#f7dc6f,#d4ac0d)' };
const COLORS = ['red','black','white','blue','green','pink','yellow'];
const PAGES = [['home','Home'],['catalog','Dresses'],['cart','Cart'],['orders','Orders']];
let view = null;
let searchDraft = '';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
async function post(url, body){ const r = await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}); return r.json(); }
async function app(method, args){ const r = await post('/api/app',{method,args}); if(!r.ok && r.error) toast('⚠ ' + r.error); await refresh(); }
function toast(text){ const d = el('div','sys',text); $('log').appendChild(d); $('log').scrollTop = 1e9; }

function swatch(dress, cls){
  const s = el('div', cls || 'swatch', '👗');
  s.style.background = SWATCH_BG[dress.color] || 'var(--card)';
  if (dress.color === 'white') s.style.color = '#8886';
  return s;
}

function renderNav(){
  const nav = $('nav'); nav.textContent = '';
  for (const [page, label] of PAGES){
    const b = el('button', view && view.node === page ? 'active' : '', label);
    if (page === 'cart' && view && view.cart.length){ b.appendChild(el('span','badge', String(view.cart.length))); }
    b.onclick = () => page === 'catalog' ? openCatalog() : app('navigate',{page});
    nav.appendChild(b);
  }
}

async function openCatalog(){
  await app('browseCatalog');
  if (view && view.results.length === 0) await app('search',{query: ''}); // browsing shows everything
}

function renderMain(){
  const m = $('main'); m.textContent = '';
  if (!view) return;
  const page = view.node;

  if (page === 'home'){
    const hero = el('div','hero');
    hero.appendChild(el('h1','', 'Dresses for every day it matters.'));
    hero.appendChild(el('p','', 'Browse the collection yourself, or ask the assistant on the right to find, filter, and buy for you — every action lands in the same live session.'));
    const cta = el('button','cta','Shop dresses'); cta.onclick = openCatalog; hero.appendChild(cta);
    m.appendChild(hero);
    return;
  }

  if (page === 'catalog'){
    const bar = el('div','toolbar');
    const input = el('input'); input.placeholder = 'Search dresses… (e.g. silk, red)'; input.value = searchDraft;
    input.oninput = () => { searchDraft = input.value; };
    input.onkeydown = (e) => { if (e.key === 'Enter'){ e.preventDefault(); app('search',{query: input.value}); } };
    const go = el('button','mini','Search'); go.onclick = () => app('search',{query: input.value});
    bar.append(input, go);
    for (const c of COLORS){
      const chip = el('button', 'chip' + (view.activeColor === c ? ' active' : ''), c);
      chip.onclick = () => app('filterByColor',{color: c});
      bar.appendChild(chip);
    }
    const all = el('button','chip','all'); all.onclick = () => app('search',{query: ''}); bar.appendChild(all);
    m.appendChild(bar);

    if (view.results.length === 0){
      m.appendChild(el('div','empty','No dresses match — try another search, or press "all".'));
      return;
    }
    const grid = el('div','grid');
    for (const d of view.results){
      const card = el('div','card');
      card.appendChild(swatch(d));
      const info = el('div','info');
      info.appendChild(el('div','name', d.name));           // untrusted text → textContent
      info.appendChild(el('div','meta', d.color + ' · size ' + d.size));
      const row = el('div','row');
      row.appendChild(el('span','price', '$' + d.price));
      const viewBtn = el('button','mini','View'); viewBtn.onclick = () => app('openDress',{dressId: d.id});
      row.appendChild(viewBtn);
      info.appendChild(row);
      card.appendChild(info);
      grid.appendChild(card);
    }
    m.appendChild(grid);
    return;
  }

  if (page === 'product'){
    const d = view.selectedDress;
    if (!d){ m.appendChild(el('div','empty','No dress selected — go back to the catalog.')); return; }
    const wrap = el('div','product');
    wrap.appendChild(swatch(d,'swatch'));
    const side = el('div');
    side.appendChild(el('h2','', d.name));
    side.appendChild(el('div','meta', d.color + ' · size ' + d.size));
    side.appendChild(el('div','total', '$' + d.price));
    const add = el('button','cta','Add to cart'); add.onclick = () => app('addToCart');
    const back = el('button','chip','← back to results'); back.style.marginLeft = '12px';
    back.onclick = () => app('navigate',{page:'catalog'});
    side.append(add, back);
    wrap.appendChild(side);
    m.appendChild(wrap);
    return;
  }

  if (page === 'cart'){
    m.appendChild(el('h2','','Your cart'));
    if (view.cart.length === 0){ m.appendChild(el('div','empty','The cart is empty.')); return; }
    let total = 0;
    for (const d of view.cart){
      total += d.price;
      const li = el('div','lineitem');
      li.appendChild(swatch(d,'sw'));
      li.appendChild(el('span','', d.name));
      const p = el('span','price','$' + d.price); p.style.marginLeft = 'auto'; li.appendChild(p);
      m.appendChild(li);
    }
    m.appendChild(el('div','total', 'Total: $' + total));
    const go = el('button','cta','Checkout'); go.onclick = () => app('checkout');
    m.appendChild(go);
    return;
  }

  if (page === 'checkout'){
    m.appendChild(el('h2','','Checkout'));
    let total = 0; for (const d of view.cart) total += d.price;
    m.appendChild(el('div','', view.cart.length + ' item(s)'));
    m.appendChild(el('div','total','Total: $' + total));
    const place = el('button','cta','Place order'); place.onclick = () => app('placeOrder');
    m.appendChild(place);
    if (view.lastOrder) m.appendChild(el('div','note', 'Order ' + view.lastOrder.id + ' placed — $' + view.lastOrder.total + '. See Orders.'));
    return;
  }

  if (page === 'orders'){
    m.appendChild(el('h2','','Your orders'));
    if (view.orders.length === 0){ m.appendChild(el('div','empty','No orders yet.')); return; }
    for (const o of view.orders){
      const row = el('div','order');
      row.appendChild(el('strong','', o.id));
      row.appendChild(el('span','meta', o.count + ' item(s) · $' + o.total));
      const check = el('button','mini','Check status'); check.onclick = () => app('checkOrderStatus',{orderId: o.id});
      row.appendChild(check);
      m.appendChild(row);
    }
    if (view.orderStatusMessage) m.appendChild(el('div','note', view.orderStatusMessage));
    return;
  }
}

let lastVersion = -1;
async function refresh(){
  const r = await fetch('/api/view'); view = await r.json();
  renderNav(); renderMain();
  $('whereami').textContent = 'you are on: ' + view.node + ' (v' + view.version + ')';
  $('gapcount').textContent = 'gap ledger: ' + view.gaps + ' row(s)';
  lastVersion = view.version;
}
// The agent acts server-side — poll so ITS motion appears on the storefront live.
setInterval(async () => {
  try {
    const r = await fetch('/api/view'); const v = await r.json();
    if (v.version !== lastVersion){
      view = v; lastVersion = v.version; renderNav(); renderMain();
      $('whereami').textContent = 'you are on: ' + v.node + ' (v' + v.version + ')';
      $('gapcount').textContent = 'gap ledger: ' + v.gaps + ' row(s)';
    }
  } catch {}
}, 1500);

/* ── chat dock ─────────────────────────────────────────── */
function add(cls, text){ const d = el('div','msg ' + cls, text); $('log').appendChild(d); $('log').scrollTop = 1e9; return d; }

// Run a turn with a LIVE status line: poll /api/activity and show the agent's
// latest step ("Searching the catalog…") until the turn resolves.
async function withStatus(request){
  const status = add('sys','…thinking'); status.classList.add('working');
  let polling = true;
  (async () => {
    while (polling){
      try { const a = await (await fetch('/api/activity')).json();
        if (a.steps && a.steps.length) status.textContent = '⋯ ' + a.steps[a.steps.length - 1]; } catch {}
      await new Promise(r => setTimeout(r, 350));
    }
  })();
  try { return await request(); } finally { polling = false; status.remove(); }
}

function renderTurn(turn){
  if (turn.error){ add('sys','⚠ ' + turn.error); return; }
  if (turn.type === 'confirm'){
    const box = el('div','confirm');
    box.appendChild(el('div','', turn.summary));            // model/runtime text → textContent
    const yes = el('button','yes','Approve'); const no = el('button','no','Decline');
    box.append(yes, no); $('log').appendChild(box); $('log').scrollTop = 1e9;
    const answer = async (ok) => { box.remove(); add('sys', ok ? '✔ approved' : '✘ declined');
      renderTurn(await withStatus(() => post('/api/confirm',{approved: ok}))); refresh(); };
    yes.onclick = () => answer(true); no.onclick = () => answer(false);
    return;
  }
  add('bot', turn.text);
}
$('f').onsubmit = async (e) => {
  e.preventDefault();
  const msg = $('m').value.trim(); if (!msg) return; $('m').value = '';
  add('user', msg);
  const turn = await withStatus(() => post('/api/chat',{message: msg}));
  renderTurn(turn); refresh();
};

refresh();
</script>
</body>
</html>`;
