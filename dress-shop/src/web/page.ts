/**
 * The dress-shop WEBSITE + a floating assistant popup, one page. The storefront
 * and the agent drive the SAME app instance server-side: your clicks call the
 * app's real handlers via /api/app; the assistant fires the same handlers
 * through the session. Both kinds of motion show up live on both sides.
 *
 * Firewall discipline: every RUNTIME string (dress names are untrusted UGC —
 * d5 proves it, gap asks, model text) is rendered with textContent, never
 * innerHTML. innerHTML is used ONLY for our own static SVG built from a
 * whitelisted color palette (never from app data).
 *
 * Note on the inline <script>: it uses string concatenation, never `${}`
 * template interpolation, so the outer template literal leaves it untouched.
 */
export const PAGE = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Maison — modern dresses</title>
<style>
  :root{
    --bg:#faf6f1; --ink:#241d1b; --muted:#8a7d75; --line:#ece1d6; --card:#fffdfb;
    --wine:#8e2b4e; --wine-d:#6d1f3c; --gold:#c8952f; --blush:#f4e3e6;
    --shadow:0 10px 30px -14px rgba(60,20,30,.28); --shadow-sm:0 4px 14px -8px rgba(60,20,30,.25);
    --serif:"Iowan Old Style","Palatino Linotype",Georgia,"Times New Roman",serif;
    --sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
  }
  *{box-sizing:border-box}
  html,body{margin:0}
  body{background:var(--bg);color:var(--ink);font:15px/1.6 var(--sans);-webkit-font-smoothing:antialiased}
  a{color:inherit}
  .wrap{max-width:1120px;margin:0 auto;padding:0 24px}

  /* header */
  header{position:sticky;top:0;z-index:20;background:rgba(250,246,241,.86);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
  .bar{display:flex;align-items:center;gap:22px;height:64px}
  .brand{font:600 24px/1 var(--serif);letter-spacing:.04em}
  .brand b{color:var(--wine);font-weight:600}
  .brand small{display:block;font:400 9px/1 var(--sans);letter-spacing:.32em;color:var(--muted);margin-top:4px;text-transform:uppercase}
  nav{display:flex;gap:2px;margin-left:auto}
  nav button{border:0;background:none;font:inherit;color:var(--ink);padding:8px 14px;border-radius:999px;cursor:pointer;transition:.15s}
  nav button:hover{background:var(--blush)}
  nav button.active{background:var(--wine);color:#fff}
  .cartpill{display:inline-flex;align-items:center;gap:6px}
  .dot{min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:var(--gold);color:#fff;font:600 11px/18px var(--sans);text-align:center}

  main{min-height:calc(100vh - 64px - 58px)}

  /* hero */
  .hero{position:relative;overflow:hidden;background:
     radial-gradient(120% 120% at 12% -10%,var(--blush),transparent 55%),
     radial-gradient(120% 120% at 100% 0%,#f6efe2,transparent 50%),
     linear-gradient(180deg,#fff8f2,var(--bg));border-bottom:1px solid var(--line)}
  .hero .wrap{display:grid;grid-template-columns:1.1fr .9fr;gap:20px;align-items:center;padding:56px 24px 60px}
  .kicker{font:600 12px/1 var(--sans);letter-spacing:.28em;color:var(--gold);text-transform:uppercase}
  .hero h1{font:600 clamp(34px,5vw,54px)/1.05 var(--serif);margin:14px 0 12px;letter-spacing:-.01em}
  .hero p{color:var(--muted);font-size:17px;max-width:44ch;margin:0 0 26px}
  .cta{display:inline-flex;align-items:center;gap:9px;background:var(--wine);color:#fff;border:0;padding:14px 26px;border-radius:999px;font:600 15px var(--sans);cursor:pointer;box-shadow:var(--shadow-sm);transition:.18s}
  .cta:hover{background:var(--wine-d);transform:translateY(-1px)}
  .cta.ghost{background:transparent;color:var(--wine);box-shadow:none;border:1.5px solid var(--wine)}
  .heroart{display:flex;justify-content:center;gap:-20px}
  .heroart .fig{filter:drop-shadow(0 22px 26px rgba(90,30,45,.22))}
  .heroart .fig:nth-child(1){transform:rotate(-6deg) translateY(8px)}
  .heroart .fig:nth-child(2){transform:scale(1.12);z-index:2}
  .heroart .fig:nth-child(3){transform:rotate(6deg) translateY(8px)}
  @media(max-width:820px){.hero .wrap{grid-template-columns:1fr}.heroart{display:none}}

  /* section shell */
  .section{padding:34px 0 60px}
  .head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:20px}
  .head h2{font:600 26px/1 var(--serif);margin:0}
  .head .sub{color:var(--muted);font-size:14px}

  /* toolbar */
  .toolbar{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:22px}
  .search{display:flex;align-items:center;gap:8px;background:var(--card);border:1px solid var(--line);border-radius:999px;padding:6px 8px 6px 16px;box-shadow:var(--shadow-sm)}
  .search input{border:0;background:none;font:inherit;color:inherit;outline:none;min-width:230px}
  .search button{border:0;background:var(--ink);color:#fff;border-radius:999px;padding:8px 16px;font:600 13px var(--sans);cursor:pointer}
  .chips{display:flex;gap:8px;flex-wrap:wrap}
  .chip{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:999px;padding:7px 13px;font:500 13px var(--sans);cursor:pointer;transition:.15s}
  .chip:hover{border-color:var(--wine)}
  .chip.active{background:var(--wine);border-color:var(--wine);color:#fff}
  .chip .sw{width:12px;height:12px;border-radius:999px;box-shadow:inset 0 0 0 1px rgba(0,0,0,.08)}

  /* product grid */
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(215px,1fr));gap:22px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:18px;overflow:hidden;box-shadow:var(--shadow-sm);transition:.2s;cursor:pointer;display:flex;flex-direction:column}
  .card:hover{transform:translateY(-4px);box-shadow:var(--shadow)}
  .frame{position:relative;aspect-ratio:4/5;display:flex;align-items:center;justify-content:center;overflow:hidden}
  .frame svg{width:74%;height:auto}
  .tag{position:absolute;top:12px;left:12px;background:#fff;color:var(--wine);font:600 11px var(--sans);letter-spacing:.04em;padding:4px 9px;border-radius:999px;box-shadow:var(--shadow-sm)}
  .body{padding:13px 15px 16px;display:flex;flex-direction:column;gap:5px;flex:1}
  .nm{font:600 15px/1.3 var(--serif);min-height:2.5em}
  .mt{color:var(--muted);font-size:12.5px;text-transform:capitalize}
  .foot{display:flex;align-items:center;justify-content:space-between;margin-top:auto;padding-top:8px}
  .price{font:600 16px var(--sans)}
  .add{border:0;background:var(--blush);color:var(--wine);font:600 13px var(--sans);border-radius:999px;padding:8px 15px;cursor:pointer;transition:.15s}
  .add:hover{background:var(--wine);color:#fff}
  .empty{color:var(--muted);text-align:center;padding:60px 0}

  /* product detail */
  .detail{display:grid;grid-template-columns:.9fr 1.1fr;gap:40px;align-items:center}
  @media(max-width:760px){.detail{grid-template-columns:1fr}}
  .stage{aspect-ratio:1;border-radius:22px;display:flex;align-items:center;justify-content:center;box-shadow:var(--shadow)}
  .stage svg{width:56%}
  .detail h2{font:600 34px/1.05 var(--serif);margin:6px 0 6px}
  .sizes{display:flex;gap:8px;margin:16px 0 22px}
  .sizes span{width:40px;height:40px;display:grid;place-items:center;border:1px solid var(--line);border-radius:12px;font:600 13px var(--sans);background:var(--card)}
  .sizes span.on{border-color:var(--wine);background:var(--wine);color:#fff}
  .bignum{font:600 26px var(--sans);color:var(--wine)}

  /* cart / checkout / orders */
  .panel{background:var(--card);border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow-sm);padding:8px 20px}
  .li{display:flex;align-items:center;gap:16px;padding:14px 0;border-bottom:1px solid var(--line)}
  .li:last-child{border-bottom:0}
  .li .mini{width:52px;height:64px;border-radius:12px;display:flex;align-items:center;justify-content:center}
  .li .mini svg{width:70%}
  .li .grow{flex:1}
  .summary{display:flex;align-items:center;justify-content:space-between;margin:22px 0}
  .summary .big{font:600 22px var(--serif)}
  .note{display:flex;gap:10px;align-items:flex-start;background:var(--blush);border-radius:14px;padding:12px 16px;margin-top:16px;font-size:14px;color:var(--wine-d)}
  .order{display:flex;align-items:center;gap:14px;padding:16px 0;border-bottom:1px solid var(--line)}
  .status{margin-left:auto;font:600 12px var(--sans);text-transform:uppercase;letter-spacing:.05em;color:var(--gold);background:#fff6e6;padding:5px 11px;border-radius:999px}

  footer{border-top:1px solid var(--line);color:var(--muted);font-size:12.5px}
  footer .wrap{display:flex;gap:18px;flex-wrap:wrap;height:57px;align-items:center}
  footer b{color:var(--ink)}
  .hbtn{margin-left:auto;background:transparent;border:1px solid var(--line);color:var(--muted);border-radius:999px;padding:3px 11px;font:600 12px var(--sans);cursor:pointer}
  .hbtn:hover{color:var(--ink);border-color:var(--ink)}
  .hpanel{position:fixed;left:24px;bottom:24px;z-index:42;width:470px;max-width:calc(100vw - 32px);background:var(--card);border:1px solid var(--line);border-radius:16px;box-shadow:0 30px 70px -20px rgba(60,20,30,.5);display:flex;flex-direction:column;overflow:hidden}
  .hph{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--line);font-size:14px}
  .hverdict{font:600 12px var(--sans);padding:2px 9px;border-radius:999px}
  .hverdict.ok{background:#1f8a5422;color:#1f8a54}
  .hverdict.bad{background:#a11f3c18;color:var(--wine)}
  .hph .x{margin-left:auto;background:transparent;border:0;font-size:16px;cursor:pointer;color:var(--muted)}
  .htabs{display:flex;gap:6px;padding:10px 14px 0}
  .ht{background:transparent;border:1px solid var(--line);border-radius:999px;padding:4px 12px;font:600 12.5px var(--sans);cursor:pointer;color:var(--muted)}
  .ht.on{background:var(--ink);color:#fff;border-color:var(--ink)}
  .hout{margin:12px 14px;padding:12px;background:var(--bg);border:1px solid var(--line);border-radius:10px;font:12px/1.55 ui-monospace,Menlo,monospace;white-space:pre-wrap;overflow:auto;max-height:46vh;color:var(--ink)}
  .hfoot{padding:10px 14px;border-top:1px solid var(--line);color:var(--muted);font-size:11.5px}

  /* ── floating assistant popup ── */
  .fab{position:fixed;right:24px;bottom:24px;z-index:40;display:inline-flex;align-items:center;gap:10px;background:var(--wine);color:#fff;border:0;border-radius:999px;padding:14px 20px;font:600 15px var(--sans);cursor:pointer;box-shadow:0 16px 34px -12px rgba(120,30,60,.6);transition:.2s}
  .fab:hover{background:var(--wine-d);transform:translateY(-2px)}
  .fab .pulse{width:9px;height:9px;border-radius:999px;background:#7CFFB2;box-shadow:0 0 0 0 rgba(124,255,178,.7);animation:beat 1.8s infinite}
  @keyframes beat{0%{box-shadow:0 0 0 0 rgba(124,255,178,.6)}70%{box-shadow:0 0 0 9px rgba(124,255,178,0)}100%{box-shadow:0 0 0 0 rgba(124,255,178,0)}}

  .modal{position:fixed;right:24px;bottom:24px;z-index:41;width:390px;max-width:calc(100vw - 32px);height:600px;max-height:calc(100vh - 48px);background:var(--card);border:1px solid var(--line);border-radius:20px;box-shadow:0 30px 70px -20px rgba(60,20,30,.5);display:flex;flex-direction:column;overflow:hidden;transform-origin:bottom right;animation:pop .22s cubic-bezier(.2,.9,.3,1.2)}
  @keyframes pop{from{opacity:0;transform:translateY(14px) scale(.96)}to{opacity:1;transform:none}}
  .mhead{display:flex;align-items:center;gap:11px;padding:15px 16px;background:linear-gradient(135deg,var(--wine),var(--wine-d));color:#fff}
  .mhead .av{width:34px;height:34px;border-radius:999px;background:rgba(255,255,255,.18);display:grid;place-items:center;font-size:17px}
  .mhead .t{font:600 15px var(--sans);line-height:1.15}
  .mhead .t small{display:block;font-weight:400;opacity:.8;font-size:11px}
  .mhead .x{margin-left:auto;background:rgba(255,255,255,.16);border:0;color:#fff;width:30px;height:30px;border-radius:999px;font-size:15px;cursor:pointer}
  .mhead .x:hover{background:rgba(255,255,255,.3)}
  #log{flex:1;overflow:auto;padding:16px 15px;display:flex;flex-direction:column;gap:10px;background:
    radial-gradient(140% 60% at 100% 0%,var(--blush),transparent 60%),var(--card)}
  .msg{padding:9px 13px;border-radius:15px;max-width:86%;white-space:pre-wrap;font-size:14px;line-height:1.5;box-shadow:var(--shadow-sm)}
  .user{align-self:flex-end;background:var(--wine);color:#fff;border-bottom-right-radius:5px}
  .bot{align-self:flex-start;background:#fff;border:1px solid var(--line);border-bottom-left-radius:5px}
  .sys{align-self:center;font-size:12px;color:var(--muted);text-align:center}
  .working{color:var(--wine);font-weight:600;animation:fade 1.1s ease-in-out infinite}
  @keyframes fade{0%,100%{opacity:.5}50%{opacity:1}}
  .confirm{align-self:stretch;background:#fff;border:1px solid var(--gold);border-radius:15px;padding:14px;text-align:center;font-size:14px;box-shadow:var(--shadow-sm)}
  .confirm .q{margin-bottom:10px}
  .confirm button{margin:0 5px;padding:8px 18px;border-radius:10px;border:0;cursor:pointer;font:600 14px var(--sans)}
  .yes{background:#1e9e5a;color:#fff}.no{background:#efe7e0;color:var(--ink)}
  form{display:flex;gap:8px;padding:12px;border-top:1px solid var(--line);background:var(--card)}
  #m{flex:1;padding:11px 14px;border-radius:12px;border:1px solid var(--line);background:var(--bg);font:inherit;color:inherit;outline:none}
  #m:focus{border-color:var(--wine)}
  .send{border:0;background:var(--wine);color:#fff;border-radius:12px;padding:0 16px;font:600 14px var(--sans);cursor:pointer}
  [hidden]{display:none!important}
</style>
</head>
<body>
<header><div class="wrap bar">
  <div class="brand"><b>Maison</b><small>Modern Dresses</small></div>
  <nav id="nav"></nav>
</div></header>

<main id="main"></main>

<footer><div class="wrap">
  <span id="mode"></span><span id="whereami"></span><span id="gapcount"></span>
  <span>you &amp; the assistant share <b>one live session</b></span>
  <button id="healthbtn" class="hbtn">◇ Graph health</button>
</div></footer>

<div id="hpanel" class="hpanel" hidden>
  <div class="hph"><b>Graph health</b><span id="hverdict" class="hverdict"></span><button id="hx" class="x" title="Close">✕</button></div>
  <div class="htabs"><button id="htLive" class="ht on">Live graph</button><button id="htDrift" class="ht">A drifted example</button></div>
  <pre id="hout" class="hout"></pre>
  <div class="hfoot">Static one-call check — <b>checkGraph()</b> from hcifootprint/testing. It surfaces drift; your team owns the fix.</div>
</div>

<button id="fab" class="fab"><span class="pulse"></span> Ask our stylist</button>
<div id="modal" class="modal" hidden>
  <div class="mhead">
    <div class="av">✨</div>
    <div class="t">Maison Stylist<small id="msub">powered by Claude Opus</small></div>
    <button id="reset" class="x" title="Start a fresh session — clears the chat, cart, and orders">↺</button>
    <button id="mx" class="x" style="margin-left:6px">✕</button>
  </div>
  <div id="log"><div class="sys">Hi! Ask me to find and buy a dress — try "find me a red dress under $150 and buy the cheapest one".</div></div>
  <form id="f"><input id="m" autocomplete="off" placeholder="Message the stylist…" /><button class="send">Send</button></form>
</div>

<script>
var PAL = { red:['#e8556d','#a11f3c'], black:['#454049','#1b1a20'], white:['#fbf7f2','#dcd3c8'],
  blue:['#5aa6e0','#215b96'], green:['#5cc98a','#1f8a54'], pink:['#f4a6c4','#d16295'],
  yellow:['#f6d365','#d9a521'] };
var COLORS = ['red','black','white','blue','green','pink','yellow'];
var PAGES = [['home','Home'],['catalog','Dresses'],['cart','Cart'],['orders','Orders']];
var view = null, searchDraft = '', lastVersion = -1, unread = false;

function $(id){ return document.getElementById(id); }
function el(tag,cls,text){ var n=document.createElement(tag); if(cls)n.className=cls; if(text!==undefined)n.textContent=text; return n; }
async function post(url,body){ var r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}); return r.json(); }
async function app(method,args){ var r=await post('/api/app',{method:method,args:args}); if(r&&!r.ok&&r.error) toast('⚠ '+r.error); await refresh(); }
function toast(t){ var d=el('div','sys',t); $('log').appendChild(d); $('log').scrollTop=1e9; }

// our OWN static svg from a whitelisted palette (never app text) — innerHTML-safe
function dressSVG(color, w){
  // color only INDEXES the whitelisted palette; the id is sanitized to alnum so
  // even a hostile color string can never break out of the SVG markup.
  var c = PAL[color] || ['#cfc6bd','#a99f95'], id='g'+String(color).replace(/[^a-z0-9]/gi,'')+Math.round(w||0);
  return '<svg viewBox="0 0 120 160" class="fig" width="'+(w||120)+'" xmlns="http://www.w3.org/2000/svg">'
    + '<defs><linearGradient id="'+id+'" x1="0" y1="0" x2="1" y2="1">'
    + '<stop offset="0" stop-color="'+c[0]+'"/><stop offset="1" stop-color="'+c[1]+'"/></linearGradient></defs>'
    + '<path d="M50 20 Q60 30 70 20" fill="none" stroke="'+c[1]+'" stroke-width="2.4"/>'
    + '<path d="M48 21 L44 40 M72 21 L76 40" stroke="'+c[1]+'" stroke-width="2.4" fill="none"/>'
    + '<path d="M44 40 Q60 34 76 40 L67 78 Q104 108 92 146 Q60 158 28 146 Q16 108 53 78 Z" '
    + 'fill="url(#'+id+')" stroke="'+c[1]+'" stroke-width="1.2"/>'
    + '<path d="M53 78 Q60 82 67 78 L64 92 Q60 96 56 92 Z" fill="'+c[1]+'" opacity=".35"/>'
    + '<path d="M53 78 Q30 108 34 143 Q46 149 52 146 Q40 108 60 82 Z" fill="#fff" opacity=".14"/>'
    + '</svg>';
}
function swatchEl(color, w, radius){
  var d=el('div'); d.style.background='linear-gradient(150deg,'+(PAL[color]?PAL[color][0]:'#eee')+'22,'+(PAL[color]?PAL[color][1]:'#ddd')+'14)';
  d.innerHTML=dressSVG(color, w); if(radius)d.style.borderRadius=radius; return d;
}

function renderNav(){
  var nav=$('nav'); nav.textContent='';
  PAGES.forEach(function(p){
    var b=el('button', view&&view.node===p[0]?'active':'', p[1]);
    if(p[0]==='cart'&&view&&view.cart.length){ b.textContent=''; var s=el('span','cartpill'); s.appendChild(el('span',null,'Cart')); s.appendChild(el('span','dot',String(view.cart.length))); b.appendChild(s); if(view.node==='cart')b.classList.add('active'); }
    b.onclick=function(){ p[0]==='catalog'?openCatalog():app('navigate',{page:p[0]}); };
    nav.appendChild(b);
  });
}
async function openCatalog(){ await app('browseCatalog'); if(view&&view.results.length===0) await app('search',{query:''}); }

function wrap(node){ var w=el('div','wrap'); w.appendChild(node); return w; }

function renderMain(){
  var m=$('main'); m.textContent=''; if(!view) return; var page=view.node;

  if(page==='home'){
    var hero=el('div','hero'), hw=el('div','wrap');
    var left=el('div');
    left.appendChild(el('div','kicker','The Spring Edit'));
    left.appendChild(el('h1','','Dresses for every day it matters.'));
    left.appendChild(el('p','','Browse the collection yourself — or ask our AI stylist to find, filter, and check out for you. Every move lands in the same live session.'));
    var row=el('div'); var shop=el('button','cta','Shop the collection  →'); shop.onclick=openCatalog;
    var ask=el('button','cta ghost','Ask the stylist'); ask.style.marginLeft='10px'; ask.onclick=openModal;
    row.append(shop,ask); left.appendChild(row);
    var art=el('div','heroart'); ['pink','red','black'].forEach(function(c){ art.innerHTML+=dressSVG(c,150); });
    hw.append(left,art); hero.appendChild(hw); m.appendChild(hero);

    var sec=el('div','section'), sw=el('div','wrap');
    var hd=el('div','head'); var h2=el('div'); h2.appendChild(el('h2','','Just in')); hd.appendChild(h2);
    var more=el('button','chip','View all'); more.onclick=openCatalog; hd.appendChild(more);
    sw.appendChild(hd);
    var grid=el('div','grid'); DUMMY_PREVIEW().forEach(function(d){ grid.appendChild(previewCard(d)); });
    sw.appendChild(grid); sec.appendChild(sw); m.appendChild(sec);
    return;
  }

  var sec=el('div','section wrap');

  if(page==='catalog'){
    var hd=el('div','head'); var hl=el('div'); hl.appendChild(el('h2','','Dresses'));
    hl.appendChild(el('div','sub', view.results.length+' style'+(view.results.length===1?'':'s')+(view.activeColor?' · '+view.activeColor:'')));
    hd.appendChild(hl); sec.appendChild(hd);

    var bar=el('div','toolbar');
    var sb=el('div','search'); var inp=el('input'); inp.placeholder='Search silk, red, linen…'; inp.value=searchDraft;
    inp.oninput=function(){ searchDraft=inp.value; };
    inp.onkeydown=function(e){ if(e.key==='Enter'){ e.preventDefault(); app('search',{query:inp.value}); } };
    var sgo=el('button',null,'Search'); sgo.onclick=function(){ app('search',{query:inp.value}); };
    sb.append(inp,sgo); bar.appendChild(sb);
    var chips=el('div','chips');
    COLORS.forEach(function(c){
      var ch=el('button','chip'+(view.activeColor===c?' active':'')); var sw2=el('span','sw'); sw2.style.background=PAL[c]?PAL[c][0]:'#ccc'; ch.append(sw2, el('span',null,c));
      ch.onclick=function(){ app('filterByColor',{color:c}); }; chips.appendChild(ch);
    });
    var all=el('button','chip','All'); all.onclick=function(){ app('search',{query:''}); }; chips.appendChild(all);
    bar.appendChild(chips); sec.appendChild(bar);

    if(view.results.length===0){ sec.appendChild(el('div','empty','No dresses match — try another search, or press “All”.')); m.appendChild(sec); return; }
    var grid=el('div','grid'); view.results.forEach(function(d){ grid.appendChild(productCard(d)); });
    sec.appendChild(grid); m.appendChild(sec); return;
  }

  if(page==='product'){
    var d=view.selectedDress;
    if(!d){ sec.appendChild(el('div','empty','No dress selected.')); m.appendChild(sec); return; }
    var det=el('div','detail');
    var stage=swatchEl(d.color,undefined,'22px'); stage.className='stage'; stage.style.background='linear-gradient(150deg,'+(PAL[d.color]?PAL[d.color][0]:'#eee')+'2b,'+(PAL[d.color]?PAL[d.color][1]:'#ddd')+'18)';
    det.appendChild(stage);
    var info=el('div');
    info.appendChild(el('div','kicker','Maison Atelier'));
    info.appendChild(el('h2','',d.name));
    info.appendChild(el('div','mt',d.color+' · premium fabric'));
    info.appendChild(el('div','bignum','$'+d.price));
    var sizes=el('div','sizes'); ['XS','S','M','L'].forEach(function(s){ sizes.appendChild(el('span',s===d.size?'on':'',s)); }); info.appendChild(sizes);
    var add=el('button','cta','Add to cart'); add.onclick=function(){ app('addToCart'); };
    var back=el('button','cta ghost','← Back'); back.style.marginLeft='10px'; back.onclick=function(){ app('navigate',{page:'catalog'}); };
    var r=el('div'); r.append(add,back); info.appendChild(r);
    det.appendChild(info); sec.appendChild(det); m.appendChild(sec); return;
  }

  if(page==='cart'){
    sec.appendChild(headOnly('Your cart'));
    if(view.cart.length===0){ sec.appendChild(el('div','empty','Your cart is empty.')); m.appendChild(sec); return; }
    var panel=el('div','panel'), total=0;
    view.cart.forEach(function(d){ total+=d.price; var li=el('div','li');
      var mini=swatchEl(d.color,undefined,'12px'); mini.className='mini'; li.appendChild(mini);
      var g=el('div','grow'); g.appendChild(el('div','nm',d.name)); g.appendChild(el('div','mt',d.color+' · size '+d.size)); li.appendChild(g);
      li.appendChild(el('div','price','$'+d.price)); panel.appendChild(li); });
    sec.appendChild(panel);
    var sum=el('div','summary'); sum.appendChild(el('span','','Total')); sum.appendChild(el('span','big','$'+total)); sec.appendChild(sum);
    var go=el('button','cta','Proceed to checkout'); go.onclick=function(){ app('checkout'); }; sec.appendChild(go);
    m.appendChild(sec); return;
  }

  if(page==='checkout'){
    sec.appendChild(headOnly('Checkout'));
    var total=0; view.cart.forEach(function(d){ total+=d.price; });
    var panel=el('div','panel');
    view.cart.forEach(function(d){ var li=el('div','li'); var mini=swatchEl(d.color,undefined,'12px'); mini.className='mini'; li.appendChild(mini);
      var g=el('div','grow'); g.appendChild(el('div','nm',d.name)); g.appendChild(el('div','mt','size '+d.size)); li.appendChild(g); li.appendChild(el('div','price','$'+d.price)); panel.appendChild(li); });
    sec.appendChild(panel);
    var sum=el('div','summary'); sum.appendChild(el('span','',view.cart.length+' item'+(view.cart.length===1?'':'s'))); sum.appendChild(el('span','big','$'+total)); sec.appendChild(sum);
    var place=el('button','cta','Place order'); place.onclick=function(){ app('placeOrder'); }; sec.appendChild(place);
    if(view.lastOrder){ var n=el('div','note'); n.appendChild(el('span',null,'✓')); n.appendChild(el('span',null,'Order '+view.lastOrder.id+' placed — $'+view.lastOrder.total+'. See Orders.')); sec.appendChild(n); }
    m.appendChild(sec); return;
  }

  if(page==='orders'){
    sec.appendChild(headOnly('Your orders'));
    if(view.orders.length===0){ sec.appendChild(el('div','empty','No orders yet.')); m.appendChild(sec); return; }
    var panel=el('div','panel');
    view.orders.forEach(function(o){ var row=el('div','order');
      row.appendChild(el('strong',null,o.id)); row.appendChild(el('span','mt',o.count+' item'+(o.count===1?'':'s')+' · $'+o.total));
      row.appendChild(el('span','status',o.status));
      var chk=el('button','add','Check status'); chk.onclick=function(){ app('checkOrderStatus',{orderId:o.id}); }; row.appendChild(chk);
      panel.appendChild(row); });
    sec.appendChild(panel);
    if(view.orderStatusMessage){ var n=el('div','note'); n.appendChild(el('span',null,'📦')); n.appendChild(el('span',null,view.orderStatusMessage)); sec.appendChild(n); }
    m.appendChild(sec); return;
  }
}
function headOnly(t){ var hd=el('div','head'); var h=el('div'); h.appendChild(el('h2','',t)); hd.appendChild(h); return hd; }

// Home preview + card builders (preview uses static dummy items; catalog uses live results)
function DUMMY_PREVIEW(){ return [
  {id:'d3',name:'Floral Wrap Dress',color:'red',size:'M',price:120},
  {id:'d10',name:'Blush Tulle Gown',color:'pink',size:'S',price:210},
  {id:'d2',name:'Evening Silk Gown',color:'black',size:'S',price:249},
  {id:'d8',name:'Ocean Breeze Maxi',color:'blue',size:'S',price:110}]; }
function previewCard(d){ var c=productCard(d); c.onclick=openCatalog; return c; }
function productCard(d){
  var card=el('div','card');
  var frame=swatchEl(d.color,undefined); frame.className='frame'; frame.style.background='linear-gradient(150deg,'+(PAL[d.color]?PAL[d.color][0]:'#eee')+'26,'+(PAL[d.color]?PAL[d.color][1]:'#ddd')+'12)';
  if(d.price>=200){ var tag=el('span','tag','Premium'); frame.appendChild(tag); }
  card.appendChild(frame);
  var body=el('div','body'); body.appendChild(el('div','nm',d.name)); body.appendChild(el('div','mt',d.color+' · size '+d.size));
  var foot=el('div','foot'); foot.appendChild(el('div','price','$'+d.price));
  var add=el('button','add','View'); add.onclick=function(e){ e.stopPropagation(); app('openDress',{dressId:d.id}); }; foot.appendChild(add);
  body.appendChild(foot); card.appendChild(body);
  card.onclick=function(){ app('openDress',{dressId:d.id}); };
  return card;
}

function setMode(m){
  var el=$('mode'); el.textContent = m==='mcp' ? 'assistant: over MCP' : 'assistant: direct (no MCP)';
  el.style.cssText='background:'+(m==='mcp'?'var(--wine)':'#555')+';color:#fff;padding:2px 9px;border-radius:999px;font-weight:600';
}
async function refresh(){
  var r=await fetch('/api/view'); view=await r.json();
  renderNav(); renderMain();
  setMode(view.mode);
  $('whereami').textContent='you are on: '+view.node+' (v'+view.version+')';
  $('gapcount').textContent='gap ledger: '+view.gaps+' row'+(view.gaps===1?'':'s');
  lastVersion=view.version;
}
setInterval(async function(){
  try{ var r=await fetch('/api/view'); var v=await r.json();
    if(v.version!==lastVersion){ view=v; lastVersion=v.version; renderNav(); renderMain();
      $('whereami').textContent='you are on: '+v.node+' (v'+v.version+')';
      $('gapcount').textContent='gap ledger: '+v.gaps+' row'+(v.gaps===1?'':'s'); }
  }catch(e){}
}, 1400);

/* ── assistant popup ── */
function openModal(){ $('modal').hidden=false; $('fab').hidden=true; unread=false; setTimeout(function(){ $('m').focus(); },50); $('log').scrollTop=1e9; }
function closeModal(){ $('modal').hidden=true; $('fab').hidden=false; }
$('fab').onclick=openModal; $('mx').onclick=closeModal;

// Start fresh: rebuild the shop + session + assistant server-side, clear the
// chat, and re-render the storefront. Stays open so you can test again at once.
$('reset').onclick=async function(){
  $('reset').disabled=true; $('reset').textContent='…';
  try{ await post('/api/reset',{}); }catch(e){}
  $('log').textContent='';
  add('sys','✨ Fresh session — chat, cart, and orders cleared. Ask away!');
  await refresh();
  $('reset').textContent='↺'; $('reset').disabled=false;
};

function add(cls,text){ var d=el('div','msg '+cls,text); $('log').appendChild(d); $('log').scrollTop=1e9; return d; }
async function withStatus(request){
  var status=add('sys','…thinking'); status.classList.add('working'); var polling=true;
  (async function(){ while(polling){ try{ var a=await (await fetch('/api/activity')).json(); if(a.steps&&a.steps.length) status.textContent='⋯ '+a.steps[a.steps.length-1]; }catch(e){} await new Promise(function(r){setTimeout(r,350);}); } })();
  try{ return await request(); } finally { polling=false; status.remove(); }
}
function renderTurn(turn){
  if(turn.error){ add('sys','⚠ '+turn.error); return; }
  if(turn.type==='confirm'){
    if($('modal').hidden) openModal();
    var box=el('div','confirm'); box.appendChild(el('div','q',turn.summary));
    var yes=el('button','yes','Approve'), no=el('button','no','Decline'); box.append(yes,no);
    $('log').appendChild(box); $('log').scrollTop=1e9;
    var answer=async function(ok){ box.remove(); add('sys', ok?'✔ approved':'✘ declined'); renderTurn(await withStatus(function(){ return post('/api/confirm',{approved:ok}); })); refresh(); };
    yes.onclick=function(){ answer(true); }; no.onclick=function(){ answer(false); }; return;
  }
  add('bot',turn.text);
  if($('modal').hidden){ unread=true; }
}
$('f').onsubmit=async function(e){
  e.preventDefault(); var msg=$('m').value.trim(); if(!msg) return; $('m').value='';
  add('user',msg); var turn=await withStatus(function(){ return post('/api/chat',{message:msg}); });
  renderTurn(turn); refresh();
};

/* ── graph health panel ── */
var HEALTH=null, hvariant='real';
async function openHealth(){
  $('hpanel').hidden=false;
  if(!HEALTH){ $('hout').textContent='Checking…'; try{ HEALTH=await (await fetch('/api/health')).json(); }catch(e){ $('hout').textContent='Could not load graph health.'; return; } }
  renderHealth();
}
function renderHealth(){
  if(!HEALTH) return;
  var h=HEALTH[hvariant]; if(!h) return;
  var v=$('hverdict');
  v.textContent = h.ok ? '✓ healthy' : ('✗ '+h.errors+' error'+(h.errors===1?'':'s')+(h.warnings?(', '+h.warnings+' warning'+(h.warnings===1?'':'s')):''));
  v.className='hverdict '+(h.ok?'ok':'bad');
  $('hout').textContent=h.summary;
  $('htLive').className='ht'+(hvariant==='real'?' on':'');
  $('htDrift').className='ht'+(hvariant==='drifted'?' on':'');
}
$('healthbtn').onclick=openHealth;
$('hx').onclick=function(){ $('hpanel').hidden=true; };
$('htLive').onclick=function(){ hvariant='real'; renderHealth(); };
$('htDrift').onclick=function(){ hvariant='drifted'; renderHealth(); };

refresh();
</script>
</body>
</html>`;
