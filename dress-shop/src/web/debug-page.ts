/**
 * The /debug page — an agent DEBUGGER for the dress-shop assistant, powered by
 * AgentThinkingUI (atui). It drives the SAME live session as the storefront, so
 * you chat here and watch the agent's reasoning render beat-by-beat: whats_here
 * → open a skill → fire steps → the answer.
 *
 * ISOLATION MATTERS: atui scopes its CSS under `.atui` with zero-specificity
 * `:where(...)` selectors so a host can theme it and it never leaks OUT — but
 * that means a host's NAKED GLOBAL classes (the storefront's own `.stage`,
 * `.panel`, …) leak INTO atui and break its layout. So atui must live in its own
 * document. This page IS that document (only atui + minimal chrome, none of the
 * storefront's classes), and the storefront's in-chat debugger embeds THIS page
 * in an iframe (?embed=1) — a clean CSS boundary, the consumer's responsibility.
 *
 * No bundler: atui ships a UMD build that reads React/ReactDOM from globals, so
 * we load React + ReactDOM + the atui UMD + its stylesheet from a CDN, then mount
 * <AgentThinkingUI trace={…}/> via React.createElement (no JSX). The trace is
 * agentfootprint's `agentThinkingTrace()` output (atui's native shape), served
 * from GET /api/trace.
 */
export const DEBUG_PAGE = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Dress-shop · Agent debugger</title>
<link rel="stylesheet" href="/vendor/atui.css" />
<style>
  :root{ --bg:#faf6f1; --ink:#241d1b; --muted:#8a7d75; --line:#ece1d6; --card:#fffdfb; --wine:#8e2b4e; --sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif }
  *{box-sizing:border-box}
  [hidden]{display:none !important}
  html,body{margin:0;height:100%}
  body{background:var(--bg);color:var(--ink);font:15px/1.5 var(--sans);display:flex;flex-direction:column}
  header{display:flex;align-items:center;gap:14px;padding:12px 18px;border-bottom:1px solid var(--line);background:var(--card)}
  header .t{font-weight:700}
  header .sub{color:var(--muted);font-size:12.5px}
  header a{margin-left:auto;color:var(--wine);text-decoration:none;font-weight:600;font-size:13px}
  #root{flex:1;min-height:0;overflow:hidden}
  .ph{height:100%;display:flex;align-items:center;justify-content:center;color:var(--muted);padding:40px;text-align:center}
  #reply{padding:10px 18px;border-top:1px solid var(--line);background:#fffdfb;color:var(--ink);font-size:14px}
  #confirm{display:flex;align-items:center;gap:12px;padding:12px 18px;border-top:1px solid var(--line);background:#fff7f2}
  #confirm .q{flex:1}
  #confirm button{border:0;border-radius:999px;padding:8px 16px;font:600 13px var(--sans);cursor:pointer}
  #cyes{background:var(--wine);color:#fff} #cno{background:#eee;color:#333}
  .bar{display:flex;gap:10px;padding:14px 18px;border-top:1px solid var(--line);background:var(--card)}
  .bar input{flex:1;padding:11px 14px;border:1px solid var(--line);border-radius:12px;font:15px var(--sans);background:#fff;color:var(--ink)}
  .bar button{background:var(--wine);color:#fff;border:0;border-radius:12px;padding:11px 20px;font:600 15px var(--sans);cursor:pointer}
  /* embed mode (iframed inside the storefront modal): just atui, no chrome */
  body.embed > header, body.embed > .bar, body.embed > #reply, body.embed > #confirm{display:none !important}
  body.embed{background:var(--card)}
</style>
</head>
<body>
<header>
  <span class="t">🐛 Agent debugger</span>
  <span class="sub">watch the stylist think — same live session as the shop</span>
  <a href="/">← back to the storefront</a>
</header>
<div id="root"></div>
<div id="reply" hidden></div>
<div id="confirm" hidden><span class="q" id="csum"></span><button id="cyes">Approve</button><button id="cno">Decline</button></div>
<div class="bar">
  <input id="msg" autocomplete="off" placeholder='Try: "find me a red dress under $150 and buy the cheapest one"' />
  <button id="send">Send</button>
</div>

<script src="https://unpkg.com/react@18.3.1/umd/react.production.min.js"></script>
<script src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js"></script>
<script src="/vendor/atui.umd.js"></script>
<script>
  function $(id){ return document.getElementById(id); }
  async function post(url,body){ var r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}); return r.json(); }
  var EMBED = /[?&]embed/.test(location.search);
  if(EMBED) document.body.classList.add('embed');

  if(!window.AgentThinkingUI){ $('root').innerHTML='<div class="ph">Could not load AgentThinkingUI from the CDN — check your connection.</div>'; }
  var root = window.AgentThinkingUI ? ReactDOM.createRoot($('root')) : null;
  var running=false, trace=null;

  function render(){
    if(!root) return;
    if(!trace || !trace.steps || !trace.steps.length){
      root.render(React.createElement('div',{className:'ph'}, running ? 'The agent is thinking…' : 'Ask the stylist below — the reasoning renders here as it thinks.'));
      return;
    }
    var last=trace.steps[trace.steps.length-1];
    var live = running || (EMBED && last && last.kind!=='answer');
    root.render(React.createElement(window.AgentThinkingUI, {
      trace: trace, live: live, theme:{ mode:'light' }, labels:{ agent:'Maison Stylist' }, toolMenu:'rack',
      onExplain: onExplain
    }));
  }
  // The REAL "why this tool?": hand atui's prepared prompt to Claude (server-side,
  // where the key lives) and return the model's own reasoning — replaces the proxy.
  async function onExplain(args){
    try{ var r=await post('/api/explain', { prompt: args.prompt, kind: args.kind }); return { reason: r.reason || r.error || '(no explanation)' }; }
    catch(e){ return { reason: '⚠ '+e }; }
  }
  async function pull(){ try{ var t=await (await fetch('/api/trace')).json(); if(t){ trace=t; render(); } }catch(e){} }

  function askConfirm(q){
    return new Promise(function(resolve){
      $('csum').textContent=q.summary; $('confirm').hidden=false;
      $('cyes').onclick=function(){ $('confirm').hidden=true; resolve(true); };
      $('cno').onclick=function(){ $('confirm').hidden=true; resolve(false); };
    });
  }
  async function runTurn(first){
    running=true; $('reply').hidden=true; render();
    var timer=setInterval(pull,500);
    try{
      var turn=await first;
      while(turn && turn.type==='confirm'){
        clearInterval(timer);
        var approved=await askConfirm(turn.question);
        running=true; render(); timer=setInterval(pull,500);
        turn=await post('/api/confirm',{approved:approved});
      }
      if(turn && turn.type==='reply'){ $('reply').textContent='💬 '+turn.text; $('reply').hidden=false; }
      else if(turn && turn.error){ $('reply').textContent='⚠ '+turn.error; $('reply').hidden=false; }
    }catch(e){ $('reply').textContent='⚠ '+e; $('reply').hidden=false; }
    finally{ clearInterval(timer); running=false; await pull(); render(); }
  }

  $('send').onclick=function(){ var m=$('msg').value.trim(); if(!m) return; $('msg').value=''; runTurn(post('/api/chat',{message:m})); };
  $('msg').addEventListener('keydown',function(e){ if(e.key==='Enter'){ e.preventDefault(); $('send').click(); } });

  if(EMBED){
    // Embedded in the storefront modal: no chat here — just mirror the current
    // turn's reasoning, polling so it stays fresh if opened mid-turn.
    pull();
    setInterval(pull, 900);
  } else {
    render();
  }
</script>
</body>
</html>`;
