/* ---------- feedback: sound, confetti, celebrations ---------- */
let actx = null;
function sfx(kind) {
  if (!PROFILE.sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const notes = { win:[523, 659, 784], bad:[247, 196], unlock:[659, 880, 1047], level:[523, 659, 784, 1047, 1319] }[kind] || [];
    notes.forEach((f, i) => {
      const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + i * .09;
      o.type = 'triangle'; o.frequency.value = f;
      g.gain.setValueAtTime(.0001, t);
      g.gain.exponentialRampToValueAtTime(kind === 'bad' ? .06 : .12, t + .02);
      g.gain.exponentialRampToValueAtTime(.0001, t + .25);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + .28);
    });
  } catch (e) {}
}

const confettiPs = [];
function confetti(n = 120) {
  if (!PROFILE.confetti || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = document.getElementById('confetti'), x = c.getContext('2d');
  const colors = ['#ffa116', '#2cbb5d', '#00b8a3', '#ffc01e', '#ff375f', '#9cdcfe'];
  for (let i = 0; i < n; i++) confettiPs.push({ x:innerWidth / 2 + (Math.random() - .5) * 240, y:innerHeight * .38,
    vx:(Math.random() - .5) * 16, vy:-Math.random() * 13 - 4, r:Math.random() * 6 + 4,
    c:colors[Math.random() * colors.length | 0], a:Math.random() * 6, va:(Math.random() - .5) * .3 });
  if (confettiPs.length > n) return;   // a loop is already running
  c.width = innerWidth; c.height = innerHeight;
  (function tick() {
    x.clearRect(0, 0, c.width, c.height);
    for (let i = confettiPs.length - 1; i >= 0; i--) {
      const p = confettiPs[i];
      p.vy += .35; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.a += p.va;
      if (p.y > c.height + 20) { confettiPs.splice(i, 1); continue; }
      x.save(); x.translate(p.x, p.y); x.rotate(p.a); x.fillStyle = p.c;
      x.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); x.restore();
    }
    if (confettiPs.length) requestAnimationFrame(tick); else x.clearRect(0, 0, c.width, c.height);
  })();
}

function celebrate(icon, title, text) {
  document.getElementById('celIco').textContent = icon;
  document.getElementById('celTitle').textContent = title;
  document.getElementById('celText').textContent = text;
  document.getElementById('celebrate').hidden = false;
  document.getElementById('celOk').focus();
  sfx('level'); confetti(180);
}

// unlock achievements / detect level-ups; silent on first load so old progress doesn't spam
function syncGame(s, silent) {
  let changed = false, fresh = [];
  ACHIEVEMENTS.forEach(a => {
    const goal = achGoal(a, s);
    if (G.unlocked[a.id] || goal <= 0 || a.v(s) < goal) return;
    G.unlocked[a.id] = Date.now(); changed = true;
    if (!silent) { fresh.push(a); justUnlocked.add(a.id); pushFeed(a.icon, 'Unlocked ' + a.name); }
  });
  fresh.forEach((a, i) => setTimeout(() =>
    toast(`<span class="ti">${a.icon}</span><div><b>Achievement unlocked!</b><br>${esc(a.name)} · ${esc(a.desc)}</div>`, 'ach'), 500 + i * 700));
  if (fresh.length) { setTimeout(() => sfx('unlock'), 450); confetti(60); }
  if (s.level !== G.level) {
    if (!silent && G.level > 0 && s.level > G.level) {
      pushFeed('🚀', 'Reached level ' + s.level);
      setTimeout(() => celebrate('🚀', 'Level ' + s.level + '!', `You are now a ${levelTitle(s.level)}. Keep going!`), 300);
    }
    G.level = s.level; changed = true;
  }
  if (changed) saveGame();
}
const levelTitle = lv => LEVEL_TITLES[Math.min(lv, LEVEL_TITLES.length) - 1];

