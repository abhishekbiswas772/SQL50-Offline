/* ---------- Arena: 20 contests, one contest per section, one speed run per section ----------
   Definitions are derived deterministically from the catalog; results live in G (synced to app_state). */
const ARENA_PTS = { Easy:3, Medium:5, Hard:7 };
const DIFF_ORD = { Easy:0, Medium:1, Hard:2 };
const WRONG_PEN = 5 * 60e3, SPEED_PEN = 30e3;   // contest penalty per wrong check; speed run penalty
const CONTEST_NAMES = ['Warm-up', 'First Steps', 'Select Sprint', 'Filter Frenzy', 'Join the Party', 'Null Hunter',
  'Group Therapy', 'Aggregate Rush', 'Left Join Lane', 'Window Seat', 'Case Closed', 'Subquery Summit', 'Having Fun',
  'Rank & File', 'Self-Join Saga', 'Date Night', 'Pivot Point', 'Regex Rodeo', 'Boss Rush', 'Grand Finale'];
const TIERS = [{ name:'Bronze', mix:'EEEM', mins:20 }, { name:'Silver', mix:'EEMM', mins:30 }, { name:'Gold', mix:'EMMM', mins:40 }];
const MEDALS = ['', '🥉', '🥈', '🥇'];
const ARENA_ICON = { contest:'🏆', section:'🧩', speed:'⏱️' };
let arenaTab = 'contest', arenaCache = null;

