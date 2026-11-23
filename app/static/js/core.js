let cur = null, curSchema = null, items = [];
let curProblem = null, curParsed = null, curExpected = null;
let curMeta = { status:'todo', updated:'' }, curSavedSolution = '', curRef = null;
let curTab = 'description', curExampleIdx = 0;
let planFilter = 'all', checking = false;

const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));

const WRITE_IDS = new Set([196, 1667]);
const CHECK_FIXES = { 1484: v => v.replaceAll('T-shirt', 'T-Shirt') };
const DIFF_POINTS = { Easy:10, Medium:20, Hard:30 };
const TOPIC_GUIDES = {
  'Select': 'Read the filter conditions literally. Most of these are one WHERE clause with AND/OR, NULL checks, or simple string/date comparisons. Watch for NULL never matching !=.',
  'Basic Joins': 'Decide which table must keep all its rows (LEFT JOIN) and which is only consulted for matches. Join on the shared key, then aggregate or filter the joined columns.',
  'Basic Aggregate Functions': 'Group by the entity you report (user, product, month). Use COUNT/SUM/AVG with CASE for conditional totals. Cast to numeric before division and ROUND only at the end.',
  'Sorting and Grouping': 'GROUP BY builds one row per key; HAVING filters groups, WHERE filters rows. Use MIN/MAX subqueries or window functions to pick the first/latest row per key.',
  'Advanced Select and Joins': 'These mix self-joins, window functions, and CASE pivots. Build a running total or rank in a subquery, then filter the result. CASE can turn one table into several output buckets.',
  'Subqueries': 'Express the question in two steps: an inner query finds the key set (top N, duplicates, unique locations), the outer query reads rows that pass it. Correlated subqueries can count competitors per row.',
  'Advanced String Functions / Regex / Clause': 'Use PostgreSQL string tools: LOWER/UPPER/LEFT/SUBSTRING, STRING_AGG with ORDER BY, LIKE patterns, and regular expressions. UPDATE/DELETE problems expect a write statement.'
};
// goal may be a number or a function of the stats; v() is current progress toward it
const ACHIEVEMENTS = [
  { id:'first', icon:'⚡', name:'First Blood', desc:'Solve your first problem', goal:1, v:s => s.solved },
  { id:'five', icon:'🔥', name:'Warming Up', desc:'Solve 5 problems', goal:5, v:s => s.solved },
  { id:'ten', icon:'🔟', name:'Double Digits', desc:'Solve 10 problems', goal:10, v:s => s.solved },
  { id:'half', icon:'🎯', name:'Halfway', desc:'Solve 25 problems', goal:25, v:s => s.solved },
  { id:'forty', icon:'🏔️', name:'Almost There', desc:'Solve 40 problems', goal:40, v:s => s.solved },
  { id:'all', icon:'👑', name:'SQL 50', desc:'Solve every problem in the plan', goal:s => s.total, v:s => s.solved },
  { id:'easy', icon:'🌱', name:'Easy Peasy', desc:'Solve every Easy problem', goal:s => s.diff.Easy[1], v:s => s.diff.Easy[0] },
  { id:'med', icon:'⚖️', name:'Middle Path', desc:'Solve 10 Medium problems', goal:10, v:s => s.diff.Medium[0] },
  { id:'hard', icon:'💎', name:'Hard Hitter', desc:'Solve a Hard problem', goal:1, v:s => s.diff.Hard[0] },
  { id:'medall', icon:'🗿', name:'Medium Rare', desc:'Solve every Medium problem', goal:s => s.diff.Medium[1], v:s => s.diff.Medium[0] },
  { id:'topic', icon:'📚', name:'Topic Master', desc:'Finish every problem in one topic', goal:1, v:s => s.topicsDone },
  { id:'topic3', icon:'🧭', name:'Polymath', desc:'Finish 3 whole topics', goal:3, v:s => s.topicsDone },
  { id:'sharp', icon:'🏹', name:'Sharpshooter', desc:'Get Accepted on your first Check', goal:1, v:s => s.firstTry },
  { id:'sniper', icon:'🔭', name:'Sniper', desc:'10 first-try Accepted solves', goal:10, v:s => s.firstTry },
  { id:'streak3', icon:'📅', name:'On a Roll', desc:'Practice 3 days in a row', goal:3, v:s => s.best },
  { id:'streak7', icon:'🌋', name:'Unstoppable', desc:'Practice 7 days in a row', goal:7, v:s => s.best },
  { id:'daily', icon:'☀️', name:'Daily Grinder', desc:'Complete a daily challenge', goal:1, v:s => s.dailyDone },
  { id:'daily5', icon:'🗓️', name:'Creature of Habit', desc:'Complete 5 daily challenges', goal:5, v:s => s.dailyDone },
  { id:'goal', icon:'🥅', name:'Goal Getter', desc:'Hit your daily goal', goal:1, v:s => s.goalDays },
  { id:'night', icon:'🦉', name:'Night Owl', desc:'Solve a problem between midnight and 5 AM', goal:1, v:s => s.night },
  { id:'early', icon:'🐦', name:'Early Bird', desc:'Solve a problem between 5 and 8 AM', goal:1, v:s => s.early },
  { id:'runs', icon:'⚙️', name:'Query Machine', desc:'Run 100 queries', goal:100, v:s => s.runs },
  { id:'neat', icon:'🧹', name:'Neat Freak', desc:'Format your SQL 10 times', goal:10, v:s => s.formats },
  { id:'writer', icon:'✍️', name:'Data Mutator', desc:'Solve an UPDATE / DELETE problem', goal:1, v:s => s.writes },
  { id:'lvl5', icon:'🚀', name:'Rising Star', desc:'Reach level 5', goal:5, v:s => s.level },
  { id:'lvl10', icon:'🌟', name:'SQL Legend', desc:'Reach level 10', goal:10, v:s => s.level },
  // arena (contests / section contests / speed runs)
  { id:'c1', arena:true, icon:'🎟️', name:'Contender', desc:'Solve a problem in a contest', goal:1, v:s => s.cDone },
  { id:'cace', arena:true, icon:'🏅', name:'Clean Sweep', desc:'Solve every problem in a contest', goal:1, v:s => s.cAced },
  { id:'cperfect', arena:true, icon:'💯', name:'Flawless', desc:'Earn 3 stars in a contest', goal:1, v:s => s.cPerfect },
  { id:'c5', arena:true, icon:'🗓️', name:'Contest Regular', desc:'Complete 5 different contests', goal:5, v:s => s.cDone },
  { id:'c10', arena:true, icon:'⚔️', name:'Veteran', desc:'Complete 10 different contests', goal:10, v:s => s.cDone },
  { id:'c20', arena:true, icon:'🏟️', name:'Grand Tour', desc:'Complete all 20 contests', goal:20, v:s => s.cDone },
  { id:'cstar30', arena:true, icon:'⭐', name:'Star Collector', desc:'Collect 30 contest stars', goal:30, v:s => s.cStars },
  { id:'cstar60', arena:true, icon:'🌠', name:'Contest Legend', desc:'Collect all 60 contest stars', goal:60, v:s => s.cStars },
  { id:'sec1', arena:true, icon:'🧩', name:'Section Champion', desc:'Sweep a section contest', goal:1, v:s => s.secAced },
  { id:'secall', arena:true, icon:'🗺️', name:'Section Conqueror', desc:'Sweep every section contest', goal:s => s.byTopic.size, v:s => s.secAced },
  { id:'sp1', arena:true, icon:'⏱️', name:'Speedster', desc:'Finish a speed run', goal:1, v:s => s.spDone },
  { id:'spgold', arena:true, icon:'🥇', name:'Gold Rush', desc:'Win a gold medal in a speed run', goal:1, v:s => s.spGold },
  { id:'spall', arena:true, icon:'🏎️', name:'Speed Demon', desc:'Finish a speed run in every section', goal:s => s.byTopic.size, v:s => s.spDone },
  { id:'spgoldall', arena:true, icon:'👑', name:'Golden Sweep', desc:'Gold medal in every section', goal:s => s.byTopic.size, v:s => s.spGold },
  { id:'blitz', arena:true, icon:'⚡', name:'Blitz', desc:'Clear an arena problem within 60 seconds', goal:1, v:s => s.blitz }
];
const achGoal = (a, s) => typeof a.goal === 'function' ? a.goal(s) : a.goal;

