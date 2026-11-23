function toast(html, kind = '') {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.innerHTML = html;
  box.appendChild(el);
  setTimeout(() => { el.classList.add('hide'); setTimeout(() => el.remove(), 320); }, 3200);
}

function curStatus() {
  const p = items.find(x => x.id === cur);
  return p ? p.status : 'todo';
}
function isSolved() { return curStatus() === 'solved'; }

function grid(g) {
  if (!g || !g.columns.length) return '<p class="hint">(no columns)</p>';
  let h = '<table><thead><tr>' + g.columns.map(c => '<th>' + esc(c) + '</th>').join('') + '</tr></thead><tbody>';
  h += g.rows.map(r => '<tr>' + r.map(c => '<td>' + esc(c) + '</td>').join('') + '</tr>').join('');
  return h + '</tbody></table>';
}

function refreshProgress() {
  const done = items.filter(p => p.status === 'solved').length;
  const pct = items.length ? Math.round(done / items.length * 100) : 0;
  document.getElementById('pbar').style.width = pct + '%';
  document.getElementById('pcount').textContent = done + ' / ' + items.length + ' solved';
  document.getElementById('pct').textContent = pct + '%';
  document.getElementById('navCount').textContent = done;
  updatePointsUI();
  updateTabLocks();
  if (!document.getElementById('plan').hidden) renderPlan();
}

async function loadList() {
  items = await (await fetch('/api/problems')).json();
  items.forEach(p => p.id = +p.id);
  renderList();
  refreshProgress();
  gameReady = true;
}

function renderList() {
  const f = document.getElementById('q').value.toLowerCase();
  document.getElementById('items').innerHTML = items
    .filter(p => !f || (p.id + p.title + p.topic + p.difficulty).toLowerCase().includes(f))
    .map(p => `<div class="item${cur === p.id ? ' sel' : ''}" data-id="${p.id}" data-schema="${esc(p.schema_name)}">
      <span class="dot ${esc(p.status)}" title="${esc(p.status)}"></span>
      <span class="num">${p.id}</span>
      <span class="t">${esc(p.title)}
        <span class="meta"><span class="diff ${esc(p.difficulty)}">${esc(p.difficulty)}</span>
        <span class="sep">·</span><span class="topic">${esc(p.topic)}</span></span>
      </span></div>`).join('');
  document.querySelectorAll('.item').forEach(el =>
    el.onclick = () => openProblem(+el.dataset.id, el.dataset.schema));
}

/* ---------- study plan ---------- */
let planCollapsed = new Set();

function statusCounts() {
  const c = { solved:0, attempted:0, todo:0 };
  items.forEach(p => { c[p.status] = (c[p.status] || 0) + 1; });
  return c;
}

function showView(view) {
  const work = view === 'problems';
  document.getElementById('list').style.display = work ? '' : 'none';
  document.getElementById('main').style.display = work ? '' : 'none';
  ['home', 'plan', 'settings', 'arena'].forEach(v => document.getElementById(v).hidden = v !== view);
  document.querySelectorAll('#nav nav a').forEach(a => a.classList.toggle('active', a.dataset.view === view));
  document.getElementById('navUser').classList.toggle('active', view === 'settings');
  if (view === 'plan') renderPlan();
  else if (view === 'home') renderHome();
  else if (view === 'settings') renderSettings();
  else if (view === 'arena') renderArena();
  else cm.refresh();   // CodeMirror can't measure while hidden
}

function openFromPlan(id, schema) {
  document.getElementById('q').value = '';
  showView('problems');
  openProblem(id, schema);
}

