function renderError(msg) {
  const title = /syntax error/i.test(msg) ? 'Syntax Error'
    : /does not exist|ambiguous/i.test(msg) ? 'SQL Error' : 'Runtime Error';
  const lm = /LINE (\d+):/.exec(msg);
  document.getElementById('out').innerHTML =
    `<div class="err"><div class="err-tag"><b>${title}</b>${lm ? `<span class="line-badge">line ${lm[1]}</span>` : ''}</div>${esc(msg)}</div>`;
  document.getElementById('outMeta').textContent = 'Error';
}

function renderVerdict(kind, title, sub) {
  const icon = kind === 'ok' ? '✓' : kind === 'bad' ? '✕' : '…';
  return `<div class="verdict ${kind}"><span class="vicon">${icon}</span><div><b>${esc(title)}</b><p>${esc(sub)}</p></div></div>`;
}

async function check() {
  if (cur === null || checking) return;
  const sql = cm.getValue().trim();
  if (!sql) return;
  const issue = basicSqlError(sql);
  if (issue) return failHint(issue);
  if (!curExpected) {
    document.getElementById('out').innerHTML = renderVerdict('bad', 'Auto-check unavailable', 'No expected output table was found in this description.');
    document.getElementById('outMeta').textContent = '';
    return;
  }
  const writeTask = WRITE_IDS.has(cur);
  const body = { schema:curSchema, sql };
  if (writeTask) {
    if (!/^\s*(update|delete|insert)\b/i.test(sql)) {
      document.getElementById('out').innerHTML = renderVerdict('bad', 'Wrong statement type',
        'This problem expects an UPDATE or DELETE statement. Write the mutation, not a SELECT.');
      document.getElementById('outMeta').textContent = '';
      return;
    }
    const target = tableForExpected(curExpected.columns);
    if (!target) {
      document.getElementById('out').innerHTML = renderVerdict('bad', 'Auto-check unavailable', 'Could not match the expected table to this schema.');
      document.getElementById('outMeta').textContent = '';
      return;
    }
    body.table = target.name;
    body.columns = target.columns;
  }
  checking = true;
  setStatus('Checking…');
  const out = document.getElementById('out');
  out.innerHTML = '<span class="running"><span class="spin"></span>Checking against Example 1…</span>';
  document.getElementById('outMeta').textContent = '';
  let r;
  try {
    r = await (await fetch('/api/check', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(body) })).json();
  } catch (e) {
    checking = false;
    return renderError('Could not reach the local server.');
  }
  checking = false;
  if (!r.ok) return failHint(r.error || 'Query failed.');

  const cmp = compareGrids(r.result, curExpected, cur);
  G.checks++; bumpDay('a');
  if (cmp.ok) {
    G.checksOk++; lastFail = null;
    out.innerHTML = renderVerdict('ok', 'Accepted',
      `Your result matches the expected output for Example 1 · ${r.result.rows.length} row${r.result.rows.length === 1 ? '' : 's'}.`) + grid(r.result);
    document.getElementById('outMeta').textContent = 'Accepted · Example 1';
    const wasSolved = isSolved();
    if (!wasSolved) await saveProgress('solved', { firstTry:!G.fails[cur] });
    else { sfx('win'); updatePointsUI(); }
    arenaCheck(true);
    setStatus('accepted ✓');
  } else {
    G.fails[cur] = (G.fails[cur] || 0) + 1;
    sfx('bad'); updatePointsUI();
    const parts = [];
    if (!cmp.colsOk) parts.push(`Expected ${curExpected.columns.length} column${curExpected.columns.length === 1 ? '' : 's'}, got ${r.result.columns.length}.`);
    parts.push(`${cmp.matched} of ${cmp.expectedRows} expected row${cmp.expectedRows === 1 ? '' : 's'} matched.`);
    out.innerHTML = renderVerdict('bad', 'Wrong Answer', parts.join(' ')) + `
      <div class="diff-grid">
        <div><div class="cap out">Expected</div>${grid(curExpected)}</div>
        <div><div class="cap">Your output</div>${grid(r.result)}</div>
      </div>`;
    document.getElementById('outMeta').textContent = 'Wrong answer · Example 1';
    arenaCheck(false);
    autoHint({ actual:gridText(r.result), expected:gridText(curExpected) });
    setStatus('wrong answer');
  }
}

