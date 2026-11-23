/* ---------- AI hint tutor: chat tab + automatic hint after a failed Run/Check (server: /api/hint) ---------- */
const CHATS = loadJSON('sql50-chats', {});   // per-browser cache: problem id -> [{role, text}]
const HINT_CHIPS = ['Give me a hint', 'Why is my query wrong?', 'Explain the error', 'Which SQL concept do I need?'];
let hintBusy = false, lastFail = null, lastAuto = { key:'', r:null };

const gridText = g => g ? [g.columns.join(' | '), ...g.rows.slice(0, 20).map(r => r.join(' | '))].join('\n') : '';

function md(s) {   // tiny markdown for model replies: code blocks, `code`, **bold**, bullets, line breaks
  return esc(s)
    .replace(/```[\w-]*\n?([\s\S]*?)```/g, (_, c) => `<pre class="code-block">${c.replace(/\n$/, '')}</pre>`)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/^[ \t]*[-*] (.*)$/gm, '<li>$1</li>')
    .replace(/(?:<li>.*<\/li>\n?)+/g, m => '<ul>' + m.replace(/\n/g, '') + '</ul>')
    .replace(/\n/g, '<br>');
}

async function askHint(text, ctx = lastFail || {}) {
  const id = cur, chat = CHATS[id] || (CHATS[id] = []);
  chat.push({ role:'user', text });
  hintBusy = true; renderHintLog();
  let r;
  try {
    r = await (await fetch('/api/hint', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ id, sql:cm.getValue(), messages:chat.filter(m => m.role !== 'error'), ...ctx }) })).json();
  } catch (e) { r = { ok:false, error:'Could not reach the local server.' }; }
  hintBusy = false;
  chat.push(r.ok ? { role:'assistant', text:r.reply } : { role:'error', text:r.error });
  chat.splice(0, Math.max(0, chat.length - 40));
  saveJSON('sql50-chats', CHATS);
  if (cur === id) renderHintLog();
  return r;
}

function hintLogHtml() {
  const chat = CHATS[cur] || [];
  if (!chat.length && !hintBusy) return `<div class="ai-empty"><div class="big">💡</div>
    <p>Stuck? Ask for a hint. The tutor sees the problem, the tables, your current query and your last error,
    and nudges you in the right direction. It will not write the solution for you.</p></div>`;
  return chat.map(m => `<div class="ai-msg ${m.role}">${m.role === 'user' ? esc(m.text) : md(m.text)}</div>`).join('')
    + (hintBusy ? '<div class="ai-msg assistant"><span class="running"><span class="spin"></span>Thinking…</span></div>' : '');
}

function renderHintLog() {
  const log = $id('aiLog');
  if (!log) return;
  log.innerHTML = hintLogHtml();
  log.scrollTop = log.scrollHeight;
  $id('aiSend').disabled = hintBusy;
}

function hintsHtml() {
  return `<div class="ai-chat">
    <div class="ai-head"><b>✨ AI Hint</b><span class="hint">Hints only, never the full answer.</span>
      <button class="btn" type="button" id="aiClear">Clear chat</button></div>
    <div class="ai-log" id="aiLog" aria-live="polite"></div>
    <div class="ai-chips">${HINT_CHIPS.map(c => `<button type="button" class="fchip" data-chip="${esc(c)}">${esc(c)}</button>`).join('')}</div>
    <form class="ai-form" id="aiForm">
      <textarea id="aiInput" rows="2" placeholder="Ask about this problem… (Enter to send, Shift+Enter for a new line)" aria-label="Ask the AI tutor"></textarea>
      <button class="btn check" id="aiSend">Send</button>
    </form></div>`;
}

function bindHints() {
  renderHintLog();
  const send = text => { text = text.trim(); if (text && !hintBusy) askHint(text); };
  $id('aiForm').onsubmit = e => { e.preventDefault(); send($id('aiInput').value); $id('aiInput').value = ''; };
  $id('aiInput').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $id('aiForm').requestSubmit(); } };
  document.querySelectorAll('.ai-chips [data-chip]').forEach(b => b.onclick = () => send(b.dataset.chip));
  $id('aiClear').onclick = () => { delete CHATS[cur]; saveJSON('sql50-chats', CHATS); renderHintLog(); };
}

// failed Run/Check: show the error (already rendered) plus an AI hint under it. ctx: {error} or {actual, expected}
function autoHint(ctx) {
  lastFail = ctx;
  if (!PROFILE.aiAuto || cur === null || arenaLocked()) return;
  const box = document.createElement('div');
  box.className = 'ai-hint';
  $id('out').appendChild(box);
  const fill = r => {
    if (!box.isConnected) return;
    box.innerHTML = r.ok
      ? `<div class="ai-hint-h">💡 Hint</div>${md(r.reply)}<div><button class="btn" type="button">Ask a follow-up</button></div>`
      : `<div class="ai-hint-h">💡 AI hint unavailable</div><p class="hint">${esc(r.error)}</p>`;
    const b = box.querySelector('button');
    if (b) b.onclick = () => setTab('hints');
  };
  const key = [cur, cm.getValue(), JSON.stringify(ctx)].join('\u0001');
  if (lastAuto.key === key) return fill(lastAuto.r);   // same query, same failure: don't ask again
  box.innerHTML = '<span class="running"><span class="spin"></span>AI tutor is looking at your query…</span>';
  askHint(ctx.error ? 'My query failed with the error above. What is wrong? Hint only, please.'
                    : 'My output does not match the expected output. What is wrong? Hint only, please.', ctx)
    .then(r => { if (r.ok) lastAuto = { key, r }; fill(r); });
}

function failHint(msg) { renderError(msg); autoHint({ error:msg }); }