function renderPlan() {
  updatePointsUI();
  const c = statusCounts();
  const total = items.length, done = c.solved;
  const pct = total ? Math.round(done / total * 100) : 0;
  document.getElementById('planSolved').textContent = done;
  document.getElementById('planTotal').textContent = total;
  document.getElementById('planPct').textContent = pct + '%';
  document.getElementById('planRing').style.setProperty('--p', pct);
  document.getElementById('statSolved').textContent = done;
  document.getElementById('statAttempted').textContent = c.attempted;
  document.getElementById('statTodo').textContent = c.todo;
  document.getElementById('planCount').textContent = total + ' problems';

  const diffCount = { Easy:0, Medium:0, Hard:0 };
  items.forEach(p => { if (diffCount[p.difficulty] != null) diffCount[p.difficulty]++; });
  document.getElementById('fAll').textContent = total;
  document.getElementById('fEasy').textContent = diffCount.Easy;
  document.getElementById('fMedium').textContent = diffCount.Medium;
  document.getElementById('fHard').textContent = diffCount.Hard;

  const allTopics = new Set(items.map(p => p.topic));
  document.getElementById('planTopics').textContent = allTopics.size + ' topics';

  const next = items.find(p => p.status !== 'solved');
  document.getElementById('planContinueLabel').textContent =
    done === total && total ? 'Review plan' : done ? 'Continue' : 'Start plan';
  document.getElementById('planContinue').onclick = () => {
    const p = next || items[0];
    if (p) openFromPlan(p.id, p.schema_name);
  };

  const visible = planFilter === 'all' ? items : items.filter(p => p.difficulty === planFilter);
  const groups = new Map();
  visible.forEach(p => {
    if (!groups.has(p.topic)) groups.set(p.topic, []);
    groups.get(p.topic).push(p);
  });

  document.getElementById('planSections').innerHTML = [...groups.entries()].map(([topic, ps], gi) => {
    const sd = ps.filter(p => p.status === 'solved').length;
    const pp = ps.length ? Math.round(sd / ps.length * 100) : 0;
    const collapsed = planCollapsed.has(topic);
    const rows = ps.map(p => `<div class="plan-row${next && next.id === p.id ? ' next' : ''}"
        data-id="${p.id}" data-schema="${esc(p.schema_name)}" tabindex="0" role="button">
        <span class="pdot ${esc(p.status)}">${p.status === 'solved' ? '✓' : p.status === 'attempted' ? '•' : ''}</span>
        <span class="pseq">${esc(p.seq)}</span>
        <span class="ptitle">${esc(p.title)}</span>
        ${next && next.id === p.id ? '<span class="pnext">Up next</span>' : ''}
        <span class="diff ${esc(p.difficulty)}">${esc(p.difficulty)}</span>
      </div>`).join('');
    return `<section class="topic${collapsed ? ' collapsed' : ''}" data-topic="${esc(topic)}">
      <button class="topic-head" type="button" aria-expanded="${!collapsed}">
        <span class="chev">▾</span>
        <span class="tname">${gi + 1}. ${esc(topic)}</span>
        <span class="tcount">${sd}/${ps.length} solved</span>
        <span class="tbar"><i style="width:${pp}%"></i></span>
      </button>
      <div class="topic-rows">${rows}</div>
    </section>`;
  }).join('') || '<p class="hint" style="padding:14px">No problems match this filter.</p>';

  document.querySelectorAll('#planSections .topic-head').forEach(btn => {
    btn.onclick = () => {
      const sec = btn.closest('.topic');
      const topic = sec.dataset.topic;
      const closed = sec.classList.toggle('collapsed');
      closed ? planCollapsed.add(topic) : planCollapsed.delete(topic);
      btn.setAttribute('aria-expanded', String(!closed));
    };
  });
  document.querySelectorAll('#planSections .plan-row').forEach(row => {
    const go = () => openFromPlan(+row.dataset.id, row.dataset.schema);
    row.onclick = go;
    row.onkeydown = e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
    };
  });
}

function splitDescLines(desc) {
  return String(desc || '').replace(/\u00a0/g, ' ').split('\n').map(l => l.replace(/[ \t]+$/, ''));
}
function isAsciiBorder(l) { return /^\+(?:[-+]+\+)+$/.test((l || '').trim()); }
function asciiCells(l) { return l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim()); }
function asciiTableAt(lines, i) {
  if (!isAsciiBorder(lines[i])) return null;
  if (!(lines[i + 1] || '').trim().startsWith('|')) return null;
  const columns = asciiCells(lines[i + 1]);
  let j = i + 2;
  if (!isAsciiBorder(lines[j])) return null;
  j++;
  const rows = [];
  while (j < lines.length && (lines[j] || '').trim().startsWith('|')) {
    const row = asciiCells(lines[j]);
    if (!row.every(c => /^[-:]+$/.test(c))) rows.push(row);
    j++;
  }
  if (isAsciiBorder(lines[j])) j++;
  return { columns, rows, end:j - 1 };
}
function captionBefore(lines, i, min) {
  for (let k = i - 1; k >= Math.max(0, min); k--) {
    const l = (lines[k] || '').trim();
    if (!l || isAsciiBorder(l) || l.startsWith('|')) continue;
    return l;
  }
  return '';
}
function cleanCaption(c) {
  return c.replace(/:\s*$/, '').replace(/\s+table$/i, '').replace(/^Input$/i, '').trim();
}