/* ---------- profile + game state (localStorage; progress itself stays in PostgreSQL) ---------- */
const AVATARS = ['🦊','🐼','🐯','🦉','🐙','🐧','🦄','🐲','🐸','🐨','🚀','🧠'];
const LEVEL_TITLES = ['Novice','Apprentice','Query Cadet','Join Journeyman','Aggregator','Subquery Sage',
  'Window Wizard','Index Knight','Data Architect','SQL Legend'];
const BONUS = { firstTry:5, daily:15 };
const PROFILE_DEFAULT = { name:'', avatar:'🦊', goal:3, onboarded:false,
  sound:true, confetti:true, autocomplete:true, aiAuto:true, fontSize:14, since:'' };
const GAME_DEFAULT = () => ({ runs:0, checks:0, checksOk:0, formats:0, firstTry:0, bonus:0, night:0, early:0,
  days:{}, daily:{}, dailyPick:null, fails:{}, unlocked:{}, feed:[], level:0, lastOpen:null,
  contests:{}, speed:{}, arena:null, blitz:0 });
function loadJSON(k, d) {
  try { const v = JSON.parse(localStorage.getItem(k)); return v && typeof v === 'object' ? { ...d, ...v } : d; }
  catch (e) { return d; }
}
function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
let PROFILE = loadJSON('sql50-profile', { ...PROFILE_DEFAULT });
let G = loadJSON('sql50-game', GAME_DEFAULT());
let gameReady = false, achFilter = 'all', USER = null, booted = false;
// a 401 from the API means the session ended: back to the sign-in screen
const _fetch = window.fetch.bind(window);
window.fetch = async (url, opts) => {
  const r = await _fetch(url, opts);
  if (r.status === 401 && booted && String(url).startsWith('/api/') && !String(url).startsWith('/api/auth/')) showLogin();
  return r;
};
const justUnlocked = new Set();
// PostgreSQL (public.app_state) is the source of truth; localStorage is only a cache.
const pushTimers = {};
function pushState(key, value, now) {
  clearTimeout(pushTimers[key]);
  const send = () => { delete pushTimers[key]; fetch('/api/state', { method:'POST', keepalive:true,
    headers:{'Content-Type':'application/json'}, body:JSON.stringify({ key, value }) }).catch(() => {}); };
  if (now) send(); else pushTimers[key] = setTimeout(send, 400);   // debounce bursts of runs/checks
}
const saveProfile = () => { saveJSON('sql50-profile', PROFILE); pushState('profile', PROFILE); };
const saveGame = () => { saveJSON('sql50-game', G); pushState('game', G); };
addEventListener('pagehide', () => {
  if (pushTimers.profile) pushState('profile', PROFILE, true);
  if (pushTimers.game) pushState('game', G, true);
});
async function loadState() {
  try {
    const r = await (await fetch('/api/state')).json();
    if (r.error) return;
    if (r.profile) { PROFILE = { ...PROFILE_DEFAULT, ...r.profile }; saveJSON('sql50-profile', PROFILE); }
    else if (PROFILE.name) pushState('profile', PROFILE, true);   // migrate an older browser-only profile
    if (r.game) { G = { ...GAME_DEFAULT(), ...r.game }; saveJSON('sql50-game', G); }
    else if (Object.keys(G.unlocked).length || G.runs) pushState('game', G, true);
  } catch (e) {}   // server unreachable: keep the cached copy
}
const dayKey = (d = new Date()) => d.toLocaleDateString('en-CA');   // local YYYY-MM-DD
function bumpDay(field) {
  const k = dayKey(), d = G.days[k] || (G.days[k] = { a:0, s:0 });
  d[field]++;
}
function pushFeed(icon, text) {
  G.feed.unshift({ t:Date.now(), icon, text });
  G.feed.length = Math.min(G.feed.length, 30);
}
function streakInfo() {
  const active = k => { const d = G.days[k]; return !!(d && (d.a || d.s)); };
  const day = new Date();
  if (!active(dayKey(day))) day.setDate(day.getDate() - 1);   // today not yet practiced: streak still alive
  let cur = 0;
  while (active(dayKey(day))) { cur++; day.setDate(day.getDate() - 1); }
  let best = 0, run = 0, prev = null;
  Object.keys(G.days).filter(active).sort().forEach(k => {
    const t = new Date(k + 'T00:00');
    run = prev && Math.round((t - prev) / 864e5) === 1 ? run + 1 : 1;
    best = Math.max(best, run); prev = t;
  });
  return { cur, best:Math.max(best, cur) };
}
function dailyProblem() {
  if (!items.length) return null;
  const k = dayKey();
  if (!G.dailyPick || G.dailyPick.date !== k || !items.some(p => p.id === G.dailyPick.id)) {
    let h = 0;
    for (const c of k) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const pool = items.filter(p => p.status !== 'solved');
    const list = pool.length ? pool : items;
    G.dailyPick = { date:k, id:list[h % list.length].id };
    saveGame();
  }
  return items.find(p => p.id === G.dailyPick.id);
}