async function run() {
  const sql = cm.getValue().trim();
  if (!sql) return;
  const issue = basicSqlError(sql);
  if (issue) return failHint(issue);
  const out = document.getElementById('out');
  const meta = document.getElementById('outMeta');
  out.innerHTML = '<span class="running"><span class="spin"></span>Running query…</span>';
  meta.textContent = '';
  setStatus('Running…');
  const t0 = performance.now();
  let r;
  try {
    r = await (await fetch('/api/run', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ schema: curSchema, sql }) })).json();
  } catch (e) {
    setStatus('');
    return renderError('Could not reach the local server.');
  }
  const secs = ((performance.now() - t0) / 1000).toFixed(2);
  setStatus('');
  G.runs++; bumpDay('a'); updatePointsUI();
  if (!r.ok) return failHint(r.error);
  if (r.message) {
    out.innerHTML = '<div class="msg">' + esc(r.message) + '</div><p class="hint" style="margin-top:8px">Statement executed. Use Check to compare a SELECT result with Example 1.</p>';
    meta.textContent = 'Executed · ' + secs + 's';
  } else {
    out.innerHTML = grid(r.result);
    const n = r.result.rows.length;
    meta.textContent = n + ' row' + (n === 1 ? '' : 's') + ' · ' + secs + 's';
  }
}

async function saveProgress(status, opts = {}) {
  if (cur === null) return;
  const sol = cm.getValue();
  const prev = items.find(x => x.id === cur);
  const wasStatus = prev ? prev.status : 'todo';
  const prevPts = calcPoints().pts;
  const daily = dailyProblem();   // pin today's pick before this solve changes the pool
  setStatus('Saving…');
  const r = await (await fetch('/api/progress', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ id: cur, status, solution: sol }) })).json();
  if (!r.ok) return setStatus('Save failed');
  const p = items.find(x => x.id === cur); if (p) p.status = status;
  const bonusNotes = [];
  if (status === 'solved' && wasStatus !== 'solved') {
    const k = dayKey(), hr = new Date().getHours();
    if (opts.firstTry) { G.firstTry++; G.bonus += BONUS.firstTry; bonusNotes.push('🏹 first try +' + BONUS.firstTry); }
    if (daily && daily.id === cur && !G.daily[k]) {
      G.daily[k] = cur; G.bonus += BONUS.daily; bonusNotes.push('☀️ daily challenge +' + BONUS.daily);
      pushFeed('☀️', 'Completed the daily challenge');
    }
    if (hr < 5) G.night++; else if (hr < 8) G.early++;
    bumpDay('s');
    if (G.days[k].s === PROFILE.goal) { pushFeed('🥅', 'Hit the daily goal'); setTimeout(() => toast('<b>🥅 Daily goal reached!</b> · ' + PROFILE.goal + ' solved today'), 900); }
    pushFeed('✅', `Solved ${cur}. ${p ? p.title : ''}`);
    sfx('win'); confetti();
  } else bumpDay('a');
  curSavedSolution = sol;
  curMeta = { status, updated:new Date().toISOString() };
  renderList(); refreshProgress();
  updateTabLocks();
  if (status === 'solved' && (curTab === 'editorial' || curTab === 'solutions')) {
    ensureReference();
    renderTab();
  }
  const gained = calcPoints().pts - prevPts;
  if (status === 'solved' && wasStatus !== 'solved') {
    toast(`<b>+${gained} XP</b> · problem solved${bonusNotes.length ? '<br>' + bonusNotes.join(' · ') : ''}<br>Editorial and reference solution unlocked`);
  } else if (gained > 0) {
    toast(`<b>+${gained} XP</b> · progress saved`);
  }
  setStatus(status === 'solved' ? 'marked solved ✓' : 'saved');
}

async function exportProgress() {
  try {
    const r = await (await fetch('/api/export')).json();
    if (r.error) throw new Error(r.error);
    const s = calcPoints();
    const data = { ...r,
      summary:{ solved:s.solved, attempted:s.attempted, total:s.total,
                points:s.pts, level:Math.floor(s.pts / 100) + 1 } };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sql50-progress-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast('Progress exported · JSON file downloaded');
  } catch (e) {
    toast('Export failed', 'bad');
  }
}