function animateNumber(el, from, to) {
  const t0 = performance.now(), dur = 420;
  const tick = now => {
    const k = Math.min(1, (now - t0) / dur);
    el.textContent = Math.round(from + (to - from) * k);
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function updatePointsUI() {
  const s = calcPoints();
  if (items.length) syncGame(s, !gameReady);
  document.getElementById('navPointsNum').textContent = s.pts;
  document.getElementById('navStreakNum').textContent = s.streak;
  document.getElementById('navStreak').classList.toggle('cold', !s.streak);
  document.getElementById('navStreak').title = s.streak + '-day streak';
  document.getElementById('navLevel').textContent = 'L' + s.level;
  if (!document.getElementById('home').hidden) renderHome(s);
}

const $id = id => document.getElementById(id);
function timeAgo(t) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  if (m < 1440) return Math.round(m / 60) + 'h ago';
  return Math.round(m / 1440) + 'd ago';
}
function nextProblem() {
  const last = items.find(p => p.id === G.lastOpen && p.status !== 'solved');
  return last || items.find(p => p.status !== 'solved') || items[0];
}

function renderHome(s = calcPoints()) {
  const hr = new Date().getHours();
  $id('helloAv').textContent = PROFILE.avatar;
  $id('helloText').textContent = (hr < 5 ? 'Burning the midnight oil' : hr < 12 ? 'Good morning'
    : hr < 17 ? 'Good afternoon' : 'Good evening') + ', ' + (PROFILE.name || 'there');
  $id('helloSub').textContent = !s.total ? 'Loading your progress…'
    : s.solved === 0 ? 'Your SQL journey starts today. Solve one problem to unlock ⚡ First Blood.'
    : s.solved === s.total ? 'All problems solved. You are a legend — try to keep the streak alive.'
    : `${s.total - s.solved} problems to go. ${s.streak ? 'Keep your ' + s.streak + '-day streak alive!' : 'Start a streak today!'}`;

  const into = s.pts % 100;
  $id('ptLevel').textContent = 'Level ' + s.level;
  $id('ptTitle').textContent = levelTitle(s.level);
  $id('ptBar').style.width = into + '%';
  $id('ptNext').textContent = (100 - into) + ' XP to level ' + (s.level + 1);
  const totalEl = $id('ptTotal'), prev = +totalEl.dataset.v || 0;
  if (prev !== s.pts) { animateNumber(totalEl, prev, s.pts); totalEl.dataset.v = s.pts; }

  const next = nextProblem();
  $id('homeContinueLabel').textContent = !s.solved ? 'Start plan' : next && next.status !== 'solved' ? 'Continue · #' + next.id : 'Review plan';
  $id('homeFlame').classList.toggle('cold', !s.streak);
  $id('homeStreak').textContent = s.streak;
  $id('homeBest').textContent = 'best ' + s.best;
  const today = (G.days[dayKey()] || { s:0 }).s, goal = PROFILE.goal;
  $id('goalRing').style.setProperty('--p', Math.min(100, today / goal * 100));
  $id('goalRing').classList.toggle('done', today >= goal);
  $id('goalText').textContent = today + '/' + goal;
  $id('goalSub').textContent = today >= goal ? 'goal hit ✓' : (goal - today) + ' to go today';

  $id('kSolved').textContent = s.solved;
  $id('kSolvedOf').textContent = 'of ' + s.total + ' solved';
  $id('kAcc').textContent = G.checks ? Math.round(G.checksOk / G.checks * 100) + '%' : '—';
  $id('kFirst').textContent = s.firstTry;
  const unlocked = ACHIEVEMENTS.filter(a => G.unlocked[a.id]).length;
  $id('kAch').textContent = unlocked;
  $id('kAchOf').textContent = 'of ' + ACHIEVEMENTS.length + ' achievements';

  // daily challenge
  const dp = dailyProblem(), doneToday = G.daily[dayKey()];
  $id('dailyCard').innerHTML = !dp ? '<p class="hint">Loading today\'s challenge…</p>' : `
    <div class="task-kicker">☀️ Daily challenge</div>
    <div class="daily-title">${dp.id}. ${esc(dp.title)}</div>
    <div class="daily-meta"><span class="diff ${esc(dp.difficulty)}">${esc(dp.difficulty)}</span><span>·</span>
      <span>${esc(dp.topic)}</span><span class="xp-pill">+${(DIFF_POINTS[dp.difficulty] || 10) + BONUS.daily} XP</span>
      <span class="countdown" id="dailyCountdown"></span></div>
    ${doneToday ? '<span class="pill solved">✓ Completed today — new challenge at midnight</span>'
      : dp.status === 'solved' ? '<button class="btn" id="dailyGo">Already solved · review it</button>'
      : '<button class="btn orange" id="dailyGo">Accept challenge →</button>'}`;
  const dg = $id('dailyGo');
  if (dg) dg.onclick = () => openFromPlan(dp.id, dp.schema_name);
  tickCountdown();

  // heatmap: last 17 weeks, columns = weeks starting Sunday
  const end = new Date(), start = new Date();
  start.setDate(end.getDate() - (16 * 7 + end.getDay()));
  let cells = '', activeDays = 0;
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const k = dayKey(d), v = G.days[k] || { a:0, s:0 }, n = v.a + v.s * 3;
    if (n) activeDays++;
    const l = !n ? '' : n < 3 ? 'l1' : n < 6 ? 'l2' : n < 10 ? 'l3' : 'l4';
    cells += `<i class="${l}${k === dayKey() ? ' today' : ''}" title="${k}: ${v.s} solved, ${v.a} actions"></i>`;
  }
  $id('heat').innerHTML = cells;
  $id('heatSum').textContent = activeDays + ' active day' + (activeDays === 1 ? '' : 's');

  $id('topicBars').innerHTML = [...s.byTopic.entries()].map(([t, v]) => {
    const pct = Math.round(v.solved / v.total * 100);
    return `<div class="mrow${v.solved === v.total ? ' done' : ''}" data-go="plan" title="${pct}% complete">
      <span class="mname">${esc(t)}</span><span class="mbar"><i style="width:${pct}%"></i></span><span class="mnum">${v.solved}/${v.total}</span></div>`;
  }).join('');
  $id('topicSum').textContent = s.topicsDone + ' / ' + s.byTopic.size + ' complete';
  $id('diffBars').innerHTML = ['Easy', 'Medium', 'Hard'].map(d => {
    const [a, b] = s.diff[d], pct = b ? Math.round(a / b * 100) : 0;
    return `<div class="mrow" data-go="plan"><span class="mname diff ${d}">${d}</span>
      <span class="mbar ${d}"><i style="width:${pct}%"></i></span><span class="mnum">${a}/${b}</span></div>`;
  }).join('');
  document.querySelectorAll('#home [data-go="plan"]').forEach(r => r.onclick = () => showView('plan'));

  $id('feed').innerHTML = G.feed.length ? G.feed.slice(0, 8).map(f =>
    `<li><span class="fi">${f.icon}</span><span class="ft">${esc(f.text)}</span><time>${timeAgo(f.t)}</time></li>`).join('')
    : '<li class="hint">No activity yet. Solve a problem to get started.</li>';

  $id('achCount').textContent = unlocked + ' / ' + ACHIEVEMENTS.length + ' unlocked';
  $id('ptAchievements').innerHTML = ACHIEVEMENTS.filter(a =>
    achFilter === 'all' || (achFilter === 'on') === !!G.unlocked[a.id]).map(a => {
    const goal = Math.max(1, achGoal(a, s)), on = !!G.unlocked[a.id], v = Math.min(a.v(s), goal);
    return `<div class="achv${on ? ' on' : ''}${justUnlocked.has(a.id) ? ' new' : ''}" title="${on ? 'Unlocked ' + new Date(G.unlocked[a.id]).toLocaleDateString() : 'Locked'}">
      <div class="ai">${a.icon}</div><b>${esc(a.name)}</b><p>${esc(a.desc)}</p>
      <div class="ap"><i style="width:${on ? 100 : v / goal * 100}%"></i></div>
      <div class="an"><span>${on ? '✓ Unlocked' : 'Locked'}</span><span>${on ? goal : v} / ${goal}</span></div></div>`;
  }).join('') || '<p class="hint">Nothing here yet.</p>';
  justUnlocked.clear();
}

function tickCountdown() {
  const el = $id('dailyCountdown');
  if (!el) return;
  const mid = new Date(); mid.setHours(24, 0, 0, 0);
  const sec = Math.max(0, Math.floor((mid - Date.now()) / 1000));
  el.textContent = '⏳ ' + [sec / 3600 | 0, (sec % 3600) / 60 | 0, sec % 60].map(n => String(n).padStart(2, '0')).join(':');
  if (G.dailyPick && G.dailyPick.date !== dayKey() && !$id('home').hidden) renderHome();   // day rolled over
}
setInterval(tickCountdown, 1000);
