/** The single-page chat UI, inlined so the server has zero static-file deps. */
export const PAGE = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>dress-shop assistant · HCIFootprint demo</title>
<style>
  :root { color-scheme: light dark; --edge:#8884; --hi:#c0392b; }
  * { box-sizing: border-box; }
  body { margin:0; font:15px/1.5 system-ui,sans-serif; display:grid; grid-template-columns:1fr 340px; height:100vh; }
  @media (max-width:820px){ body{grid-template-columns:1fr; height:auto} .side{border-left:0;border-top:1px solid var(--edge)} }
  header { grid-column:1/-1; padding:12px 18px; border-bottom:1px solid var(--edge); }
  header b { color:var(--hi); } header small { opacity:.6; }
  .chat { display:flex; flex-direction:column; height:calc(100vh - 54px); }
  @media (max-width:820px){ .chat{height:70vh} }
  #log { flex:1; overflow:auto; padding:16px; display:flex; flex-direction:column; gap:10px; }
  .msg { padding:9px 13px; border-radius:12px; max-width:82%; white-space:pre-wrap; }
  .user { align-self:flex-end; background:var(--hi); color:#fff; }
  .bot  { align-self:flex-start; background:#8882; }
  .sys  { align-self:center; font-size:12px; opacity:.65; }
  .confirm { align-self:center; background:#f39c1233; border:1px solid #f39c12; border-radius:12px; padding:12px; text-align:center; max-width:90%; }
  .confirm button { margin:8px 6px 0; padding:7px 18px; border-radius:8px; border:0; cursor:pointer; font-weight:600; }
  .yes { background:#27ae60; color:#fff; } .no { background:#8884; }
  form { display:flex; gap:8px; padding:12px 16px; border-top:1px solid var(--edge); }
  input[type=text] { flex:1; padding:10px 12px; border-radius:10px; border:1px solid var(--edge); background:transparent; color:inherit; font:inherit; }
  button.send { padding:0 18px; border-radius:10px; border:0; background:var(--hi); color:#fff; cursor:pointer; font-weight:600; }
  .side { border-left:1px solid var(--edge); padding:14px 16px; overflow:auto; }
  .side h3 { margin:14px 0 6px; font-size:12px; text-transform:uppercase; letter-spacing:.05em; opacity:.6; }
  pre { margin:0; font:12px/1.45 ui-monospace,monospace; white-space:pre-wrap; word-break:break-word; }
  .gap { border-left:3px solid #f39c12; padding:2px 8px; margin:4px 0; font-size:12px; }
  .empty { opacity:.5; font-size:12px; }
</style>
</head>
<body>
<header><b>dress-shop</b> assistant &nbsp;<small>an agentfootprint agent driving a plain app through HCIFootprint — you and it share one session</small></header>
<div class="chat">
  <div id="log">
    <div class="sys">Try: "find me a red floral dress and buy it" — you'll be asked to confirm the order.</div>
  </div>
  <form id="f"><input id="m" type="text" autocomplete="off" placeholder="Message the assistant…" autofocus /><button class="send">Send</button></form>
</div>
<div class="side">
  <h3>You are on</h3><pre id="node">—</pre>
  <h3>Live app state</h3><pre id="state">—</pre>
  <h3>Gap ledger <small>(unmet demand)</small></h3><div id="gaps"><div class="empty">nothing yet</div></div>
</div>
<script>
const log = document.getElementById('log'), form = document.getElementById('f'), input = document.getElementById('m');
function add(cls, text){ const d=document.createElement('div'); d.className='msg '+cls; d.textContent=text; log.appendChild(d); log.scrollTop=log.scrollHeight; return d; }
async function post(url, body){ const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}); return r.json(); }
function render(turn){
  if(turn.error){ add('sys','⚠ '+turn.error); return; }
  if(turn.type==='confirm'){
    const box=document.createElement('div'); box.className='confirm';
    const q=document.createElement('div'); q.textContent=turn.summary; box.appendChild(q); // textContent: never HTML-inject model/runtime text
    const yes=document.createElement('button'); yes.className='yes'; yes.textContent='Approve';
    const no=document.createElement('button'); no.className='no'; no.textContent='Decline';
    box.append(yes,no); log.appendChild(box); log.scrollTop=log.scrollHeight;
    const answer=async(ok)=>{ box.remove(); add('sys', ok?'✔ approved':'✘ declined'); render(await post('/api/confirm',{approved:ok})); refresh(); };
    yes.onclick=()=>answer(true); no.onclick=()=>answer(false);
    return;
  }
  add('bot', turn.text);
}
form.onsubmit=async(e)=>{ e.preventDefault(); const m=input.value.trim(); if(!m) return; input.value='';
  add('user', m); const wait=add('sys','…thinking'); const turn=await post('/api/chat',{message:m}); wait.remove(); render(turn); refresh(); };
async function refresh(){ const r=await fetch('/api/inspect'); const s=await r.json();
  document.getElementById('node').textContent=s.node+'  (v'+s.version+')';
  document.getElementById('state').textContent=JSON.stringify(s.state,null,1);
  const g=document.getElementById('gaps'); g.textContent='';
  if(!s.gaps.length){ const e=document.createElement('div'); e.className='empty'; e.textContent='nothing yet'; g.appendChild(e); return; }
  // Gap rows carry USER-GENERATED text (the ask) — build with textContent, never innerHTML, so hostile
  // content is displayed as data and can never execute. (Same firewall principle the library enforces.)
  for(const x of s.gaps){
    const row=document.createElement('div'); row.className='gap';
    const k=document.createElement('b'); k.textContent=x.kind; row.appendChild(k);
    const detail=' '+(x.rejectionReason||x.reason||'')+(x.request?' — "'+x.request.slice(0,60)+'"':(x.affordanceId?' ('+x.affordanceId+')':''));
    row.appendChild(document.createTextNode(detail));
    g.appendChild(row);
  }
}
refresh();
</script>
</body>
</html>`;