function parseDescription(raw) {
  const lines = splitDescLines(raw);
  const marks = [];
  lines.forEach((l, i) => {
    const m = /^Example\s+(\d+)\s*:/i.exec(l.trim());
    if (m) marks.push({ num:+m[1], i });
  });
  const examples = marks.map((ex, k) => {
    const end = k + 1 < marks.length ? marks[k + 1].i : lines.length;
    const block = lines.slice(ex.i, end);
    const outAt = block.findIndex(l => /^Output\s*:?\s*$/i.test(l.trim()));
    let output = null;
    const inputs = [];
    if (outAt >= 0) {
      for (let i = 0; i < outAt; i++) {
        const t = asciiTableAt(block, i);
        if (t) { inputs.push({ name: cleanCaption(captionBefore(block, i, 0)), table:t }); i = t.end; }
      }
      for (let i = outAt; i < block.length; i++) {
        const t = asciiTableAt(block, i);
        if (t) { output = t; break; }
      }
    }
    const expl = [];
    if (output) {
      for (let i = output.end + 1; i < block.length; i++) {
        const l = block[i].trim();
        if (/^Constraints\s*:/i.test(l)) break;
        if (l) expl.push(l);
      }
    }
    return { num:ex.num, inputs, output,
             explanation: expl.join('\n').replace(/^Explanation\s*:\s*/i, '').trim() };
  });

  const firstEx = marks.length ? marks[0].i : lines.length;
  const skip = new Set();
  for (let i = 0; i < firstEx; i++) {
    if (isAsciiBorder(lines[i])) {
      const t = asciiTableAt(lines, i);
      if (t) { for (let j = i; j <= t.end; j++) skip.add(j); i = t.end; }
    }
  }
  const body = [];
  for (let i = 0; i < firstEx; i++) {
    if (skip.has(i)) continue;
    const l = lines[i].trim();
    if (!l) { body.push(''); continue; }
    if (/^#\s/.test(l) || /^(Easy|Medium|Hard)\s*\|/.test(l) || /^Practice:/i.test(l)) continue;
    if (/^Table:\s*[\w\s]+$/i.test(l)) continue;
    body.push(l);
  }
  const full = body.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const instr = /\b(write|given|return|find|report|calculate|swap|reformat|replace|delete|update|display|list|fetch|create|count)\b/i;
  let start = -1;
  for (let i = 0; i < body.length; i++) {
    if (body[i] && instr.test(body[i])) { start = i; break; }
  }
  let task = [];
  if (start >= 0) {
    const picked = [];
    for (let i = start; i < body.length; i++) {
      const l = body[i];
      if (/^(Constraints|Follow up|Follow-up|Note)\b/i.test(l)) break;
      if (/^Example\s+\d+/i.test(l)) break;
      if (/^The result format is/i.test(l)) continue;
      picked.push(l);
    }
    let buf = [];
    picked.forEach(l => {
      if (!l.trim()) {
        if (buf.length) { task.push(buf.join(' ')); buf = []; }
      } else buf.push(l.trim());
    });
    if (buf.length) task.push(buf.join(' '));
    task = task.slice(0, 5);
  }
  if (!task.length) {
    task = full.split(/\n{2,}/).map(p => p.replace(/\n/g, ' ').trim()).filter(Boolean).slice(0, 2);
  }
  return { full, task, examples };
}

function lockHtml(title, text) {
  return `<div class="lock-panel">
    <div class="lock-ico">🔒</div>
    <b>${esc(title)} locked</b>
    <p>${esc(text)}</p>
    <span class="pill">Mark the problem solved to unlock</span>
  </div>`;
}

function updateTabLocks() {
  const locked = !isSolved(), arena = arenaLocked();
  document.querySelectorAll('#descTabs .tab').forEach(t => {
    const needs = t.dataset.tab === 'editorial' || t.dataset.tab === 'solutions';
    t.classList.toggle('locked', (needs && locked) || (arena && t.dataset.tab !== 'description'));
    const lock = t.querySelector('.lock');
    if (lock) lock.hidden = !(needs && locked);
  });
}

function renderExample(i) {
  const examples = curParsed ? curParsed.examples : [];
  const ex = examples[i] || examples[0];
  const body = document.getElementById('exBody');
  if (!ex || !body) return;
  curExampleIdx = examples.indexOf(ex);
  document.querySelectorAll('#desc .ex-tab').forEach((b, j) => b.classList.toggle('active', j === curExampleIdx));
  const inputs = ex.inputs.length
    ? ex.inputs.map(x => `<div class="ex-tbl"><div class="cap">${esc(x.name || 'Input')} <span>table</span></div>${grid(x.table)}</div>`).join('')
    : '<p class="hint">—</p>';
  body.innerHTML = `<div class="ex-panels">
      <div class="ex-panel"><div class="ex-head">Input</div>${inputs}</div>
      <div class="ex-panel out"><div class="ex-head">Output <span class="ex-badge">expected</span></div>${ex.output ? grid(ex.output) : '<p class="hint">—</p>'}</div>
    </div>
    ${ex.explanation ? `<div class="ex-explain"><b>Explanation</b>${esc(ex.explanation)}</div>` : ''}`;
}

function bindDescriptionExtras() {
  document.querySelectorAll('#desc .ex-tab').forEach(b => b.onclick = () => renderExample(+b.dataset.ex));
  renderExample(curExampleIdx);
}

function descriptionHtml() {
  const p = curProblem || { id:cur, title:'', difficulty:'', topic:'' };
  const parsed = curParsed || { full:'', task:[], examples:[] };
  const schema = (curTables || []).map(t => `<div class="tbl">
      <div class="cap"><span class="ico">▤</span>${esc(t.name)}
        <span class="cols">(${t.columns.map(esc).join(', ')})</span>
        <span class="row-count">${t.rows ? t.rows.length + ' sample row' + (t.rows.length === 1 ? '' : 's') : ''}</span></div>
      ${grid(t)}</div>`).join('');
  const exs = parsed.examples;
  return `<h2>${p.id}. ${esc(p.title)}</h2>
    <div class="badges">
      <span class="badge ${esc(p.difficulty)}">${esc(p.difficulty)}</span>
      <span class="badge topic">${esc(p.topic)}</span>
      ${WRITE_IDS.has(p.id) ? '<span class="badge topic">UPDATE / DELETE</span>' : ''}
    </div>
    ${parsed.task.length ? `<div class="task-card"><div class="task-kicker">Task</div>${parsed.task.map(t => `<p>${esc(t)}</p>`).join('')}</div>` : ''}
    <details class="full-desc"><summary>Full problem description</summary><pre>${esc(parsed.full)}</pre></details>
    <h3 class="sec schema-head">Schema · sample data <span class="hint">${curTables.length} table${curTables.length === 1 ? '' : 's'}</span></h3>
    ${schema}
    ${exs.length ? `<h3 class="sec">Examples</h3>
      <div class="ex-tabs">${exs.map((e, i) => `<button class="ex-tab${i === curExampleIdx ? ' active' : ''}" data-ex="${i}">Example ${e.num}</button>`).join('')}
        <span class="ex-tip">Check compares against Example ${exs[0].num}</span></div>
      <div id="exBody"></div>` : ''}`;
}

function editorialHtml() {
  const p = curProblem;
  if (!isSolved()) return lockHtml('Editorial', 'Solve this problem to unlock the approach notes for it.');
  const guide = TOPIC_GUIDES[p.topic] || '';
  const note = curRef && curRef.note;
  return `<h2>${p.id}. ${esc(p.title)}</h2>
    <div class="badges"><span class="badge ${esc(p.difficulty)}">${esc(p.difficulty)}</span>
      <span class="badge topic">${esc(p.topic)}</span><span class="badge topic">Editorial</span></div>
    ${note ? `<div class="note-card"><b>Approach</b>${esc(note)}</div>`
           : (curRef && curRef.loading ? '<p class="hint">Loading reference notes…</p>' : '')}
    ${guide ? `<div class="note-card"><b>${esc(p.topic)} playbook</b>${esc(guide)}</div>` : ''}
    <p class="hint">The full reference query is on the Solutions tab.</p>`;
}

function solutionsHtml() {
  const p = curProblem;
  if (!isSolved()) return lockHtml('Solutions', 'Solve this problem to unlock the reference SQL solution.');
  if (!curRef || curRef.loading) return `<h2>${p.id}. ${esc(p.title)}</h2><p class="hint">Loading reference solution…</p>`;
  if (curRef.error) return `<h2>${p.id}. ${esc(p.title)}</h2><p class="hint">No reference solution available.</p>`;
  return `<h2>${p.id}. ${esc(p.title)}</h2>
    <div class="badges"><span class="badge ${esc(p.difficulty)}">${esc(p.difficulty)}</span>
      <span class="badge topic">${esc(p.topic)}</span><span class="badge topic">Reference</span></div>
    ${curRef.note ? `<div class="note-card"><b>Approach</b>${esc(curRef.note)}</div>` : ''}
    <div class="tab-actions">
      <button class="btn" data-action="copy-ref">Copy solution</button>
      <button class="btn check" data-action="load-ref">Load into editor</button>
    </div>
    <pre class="code-block">${esc(curRef.solution || '')}</pre>`;
}

function fmtTime(s) {
  const t = String(s || '');
  return t ? t.slice(0, 16) : '';
}

function submissionsHtml() {
  const p = curProblem;
  const meta = `<div class="sub-meta">
      <span class="pill ${esc(curMeta.status)}">${esc(curMeta.status)}</span>
      ${curMeta.updated ? `<span class="kv">last saved ${esc(fmtTime(curMeta.updated))}</span>` : ''}
      <span class="kv">latest saved submission</span>
    </div>`;
  if (!curSavedSolution) {
    return `<h2>${p.id}. ${esc(p.title)}</h2>${meta}
      <div class="lock-panel" style="margin-top:18px">
        <div class="lock-ico">▤</div>
        <b>No saved submission</b>
        <p>Save a draft, or get an accepted Check, and your SQL appears here.</p>
      </div>`;
  }
  return `<h2>${p.id}. ${esc(p.title)}</h2>${meta}
    <div class="tab-actions">
      <button class="btn" data-action="copy-saved">Copy</button>
      <button class="btn check" data-action="load-saved">Load into editor</button>
    </div>
    <pre class="code-block">${esc(curSavedSolution)}</pre>`;
}

function bindTabActions() {
  document.querySelectorAll('#desc [data-action]').forEach(b => {
    b.onclick = async () => {
      const action = b.dataset.action;
      if (action === 'copy-ref' || action === 'copy-saved') {
        const sql = action === 'copy-ref' ? (curRef && curRef.solution) : curSavedSolution;
        try { await navigator.clipboard.writeText(sql || ''); toast('SQL copied to clipboard'); }
        catch (e) { toast('Copy failed', 'bad'); }
      } else if (action === 'load-ref' && curRef && curRef.solution) {
        edSet(curRef.solution);
        setStatus('reference loaded');
        toast('Reference solution loaded into the editor');
      } else if (action === 'load-saved') {
        edSet(curSavedSolution);
        setStatus('saved solution loaded');
      }
    };
  });
}

async function ensureReference() {
  if (curRef || cur === null) return;
  const id = cur;
  curRef = { loading:true };
  try {
    const r = await (await fetch('/api/solution?id=' + id)).json();
    if (cur !== id) return;
    curRef = r.error ? { error:r.error } : r;
  } catch (e) {
    if (cur !== id) return;
    curRef = { error:'Could not load reference.' };
  }
  if (cur === id && (curTab === 'solutions' || curTab === 'editorial')) renderTab();
}

function renderTab() {
  const desc = document.getElementById('desc');
  if (!desc || cur === null) return;
  if (curTab !== 'description' && arenaLocked()) desc.innerHTML = arenaLockHtml();
  else if (curTab === 'description') {
    desc.innerHTML = descriptionHtml();
    bindDescriptionExtras();
  } else if (curTab === 'editorial') {
    desc.innerHTML = editorialHtml();
    if (isSolved() && !curRef) ensureReference();
  } else if (curTab === 'solutions') {
    desc.innerHTML = solutionsHtml();
    bindTabActions();
    if (isSolved() && !curRef) ensureReference();
  } else if (curTab === 'hints') {
    desc.innerHTML = hintsHtml();
    bindHints();
  } else {
    desc.innerHTML = submissionsHtml();
    bindTabActions();
  }
}

function setTab(name) {
  curTab = name;
  document.querySelectorAll('#descTabs .tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  renderTab();
  const d = document.getElementById('desc');
  if (d) d.scrollTop = 0;
}

async function openProblem(id, schema) {
  const myId = id;
  arenaStash();
  cur = id; curSchema = schema; curRef = null; lastFail = null; curTab = 'description'; curExampleIdx = 0;
  G.lastOpen = id; saveGame();
  renderList(); renderArenaBar(); updateTabLocks();
  const d = await (await fetch('/api/problem?id=' + id)).json();
  if (cur !== myId) return;
  if (d.error) { toast('Could not load problem', 'bad'); return; }
  const p = items.find(x => x.id === id);
  curProblem = p || { id, title:'Problem ' + id, difficulty:'', topic:'' };
  curTables = (d.tables || []).map(t => ({ name:t.name, columns:t.columns, rows:t.rows }));
  curParsed = parseDescription(d.description);
  curExpected = curParsed.examples.length ? curParsed.examples[0].output : null;
  curMeta = { status:d.status || 'todo', updated:d.updated || '' };
  curSavedSolution = d.solution || '';
  edSet(arenaDraft(id) ?? (d.solution || ''), true);
  document.getElementById('work').classList.add('on');
  cm.refresh();
  document.getElementById('schema').textContent = schema;
  document.getElementById('out').innerHTML = '<p class="hint">Run your query, then hit Check to compare with Example 1.</p>';
  document.getElementById('outMeta').textContent = '';
  setStatus('');
  updateTabLocks();
  setTab('description');
  if (curMeta.status === 'solved') ensureReference();
}

function tableForExpected(columns) {
  const want = columns.map(c => c.toLowerCase()).sort().join('\u0001');
  for (const t of curTables) {
    if (t.columns.length !== columns.length) continue;
    if (t.columns.map(c => c.toLowerCase()).sort().join('\u0001') === want) {
      const have = t.columns.map(c => c.toLowerCase());
      return { name:t.name, columns:columns.map(w => t.columns[have.indexOf(w.toLowerCase())]) };
    }
  }
  return null;
}

function normCell(v) {
  const s = String(v ?? '').trim();
  if (s === '' || /^null$/i.test(s)) return 'null';
  if (/^-?\d+(?:\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) return 'n:' + String(+n.toPrecision(12));
  }
  const d = /^(\d{4}-\d{2}-\d{2})(?:[ T]\d{2}:\d{2}:\d{2}.*)?$/.exec(s);
  if (d) return 'd:' + d[1];
  return 's:' + s;
}

function compareGrids(actual, expected, pid) {
  const fix = CHECK_FIXES[pid];
  const colsOk = actual.columns.length === expected.columns.length;
  const expRows = expected.rows.map(r => r.map(c => normCell(fix ? fix(String(c)) : c)));
  const actRows = actual.rows.map(r => r.map(normCell));
  const key = r => r.join('\u0001');
  const expKeys = expRows.map(key).sort();
  const actKeys = actRows.map(key).sort();
  const counts = new Map();
  expKeys.forEach(k => counts.set(k, (counts.get(k) || 0) + 1));
  let matched = 0;
  actKeys.forEach(k => {
    const n = counts.get(k) || 0;
    if (n > 0) { matched++; counts.set(k, n - 1); }
  });
  const ok = colsOk && expKeys.length === actKeys.length && expKeys.every((k, i) => k === actKeys[i]);
  return { ok, colsOk, matched, expectedRows:expected.rows.length, actualRows:actRows.length,
           expected, actual };
}