// resolves true only after the user types RESET and confirms
function confirmReset() {
  return new Promise(resolve => {
    const box = $id('confirmReset'), inp = $id('crInput'), ok = $id('crOk'), prevFocus = document.activeElement;
    const s = calcPoints();
    $id('crSolved').textContent = s.solved + ' solved';
    $id('crXp').textContent = s.pts + ' XP';
    $id('crAch').textContent = ACHIEVEMENTS.filter(a => G.unlocked[a.id]).length + ' unlocked';
    inp.value = ''; ok.disabled = true; box.hidden = false; inp.focus();
    const done = v => {
      box.hidden = true;
      inp.oninput = ok.onclick = $id('crCancel').onclick = box.onclick = box.onkeydown = null;
      if (prevFocus && prevFocus.focus) prevFocus.focus();
      resolve(v);
    };
    inp.oninput = () => { ok.disabled = inp.value.trim().toUpperCase() !== 'RESET'; };
    box.onkeydown = e => {
      if (e.key === 'Escape') { e.preventDefault(); done(false); }
      else if (e.key === 'Enter' && e.target === inp && !ok.disabled) { e.preventDefault(); done(true); }
    };
    ok.onclick = () => done(true);
    $id('crCancel').onclick = () => done(false);
    box.onclick = e => { if (e.target === box) done(false); };
  });
}

async function resetProgress() {
  if (!await confirmReset()) return;
  try {
    const r = await (await fetch('/api/reset-progress', { method:'POST',
      headers:{'Content-Type':'application/json'}, body:'{}' })).json();
    if (!r.ok) throw new Error(r.error || 'reset failed');
  } catch (e) {
    toast('Reset failed', 'bad');
    return;
  }
  items.forEach(p => p.status = 'todo');
  G = GAME_DEFAULT(); saveGame();
  curSavedSolution = ''; curMeta = { status:'todo', updated:'' }; curRef = null;
  if (cur !== null) {
    edSet('', true);
    document.getElementById('out').innerHTML = '<p class="hint">Progress was reset. Run your query, then hit Check.</p>';
    document.getElementById('outMeta').textContent = '';
    setStatus('');
    updateTabLocks();
    setTab('description');
  }
  renderList(); refreshProgress();
  toast('<b>Progress reset</b> · 0 / ' + items.length + ' solved');
}

document.getElementById('run').onclick = run;
document.getElementById('check').onclick = check;
document.getElementById('format').onclick = formatEditor;
document.getElementById('save').onclick = () => saveProgress('attempted');
document.getElementById('solved').onclick = () => saveProgress('solved');
document.getElementById('exportProgress').onclick = exportProgress;
document.getElementById('resetProgress').onclick = resetProgress;
document.getElementById('navProblems').onclick = e => { e.preventDefault(); showView('problems'); };
document.getElementById('navPlan').onclick = e => { e.preventDefault(); showView('plan'); };
document.getElementById('navHome').onclick = e => { e.preventDefault(); showView('home'); };
document.getElementById('navUser').onclick = () => showView('settings');
document.getElementById('navStreak').onclick = () => showView('home');
document.getElementById('navStreak').style.cursor = 'pointer';
document.getElementById('navPoints').onclick = () => showView('home');
document.getElementById('navPoints').style.cursor = 'pointer';
document.getElementById('navPoints').title = 'Open the dashboard';
document.getElementById('homeContinue').onclick = () => {
  const p = nextProblem();
  if (p) openFromPlan(p.id, p.schema_name);
};
document.getElementById('homePlan').onclick = () => showView('plan');
document.getElementById('homeReset').onclick = async () => { await resetProgress(); renderHome(); };
document.getElementById('brandHome').onclick = () => showView('home');
document.getElementById('brandHome').onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showView('home'); } };
document.querySelectorAll('#achFilter .fchip').forEach(b => b.onclick = () => {
  achFilter = b.dataset.f;
  document.querySelectorAll('#achFilter .fchip').forEach(x => x.classList.toggle('active', x === b));
  renderHome();
});
document.getElementById('celOk').onclick = () => { document.getElementById('celebrate').hidden = true; };
