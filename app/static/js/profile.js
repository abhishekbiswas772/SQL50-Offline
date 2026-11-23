/* ---------- profile UI ---------- */
function renderAvPick(box, selected, onPick) {
  box.innerHTML = AVATARS.map(a =>
    `<button type="button" aria-pressed="${a === selected}" aria-label="Avatar ${a}">${a}</button>`).join('');
  box.querySelectorAll('button').forEach(b => b.onclick = () => {
    box.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    onPick(b.textContent);
  });
}
function applyProfile() {
  $id('navAvatar').textContent = PROFILE.avatar;
  $id('navName').textContent = PROFILE.name || 'You';
  cm.getWrapperElement().style.fontSize = PROFILE.fontSize + 'px';
  cm.refresh();
}

/* ---------- login ---------- */
const DEMO_SQL = [
  "SELECT name\nFROM customer\nWHERE referee_id <> 2\n   OR referee_id IS NULL;",
  "SELECT e.name, b.bonus\nFROM employee e\nLEFT JOIN bonus b USING (empid)\nWHERE COALESCE(b.bonus, 0) < 1000;",
  "SELECT TO_CHAR(trans_date, 'YYYY-MM') AS month,\n       country,\n       COUNT(*) AS trans_count\nFROM transactions\nGROUP BY 1, 2;"
];
let typeTimer = null, loginAvatar = PROFILE.avatar, authMode = 'signin', authBusy = false;
function startTyping() {
  const el = $id('typeSql');
  clearInterval(typeTimer);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = DEMO_SQL[0]; return; }
  let si = 0, ci = 0, hold = 0;
  typeTimer = setInterval(() => {
    if ($id('login').hidden) return clearInterval(typeTimer);
    const s = DEMO_SQL[si];
    if (ci <= s.length) el.textContent = s.slice(0, ci++);
    else if (++hold > 45) { hold = 0; ci = 0; si = (si + 1) % DEMO_SQL.length; }
  }, 45);
}
function setAuthMode(mode) {
  authMode = mode;
  const up = mode === 'signup';
  $id('tabSignin').classList.toggle('on', !up); $id('tabSignin').setAttribute('aria-selected', String(!up));
  $id('tabSignup').classList.toggle('on', up); $id('tabSignup').setAttribute('aria-selected', String(up));
  document.querySelectorAll('#loginForm .signup-only').forEach(el => el.hidden = !up);
  $id('authTitle').textContent = up ? 'Create your account' : 'Welcome back';
  $id('authSub').textContent = up ? 'Your progress, XP and achievements are saved to your account.' : 'Sign in to pick up where you left off.';
  $id('loginGo').textContent = up ? 'Create account →' : 'Sign in →';
  $id('authPass').autocomplete = up ? 'new-password' : 'current-password';
  $id('authSwitch').innerHTML = up ? 'Already have an account? <button type="button" class="linkish" data-mode="signin">Sign in</button>'
    : 'New here? <button type="button" class="linkish" data-mode="signup">Create an account</button>';
  $id('authSwitch').querySelector('button').onclick = e => setAuthMode(e.target.dataset.mode);
  if (up) renderAvPick($id('loginAvPick'), loginAvatar, a => { loginAvatar = a; });
  authError('');
  (up ? $id('loginName') : $id('authUser')).focus();
}
function authError(msg, field) {
  $id('authErr').textContent = msg; $id('authErr').hidden = !msg;
  document.querySelectorAll('#loginForm .input').forEach(i => i.classList.remove('bad'));
  if (field) { void field.offsetWidth; field.classList.add('bad'); field.focus(); }
}
function pwScore(p) {
  return Math.min(4, (p.length >= 8) + (p.length >= 12) + (/[a-z]/.test(p) && /[A-Z]/.test(p)) + /\d/.test(p) + /[^A-Za-z0-9]/.test(p));
}
function showLogin() {
  $id('login').hidden = false;
  setAuthMode(authMode);
  startTyping();
}
// localStorage caches belong to one account: drop them when a different user signs in
function adoptUser(user) {
  USER = user;
  let prev = null;
  try { prev = localStorage.getItem('sql50-user'); } catch (e) {}
  if (prev !== String(user.id)) {
    ['sql50-profile', 'sql50-game', 'sql50-chats'].forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
    PROFILE = { ...PROFILE_DEFAULT }; G = GAME_DEFAULT();
    Object.keys(CHATS).forEach(k => delete CHATS[k]);
    try { localStorage.setItem('sql50-user', String(user.id)); } catch (e) {}
  }
}
$id('loginForm').onsubmit = async e => {
  e.preventDefault();
  if (authBusy) return;
  const up = authMode === 'signup', user = $id('authUser').value.trim(), pass = $id('authPass').value;
  const name = $id('loginName').value.trim().slice(0, 24);
  if (up && !name) return authError('Please enter a display name', $id('loginName'));
  if (!/^[A-Za-z0-9_.-]{3,24}$/.test(user)) return authError('Username must be 3–24 letters, digits, _ . or -', $id('authUser'));
  if (pass.length < 8) return authError('Password must be at least 8 characters', $id('authPass'));
  if (up && pass !== $id('authPass2').value) return authError('Passwords do not match', $id('authPass2'));
  authBusy = true; authError('');
  const go = $id('loginGo'), label = go.textContent;
  go.disabled = true; go.innerHTML = '<span class="spin"></span> ' + (up ? 'Creating account…' : 'Signing in…');
  let r;
  try {
    r = await (await fetch('/api/auth/' + (up ? 'signup' : 'signin'), { method:'POST',
      headers:{'Content-Type':'application/json'}, body:JSON.stringify({ username:user, password:pass }) })).json();
  } catch (err) { r = { ok:false, error:'Could not reach the server' }; }
  authBusy = false; go.disabled = false; go.textContent = label;
  if (!r.ok) return authError(r.error || 'Something went wrong', up && /taken/.test(r.error || '') ? $id('authUser') : $id('authPass'));
  if (booted) return location.reload();   // session expired mid-use: start clean
  adoptUser(r.user);
  $id('authPass').value = $id('authPass2').value = '';
  $id('login').hidden = true;
  await boot(up ? { name, avatar:loginAvatar } : null);
  toast(up ? `<b>Welcome, ${esc(PROFILE.name)}!</b> ${PROFILE.avatar}` : `<b>Welcome back, ${esc(PROFILE.name || user)}!</b> ${PROFILE.avatar}`);
};
$id('tabSignin').onclick = () => setAuthMode('signin');
$id('tabSignup').onclick = () => setAuthMode('signup');
$id('authEye').onclick = () => {
  const show = $id('authPass').type === 'password';
  [$id('authPass'), $id('authPass2')].forEach(i => i.type = show ? 'text' : 'password');
  $id('authEye').setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  $id('authEye').classList.toggle('on', show);
};
$id('authPass').oninput = () => {
  const n = pwScore($id('authPass').value);
  $id('pwBar').style.width = n * 25 + '%';
  $id('pwBar').className = 's' + n;
};
document.querySelectorAll('#loginForm .input').forEach(i => i.addEventListener('input', () => i.classList.remove('bad')));
async function logout() {
  try { await fetch('/api/auth/signout', { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' }); } catch (e) {}
  ['sql50-profile', 'sql50-game', 'sql50-chats', 'sql50-user'].forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
  location.reload();
}

/* ---------- onboarding ---------- */
let obStep = 0;
const OB_STEPS = [
  () => `<div class="ob-ico">${PROFILE.avatar}</div><h2>Welcome, ${esc(PROFILE.name)}!</h2>
    <p>SQL50 is your offline gym for LeetCode's <b>Top SQL 50</b>. Every query runs against a real PostgreSQL 18 database on this computer.</p>
    <ul class="ob-list"><li>📋 50 curated problems across 7 topics</li><li>🐘 Real sample data from each problem</li>
    <li>🔒 Works fully offline — nothing leaves your machine</li></ul>`,
  () => `<div class="ob-ico">⌨️</div><h2>How to solve</h2>
    <p>Pick a problem, read the task and sample tables, write SQL in the editor.</p>
    <ul class="ob-list"><li>▶ Run your query <b><kbd>Ctrl</kbd>+<kbd>Enter</kbd></b></li>
    <li>✅ Check against the expected output <b><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Enter</kbd></b></li>
    <li>💡 Autocomplete tables & columns <b><kbd>Ctrl</kbd>+<kbd>Space</kbd></b></li>
    <li>🧹 Format SQL <b><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd></b></li></ul>`,
  () => `<div class="ob-ico">🏆</div><h2>Earn XP, level up</h2>
    <p>Accepted solves earn XP. Every 100 XP is a new level. Unlock ${ACHIEVEMENTS.length} achievements along the way.</p>
    <ul class="ob-list"><li>✅ Easy / Medium / Hard solve <b>+10 / 20 / 30</b></li>
    <li>🏹 Accepted on the first Check <b>+5</b></li><li>☀️ Daily challenge <b>+15</b></li>
    <li>🔥 Practice daily to grow your streak <b>streak</b></li></ul>`,
  () => `<div class="ob-ico">🥅</div><h2>Set your daily goal</h2>
    <p>How many problems do you want to solve each day?</p>
    <div class="choice" id="obGoal">${[1, 2, 3, 5, 10].map(n =>
      `<button class="fchip${n === PROFILE.goal ? ' active' : ''}" data-goal="${n}">${n} / day</button>`).join('')}</div>
    <div class="set-row" style="margin-top:16px"><div class="lbl"><b>Sound effects</b><span>Chimes on solves and unlocks</span></div>
      <label class="switch"><input type="checkbox" id="obSound"${PROFILE.sound ? ' checked' : ''} aria-label="Sound effects"><span></span></label></div>
    <div class="set-row"><div class="lbl"><b>Light theme</b><span>You can change this anytime in Settings</span></div>
      <label class="switch"><input type="checkbox" id="obLight"${document.documentElement.dataset.theme === 'light' ? ' checked' : ''} aria-label="Light theme"><span></span></label></div>`
];
function renderOnboarding() {
  $id('obBody').innerHTML = `<div class="ob-step">${OB_STEPS[obStep]()}</div>`;
  $id('obDots').innerHTML = OB_STEPS.map((_, i) => `<i class="${i === obStep ? 'on' : ''}"></i>`).join('');
  $id('obBack').hidden = obStep === 0;
  $id('obNext').textContent = obStep === OB_STEPS.length - 1 ? "Let's go! 🚀" : 'Next';
  const goal = $id('obGoal');
  if (goal) {
    goal.querySelectorAll('button').forEach(b => b.onclick = () => {
      PROFILE.goal = +b.dataset.goal; saveProfile();
      goal.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
    });
    $id('obSound').onchange = e => { PROFILE.sound = e.target.checked; saveProfile(); sfx('unlock'); };
    $id('obLight').onchange = e => applyTheme(e.target.checked ? 'light' : 'dark');
  }
  $id('obNext').focus();
}
function openOnboarding() { obStep = 0; $id('onboard').hidden = false; renderOnboarding(); }
function closeOnboarding(finished) {
  PROFILE.onboarded = true; saveProfile();
  $id('onboard').hidden = true;
  renderHome();
  if (finished) { confetti(160); sfx('level'); toast("<b>You're all set!</b> Pick today's daily challenge to start"); }
}
$id('obNext').onclick = () => {
  if (obStep < OB_STEPS.length - 1) { obStep++; renderOnboarding(); } else closeOnboarding(true);
};
$id('obBack').onclick = () => { if (obStep > 0) { obStep--; renderOnboarding(); } };
$id('obSkip').onclick = () => closeOnboarding(false);
document.addEventListener('keydown', e => {
  if (!$id('celebrate').hidden && (e.key === 'Escape' || e.key === 'Enter')) { e.preventDefault(); $id('celebrate').hidden = true; return; }
  if ($id('onboard').hidden) return;
  if (e.key === 'Escape') closeOnboarding(false);
  else if (e.key === 'ArrowRight') $id('obNext').click();
  else if (e.key === 'ArrowLeft') $id('obBack').click();
});

/* ---------- settings ---------- */
function renderSettings() {
  const s = calcPoints();
  $id('setAvBig').textContent = PROFILE.avatar;
  $id('setNameShow').textContent = PROFILE.name || 'You';
  $id('setMeta').textContent = (USER ? '@' + USER.username + ' · ' : '') + `Level ${s.level} · ${levelTitle(s.level)} · ${s.pts} XP` +
    (PROFILE.since ? ' · member since ' + new Date(PROFILE.since).toLocaleDateString() : '');
  $id('setName').value = PROFILE.name;
  renderAvPick($id('setAvPick'), PROFILE.avatar, a => {
    PROFILE.avatar = a; saveProfile(); applyProfile();
    $id('setAvBig').textContent = a; toast('Avatar updated ' + a);
  });
  $id('setGoal').innerHTML = [1, 2, 3, 5, 10].map(n =>
    `<button class="fchip${n === PROFILE.goal ? ' active' : ''}" data-goal="${n}">${n} / day</button>`).join('');
  $id('setGoal').querySelectorAll('button').forEach(b => b.onclick = () => {
    PROFILE.goal = +b.dataset.goal; saveProfile(); renderSettings(); updatePointsUI();
    toast('Daily goal set to <b>' + PROFILE.goal + '</b> per day');
  });
  $id('setFont').value = PROFILE.fontSize;
  $id('setFontVal').textContent = PROFILE.fontSize + 'px';
  $id('setFontPreview').style.fontSize = PROFILE.fontSize + 'px';
  $id('setSound').checked = PROFILE.sound;
  $id('setConfetti').checked = PROFILE.confetti;
  $id('setAuto').checked = PROFILE.autocomplete;
  $id('setAiAuto').checked = PROFILE.aiAuto;
}
$id('setNameSave').onclick = () => {
  const name = $id('setName').value.trim().slice(0, 24);
  if (!name) { $id('setName').classList.add('bad'); return toast('Name cannot be empty', 'warn'); }
  $id('setName').classList.remove('bad');
  PROFILE.name = name; saveProfile(); applyProfile(); renderSettings();
  toast('Name saved');
};
$id('setName').onkeydown = e => { if (e.key === 'Enter') $id('setNameSave').click(); };
$id('setFont').oninput = e => {
  PROFILE.fontSize = +e.target.value; saveProfile(); applyProfile();
  $id('setFontVal').textContent = PROFILE.fontSize + 'px';
  $id('setFontPreview').style.fontSize = PROFILE.fontSize + 'px';
};
$id('setSound').onchange = e => { PROFILE.sound = e.target.checked; saveProfile(); if (PROFILE.sound) sfx('unlock'); };
$id('setSoundTest').onclick = () => { if (!PROFILE.sound) toast('Sound is off — switch it on first', 'warn'); sfx('level'); };
$id('setConfetti').onchange = e => { PROFILE.confetti = e.target.checked; saveProfile(); confetti(80); };
$id('setAuto').onchange = e => { PROFILE.autocomplete = e.target.checked; saveProfile(); };
$id('setAiAuto').onchange = e => { PROFILE.aiAuto = e.target.checked; saveProfile(); };
$id('setTheme').querySelectorAll('button').forEach(b => b.onclick = () => applyTheme(b.dataset.theme));
$id('setExport').onclick = exportProgress;
$id('setReplay').onclick = openOnboarding;
$id('setReset').onclick = async () => { await resetProgress(); renderSettings(); };
$id('setLogout').onclick = logout;
$id('setNav').querySelectorAll('a').forEach(a => a.onclick = e => {
  e.preventDefault();
  $id(a.dataset.to).scrollIntoView({ behavior:'smooth', block:'start' });
});
document.querySelectorAll('#descTabs .tab').forEach(t => t.onclick = () => setTab(t.dataset.tab));
document.querySelectorAll('#diffFilter .fchip').forEach(b => b.onclick = () => {
  planFilter = b.dataset.f;
  document.querySelectorAll('#diffFilter .fchip').forEach(x => x.classList.toggle('active', x === b));
  renderPlan();
});
document.getElementById('q').oninput = renderList;