function rng(seed) {   // mulberry32
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function shuffled(a, seed) {
  const r = rng(seed), b = [...a];
  for (let i = b.length - 1; i > 0; i--) { const j = r() * (i + 1) | 0; [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}
const byId = id => items.find(p => p.id === id);
const fmtClock = ms => {
  const s = Math.max(0, Math.round(ms / 1000)), h = s / 3600 | 0, m = (s % 3600) / 60 | 0;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s % 60).padStart(2, '0');
};

function arenaDefs() {
  if (arenaCache && arenaCache.n === items.length) return arenaCache;
  const ord = (a, b) => DIFF_ORD[a.difficulty] - DIFF_ORD[b.difficulty] || +a.seq - +b.seq;
  const P = {}, at = { E:0, M:0, H:0 };
  [['E', 'Easy'], ['M', 'Medium'], ['H', 'Hard']].forEach(([k, d], i) =>
    P[k] = shuffled(items.filter(p => p.difficulty === d).map(p => p.id), 7919 * (i + 1)));
  const take = k => { if (!P[k].length) k = 'E'; return P[k][at[k]++ % P[k].length]; };
  const contest = CONTEST_NAMES.map((name, i) => {
    const tier = TIERS[Math.min(2, i / 7 | 0)];
    const mix = i === CONTEST_NAMES.length - 1 && P.H.length ? 'EMMH' : tier.mix;
    return { key:'c' + (i + 1), kind:'contest', num:i + 1, name, title:`Contest #${i + 1} · ${name}`,
             tier:tier.name, mins:tier.mins, probs:[...mix].map(take) };
  });
  const topics = [...new Set(items.map(p => p.topic))];
  const section = topics.map((t, i) => {
    const pick = shuffled(items.filter(p => p.topic === t), 101 + i).slice(0, 4).sort(ord);
    return { key:'s' + (i + 1), kind:'section', num:i + 1, name:t, title:'Section · ' + t,
             mins:pick.reduce((m, p) => m + [5, 8, 12][DIFF_ORD[p.difficulty]], 0), probs:pick.map(p => p.id) };
  });
  const speed = topics.map((t, i) => {
    const ps = items.filter(p => p.topic === t);
    return { key:'r' + (i + 1), kind:'speed', num:i + 1, name:t, title:'Speed Run · ' + t, mins:0,
             par:ps.reduce((m, p) => m + [2, 4, 6][DIFF_ORD[p.difficulty]], 0) * 60e3, probs:ps.map(p => p.id) };
  });
  return arenaCache = { n:items.length, contest, section, speed, all:[...contest, ...section, ...speed] };
}
const findDef = key => items.length ? arenaDefs().all.find(d => d.key === key) : null;
const arenaDef = () => G.arena ? findDef(G.arena.key) : null;
const arenaLocked = () => { const d = arenaDef(); return !!d && d.probs.includes(cur); };
const arenaLeft = d => d.mins ? d.mins * 60e3 - (Date.now() - G.arena.start) : Infinity;

function arenaScore(d, a) {
  const ids = d.probs.filter(id => a.solved[id] != null);
  const pts = id => ARENA_PTS[(byId(id) || {}).difficulty] || 3;
  const wrongs = ids.reduce((s, id) => s + (a.wrong[id] || 0), 0);
  const last = ids.length ? Math.max(...ids.map(id => a.solved[id])) : 0;
  const r = { solved:ids.length, n:d.probs.length, wrongs, last,
              score:ids.reduce((s, id) => s + pts(id), 0), max:d.probs.reduce((s, id) => s + pts(id), 0),
              time:last + wrongs * (d.kind === 'speed' ? SPEED_PEN : WRONG_PEN) };
  const all = r.solved === r.n;
  if (d.kind === 'speed') r.medal = !all ? 0 : r.time <= d.par ? 3 : r.time <= 2 * d.par ? 2 : r.time <= 3 * d.par ? 1 : 0;
  else r.stars = all && !wrongs && last <= d.mins * 30e3 ? 3 : all ? 2 : r.solved ? 1 : 0;
  return r;
}

/* ---------- session hooks (called from openProblem / check / renderTab / autoHint) ---------- */
function arenaStash() { if (arenaLocked()) G.arena.drafts[cur] = cm.getValue(); }
function arenaDraft(id) {
  const d = arenaDef();
  return d && d.probs.includes(id) ? G.arena.drafts[id] || '' : null;   // contest starts from a blank editor
}
function arenaLockHtml() {
  return `<div class="lock-panel"><div class="lock-ico">⚔️</div><b>Locked during the run</b>
    <p>Editorial, solutions, past submissions and AI hints unlock when you finish.</p>
    <span class="pill">Only Description is available in the arena</span></div>`;
}
function arenaCheck(ok) {
  const d = arenaDef();
  if (!d || !d.probs.includes(cur) || G.arena.solved[cur] != null) return;
  if (arenaLeft(d) <= 0) return arenaFinish('time');
  const a = G.arena;
  if (!ok) { a.wrong[cur] = (a.wrong[cur] || 0) + 1; saveGame(); return renderArenaBar(); }
  const t = Date.now() - a.start;
  if (t - (a.last || 0) <= 60e3) G.blitz = (G.blitz || 0) + 1;
  a.solved[cur] = t; a.last = t;
  const left = d.probs.filter(id => a.solved[id] == null);
  saveGame(); renderArenaBar();
  toast(`<b>${ARENA_ICON[d.kind]} Q${d.probs.indexOf(cur) + 1} cleared</b> · ${fmtClock(t)}${left.length ? ' · ' + left.length + ' to go' : ''}`);
  if (!left.length) setTimeout(() => arenaFinish('done'), 900);
  else if (d.kind === 'speed') setTimeout(() => { if (G.arena === a) arenaOpen(left[0]); }, 1100);
}

function arenaOpen(id) {
  const p = byId(id);
  if (p) openFromPlan(p.id, p.schema_name);
}
function arenaStart(key) {
  const d = findDef(key);
  if (!d) return;
  if (G.arena && G.arena.key !== key) {
    const o = arenaDef();
    return toast(`<b>Run in progress</b> · finish or abandon ${esc(o ? o.title : 'it')} first`, 'warn');
  }
  if (!G.arena) {
    G.arena = { key, start:Date.now(), solved:{}, wrong:{}, drafts:{}, last:0 };
    pushFeed(ARENA_ICON[d.kind], 'Started ' + d.title);
    saveGame(); sfx('unlock');
  }
  arenaOpen(d.probs.find(id => G.arena.solved[id] == null) || d.probs[0]);
}
function arenaAbandon() {
  if (!G.arena) return;
  G.arena = null; saveGame(); arenaTick();
  toast('Run abandoned · nothing recorded', 'warn');
  if (!$id('arena').hidden) renderArena();
}

function arenaFinish(reason) {
  const d = arenaDef(), a = G.arena;
  if (!d) return;
  G.arena = null;
  const r = arenaScore(d, a);
  let best = false, xp = 0;
  if (d.kind === 'speed') {
    const rec = G.speed[d.key] || { best:0, medal:0, plays:0 };
    rec.plays++;
    if (r.solved === r.n) {
      if (!rec.best || r.time < rec.best) { rec.best = r.time; best = true; }
      if (r.medal > rec.medal) { xp = (r.medal - rec.medal) * 10; rec.medal = r.medal; }
    }
    G.speed[d.key] = rec;
  } else {
    const rec = G.contests[d.key] || { stars:0, score:0, time:0, solved:0, n:r.n, plays:0 };
    rec.plays++; rec.n = r.n;
    if (r.solved && (r.score > rec.score || (r.score === rec.score && r.time < rec.time))) {
      Object.assign(rec, { score:r.score, time:r.time, solved:r.solved }); best = true;
    }
    if (r.stars > rec.stars) { xp = (r.stars - rec.stars) * 5; rec.stars = r.stars; }
    G.contests[d.key] = rec;
  }
  G.bonus += xp;
  pushFeed(ARENA_ICON[d.kind], `${d.title}: ${d.kind === 'speed' ? (r.solved === r.n ? fmtClock(r.time) : 'unfinished') : r.solved + '/' + r.n + ' solved'}`);
  saveGame(); arenaTick(); updatePointsUI();
  showArenaResult(d, r, { best, xp, reason });
}

/* ---------- workspace bar + timer ---------- */
function renderArenaBar() {
  const bar = $id('arenaBar'), d = arenaDef();
  bar.hidden = !d;
  document.body.classList.toggle('in-arena', !!d);
  if (!d) return;
  const a = G.arena, r = arenaScore(d, a), wrong = Object.values(a.wrong).reduce((s, n) => s + n, 0);
  bar.className = 'arena-bar ' + d.kind;
  bar.innerHTML = `<span class="ab-title" title="${esc(d.title)}">${ARENA_ICON[d.kind]} <b>${esc(d.title)}</b></span>
    <span class="ab-chips">${d.probs.map((id, i) => {
      const p = byId(id) || {}, w = a.wrong[id];
      return `<button type="button" class="ab-chip ${esc(p.difficulty)}${a.solved[id] != null ? ' ok' : ''}${id === cur ? ' cur' : ''}"
        data-id="${id}" title="${esc(p.title)} · ${esc(p.difficulty)}${w ? ' · ' + w + ' wrong' : ''}">${a.solved[id] != null ? '✓' : 'Q' + (i + 1)}</button>`;
    }).join('')}</span>
    <span class="ab-score">${d.kind === 'speed' ? r.solved + '/' + r.n + ' cleared' : r.score + ' / ' + r.max + ' pts'}</span>
    ${wrong ? `<span class="ab-wrong" title="Wrong checks">✕ ${wrong}</span>` : ''}
    <span class="ab-time" id="abTime">--:--</span>
    <button type="button" class="btn" id="abEnd">Finish</button>`;
  bar.querySelectorAll('.ab-chip').forEach(b => b.onclick = () => arenaOpen(+b.dataset.id));
  $id('abEnd').onclick = () => {
    const left = d.probs.length - r.solved;
    if (!left || confirm(`Finish now? ${left} problem${left === 1 ? ' is' : 's are'} still open.`)) arenaFinish('manual');
  };
  arenaTick();
}
function arenaTick() {
  const d = arenaDef();
  if (!d) {
    if (!$id('arenaBar').hidden) renderArenaBar();
    return;
  }
  if ($id('arenaBar').hidden) return renderArenaBar();
  const left = arenaLeft(d);
  if (left <= 0) return arenaFinish('time');
  const txt = d.mins ? fmtClock(left) : fmtClock(Date.now() - G.arena.start);
  const el = $id('abTime');
  if (el) {
    el.textContent = (d.mins ? '⏳ ' : '⏱ ') + txt;
    el.classList.toggle('low', d.mins && left < 3 * 60e3);
  }
  const rb = $id('arResumeTime');
  if (rb) rb.textContent = (d.mins ? 'left ' : 'elapsed ') + txt;
}
setInterval(arenaTick, 1000);

/* ---------- arena page ---------- */
function stars(n, max = 3) {
  return `<span class="stars">${Array.from({ length:max }, (_, i) => `<i class="${i < n ? 'on' : ''}">★</i>`).join('')}</span>`;
}
function diffDots(ids) {
  return `<span class="ddots">${ids.map(id => { const p = byId(id) || {};
    return `<i class="${esc(p.difficulty)}" title="${esc(p.title)} · ${esc(p.difficulty)}"></i>`; }).join('')}</span>`;
}
function arenaCard(d) {
  const live = G.arena && G.arena.key === d.key;
  if (d.kind === 'speed') {
    const rec = G.speed[d.key] || {};
    return `<div class="ar-card speed${rec.medal ? ' m' + rec.medal : ''}${live ? ' live' : ''}">
      <div class="ar-top"><span class="ar-num">${d.num}</span><span class="ar-medal">${MEDALS[rec.medal || 0] || '🏁'}</span></div>
      <b class="ar-name">${esc(d.name)}</b>
      <div class="ar-meta">${d.probs.length} problems · stopwatch</div>
      ${diffDots(d.probs)}
      <div class="ar-par"><span>🥇 ${fmtClock(d.par)}</span><span>🥈 ${fmtClock(2 * d.par)}</span><span>🥉 ${fmtClock(3 * d.par)}</span></div>
      <div class="ar-best">${rec.best ? 'Best <b>' + fmtClock(rec.best) + '</b>' : 'No finished run yet'}${rec.plays ? ' · ' + rec.plays + ' run' + (rec.plays === 1 ? '' : 's') : ''}</div>
      <button class="btn ${live ? 'primary' : 'orange'}" data-start="${d.key}">${live ? 'Resume' : rec.best ? 'Beat your time' : 'Start run'}</button>
    </div>`;
  }
  const rec = G.contests[d.key] || {};
  return `<div class="ar-card ${d.kind}${rec.stars === 3 ? ' perfect' : rec.stars ? ' played' : ''}${live ? ' live' : ''}">
    <div class="ar-top"><span class="ar-num">${d.kind === 'contest' ? '#' + d.num : d.num}</span>
      ${d.tier ? `<span class="tier ${d.tier}">${d.tier}</span>` : ''}${stars(rec.stars || 0)}</div>
    <b class="ar-name">${esc(d.name)}</b>
    <div class="ar-meta">${d.probs.length} problems · ${d.mins} min · ${arenaScore(d, { solved:{}, wrong:{} }).max} pts</div>
    ${diffDots(d.probs)}
    <div class="ar-best">${rec.solved ? `Best <b>${rec.score} pts</b> · ${rec.solved}/${rec.n} · ${fmtClock(rec.time)}` : 'Not played yet'}</div>
    <button class="btn ${live ? 'primary' : 'orange'}" data-start="${d.key}">${live ? 'Resume' : rec.plays ? 'Retry' : 'Enter contest'}</button>
  </div>`;
}

function renderArena() {
  const box = $id('arenaGrid');
  if (!items.length) { box.innerHTML = '<p class="hint">Loading…</p>'; return; }
  const D = arenaDefs(), s = calcPoints();
  $id('arStars').textContent = s.cStars;
  $id('arStarsOf').textContent = '/ ' + D.contest.length * 3 + ' contest stars';
  $id('arDone').textContent = s.cDone;
  $id('arDoneOf').textContent = '/ ' + D.contest.length + ' contests';
  $id('arSec').textContent = s.secAced;
  $id('arSecOf').textContent = '/ ' + D.section.length + ' sections swept';
  $id('arGold').textContent = s.spGold;
  $id('arGoldOf').textContent = '/ ' + D.speed.length + ' gold medals';
  $id('arTabContest').textContent = D.contest.length;
  $id('arTabSection').textContent = D.section.length;
  $id('arTabSpeed').textContent = D.speed.length;
  document.querySelectorAll('#arenaTabs .fchip').forEach(b => b.classList.toggle('active', b.dataset.t === arenaTab));
  $id('arenaIntro').innerHTML = {
    contest:'<b>20 timed contests</b>, Bronze → Silver → Gold tiers. Score Easy 3 · Medium 5 · Hard 7. Each wrong Check adds a 5-minute penalty. ★ solve one · ★★ solve all · ★★★ solve all, no wrong checks, in half the time.',
    section:'<b>One contest per study-plan section.</b> Up to 4 problems from the topic, timed by difficulty. Same scoring and stars as contests — sweep them all to conquer the plan.',
    speed:'<b>Clear every problem of a section, against the clock.</b> No time limit; each wrong Check adds 30 s. Beat par for 🥇, 2× par for 🥈, 3× par for 🥉. The next problem opens automatically.'
  }[arenaTab];

  const d = arenaDef();
  $id('arResume').hidden = !d;
  if (d) {
    const r = arenaScore(d, G.arena);
    $id('arResumeTitle').textContent = ARENA_ICON[d.kind] + ' ' + d.title;
    $id('arResumeSub').textContent = r.solved + ' / ' + r.n + ' solved';
    arenaTick();
  }
  box.innerHTML = D[arenaTab].map(arenaCard).join('');
  box.querySelectorAll('[data-start]').forEach(b => b.onclick = () => arenaStart(b.dataset.start));

  const list = ACHIEVEMENTS.filter(a => a.arena);
  $id('arAchCount').textContent = list.filter(a => G.unlocked[a.id]).length + ' / ' + list.length + ' unlocked';
  $id('arAch').innerHTML = list.map(a => achvHtml(a, s)).join('');
}

function showArenaResult(d, r, o) {
  const speed = d.kind === 'speed', all = r.solved === r.n;
  $id('arrIco').textContent = speed ? (MEDALS[r.medal] || (all ? '🏁' : '⌛')) : ['😶', '🎖️', '🏅', '🏆'][r.stars];
  $id('arrTitle').textContent = o.reason === 'time' ? "Time's up!" : speed ? (all ? 'Run complete!' : 'Run ended')
    : all ? 'Contest cleared!' : 'Contest finished';
  $id('arrSub').textContent = d.title;
  $id('arrStars').innerHTML = speed ? '' : stars(r.stars);
  const cell = (b, l) => `<div><b>${b}</b><span>${l}</span></div>`;
  $id('arrStats').innerHTML = [
    cell(r.solved + '/' + r.n, 'solved'),
    speed ? cell(all ? fmtClock(r.time) : '—', 'final time') : cell(r.score + '/' + r.max, 'points'),
    speed ? cell(fmtClock(d.par), 'par') : cell(r.solved ? fmtClock(r.time) : '—', 'finish + penalty'),
    cell(r.wrongs, 'wrong checks')].join('');
  $id('arrBadges').innerHTML = (o.best ? '<span class="pill solved">🎉 New personal best</span>' : '')
    + (o.xp ? `<span class="xp-pill">+${o.xp} XP</span>` : '');
  $id('arenaResult').hidden = false;
  $id('arrOk').focus();
  $id('arrRetry').onclick = () => { $id('arenaResult').hidden = true; arenaStart(d.key); };
  if (all || r.solved) { sfx('level'); confetti(all ? 180 : 60); } else sfx('bad');
}

$id('arrOk').onclick = () => { $id('arenaResult').hidden = true; showView('arena'); };
$id('arAbandon').onclick = () => { if (confirm('Abandon this run? Nothing will be recorded.')) arenaAbandon(); };
$id('arResumeGo').onclick = () => { const d = arenaDef(); if (d) arenaStart(d.key); };
$id('navArena').onclick = e => { e.preventDefault(); showView('arena'); };
document.querySelectorAll('#arenaTabs .fchip').forEach(b => b.onclick = () => { arenaTab = b.dataset.t; renderArena(); });
