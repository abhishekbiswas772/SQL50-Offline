function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  try { localStorage.setItem('sql50-theme', theme); } catch (e) {}
  const b = document.getElementById('theme');
  if (b) {
    b.title = theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode';
    b.setAttribute('aria-label', b.title);
  }
  document.querySelectorAll('#setTheme button').forEach(x => x.classList.toggle('on', x.dataset.theme === theme));
}
document.getElementById('theme').onclick = () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  applyTheme(next);
  toast(next === 'light' ? 'Light mode on' : 'Dark mode on');
};
applyTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
// signup: {name, avatar} for the new account's profile
async function boot(signup) {
  booted = true;
  await loadState();   // before loadList so the first achievement sync sees the stored state
  if (signup) {
    PROFILE.name = signup.name; PROFILE.avatar = signup.avatar;
    if (!PROFILE.since) PROFILE.since = new Date().toISOString();
    saveProfile();
  }
  applyProfile();
  await loadList();
  lastSyncAt = Date.now();
  route();
  if (!PROFILE.onboarded) openOnboarding();
}
addEventListener('hashchange', () => { if (booted) route(); });
(async () => {
  let me = null;
  try { const r = await _fetch('/api/auth/me'); if (r.ok) me = (await r.json()).user; } catch (e) {}
  if (!me) return showLogin();
  adoptUser(me);
  boot();
})();