function calcPoints() {
  let pts = G.bonus || 0, solved = 0, attempted = 0, writes = 0;
  const byTopic = new Map(), diff = { Easy:[0, 0], Medium:[0, 0], Hard:[0, 0] };
  items.forEach(p => {
    const t = byTopic.get(p.topic) || { solved:0, total:0 };
    t.total++;
    if (diff[p.difficulty]) diff[p.difficulty][1]++;
    if (p.status === 'solved') {
      t.solved++; solved++; pts += DIFF_POINTS[p.difficulty] || 10;
      if (diff[p.difficulty]) diff[p.difficulty][0]++;
      if (WRITE_IDS.has(p.id)) writes++;
    } else if (p.status === 'attempted') {
      attempted++; pts += 2;
    }
    byTopic.set(p.topic, t);
  });
  const topics = [...byTopic.values()], st = streakInfo();
  const cs = Object.entries(G.contests), contests = cs.filter(([k]) => k[0] === 'c').map(([, v]) => v);
  const speeds = Object.values(G.speed);
  return { pts, solved, attempted, total:items.length, diff, byTopic, writes,
           hardSolved:diff.Hard[0], level:Math.floor(pts / 100) + 1,
           topicsDone:topics.filter(t => t.total > 0 && t.solved === t.total).length,
           streak:st.cur, best:st.best, firstTry:G.firstTry, runs:G.runs, formats:G.formats,
           night:G.night, early:G.early, dailyDone:Object.keys(G.daily).length,
           goalDays:Object.values(G.days).filter(d => d.s >= PROFILE.goal).length,
           cDone:contests.filter(v => v.solved).length, cAced:contests.filter(v => v.solved && v.solved === v.n).length,
           cPerfect:cs.filter(([, v]) => v.stars === 3).length, cStars:contests.reduce((n, v) => n + (v.stars || 0), 0),
           secAced:cs.filter(([k, v]) => k[0] === 's' && v.solved && v.solved === v.n).length,
           spDone:speeds.filter(v => v.best).length, spGold:speeds.filter(v => v.medal === 3).length, blitz:G.blitz || 0 };
}
