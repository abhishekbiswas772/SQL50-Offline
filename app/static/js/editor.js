function setStatus(t) { document.getElementById('status').textContent = t; }

/* ---------- SQL editor: CodeMirror 5 (vendored in /static/vendor, works offline) ---------- */
const SQL_KEYWORDS = ('SELECT FROM WHERE GROUP BY ORDER HAVING LIMIT OFFSET JOIN INNER LEFT RIGHT FULL OUTER CROSS ' +
  'ON USING AS AND OR NOT NULL IS IN BETWEEN LIKE ILIKE EXISTS CASE WHEN THEN ELSE END DISTINCT UNION ALL ANY SOME ' +
  'WITH RECURSIVE OVER PARTITION ROWS RANGE UNBOUNDED PRECEDING FOLLOWING CURRENT ROW ASC DESC INTO VALUES SET ' +
  'UPDATE DELETE INSERT RETURNING TRUE FALSE INTERVAL NULLS FIRST LAST FILTER').split(' ');
const SQL_FUNCTIONS = ('COUNT SUM AVG MIN MAX ROUND COALESCE NULLIF GREATEST LEAST ABS CEIL FLOOR MOD POWER SQRT ' +
  'LENGTH LOWER UPPER TRIM LTRIM RTRIM CONCAT SUBSTRING REPLACE REGEXP_REPLACE CAST TO_CHAR DATE_TRUNC DATE_PART ' +
  'EXTRACT NOW CURRENT_DATE CURRENT_TIMESTAMP TO_DATE ROW_NUMBER RANK DENSE_RANK LAG LEAD NTILE FIRST_VALUE ' +
  'LAST_VALUE NTH_VALUE STRING_AGG ARRAY_AGG LEFT RIGHT POSITION SPLIT_PART').split(' ');
const KIND_ICON = { column:'C', table:'T', keyword:'K', function:'ƒ', alias:'A' };
const CLAUSE_WORDS = new Set(['where','group','order','having','limit','offset','join','inner','left','right','full',
  'outer','cross','using','union','window','fetch','returning','set','values','and','or','on']);

let curTables = [];
const cm = CodeMirror.fromTextArea(document.getElementById('editor'), {
  mode:'text/x-pgsql', keyMap:'sublime', lineNumbers:true, indentUnit:2, tabSize:2, indentWithTabs:false,
  matchBrackets:true, autoCloseBrackets:"()[]''\"\"", styleActiveLine:true, lineWiseCopyCut:true,
  extraKeys:{
    'Ctrl-Enter': () => run(), 'Cmd-Enter': () => run(),
    'Shift-Ctrl-Enter': () => check(), 'Shift-Cmd-Enter': () => check(),
    'Shift-Ctrl-F': () => formatEditor(), 'Shift-Alt-F': () => formatEditor(),
    'Ctrl-Space': c => c.showHint({ completeSingle:false }),
    'Alt-Up': 'swapLineUp', 'Alt-Down': 'swapLineDown',        // VS Code keys on top of the Sublime keymap
    'Shift-Alt-Up': 'duplicateLine', 'Shift-Alt-Down': 'duplicateLine',
    'Shift-Ctrl-K': deleteLines, 'Shift-Cmd-K': deleteLines,
    'Ctrl-/': c => c.toggleComment({ indent:true }), 'Cmd-/': c => c.toggleComment({ indent:true }),
    Tab: c => c.somethingSelected() ? c.execCommand('indentMore') : c.replaceSelection('  '),
    'Shift-Tab': 'indentLess',
    Esc: c => { if (c.state.completionActive) c.state.completionActive.close(); else c.getInputField().blur(); },
  },
  hintOptions:{ hint:sqlHint, completeSingle:false, closeCharacters:/[\s()\[\]{};:>,=<+\-*\/]/ },
});

// Ctrl+Shift+K like VS Code: on the last line also eat the newline before it (CodeMirror leaves an empty line)
function deleteLines(c) {
  const from = c.getCursor('from').line, to = c.getCursor('to').line, P = CodeMirror.Pos;
  if (to < c.lastLine()) c.replaceRange('', P(from, 0), P(to + 1, 0), '+delete');
  else if (from > 0) c.replaceRange('', P(from - 1, c.getLine(from - 1).length), P(to), '+delete');
  else c.replaceRange('', P(0, 0), P(to), '+delete');
}

// tables referenced as FROM/JOIN/UPDATE/INTO <table> [AS] <alias> in the current text
function referencedTables() {
  const re = /\b(?:from|join|update|into)\s+("?[A-Za-z_][\w$]*"?)(?:\s+(?:as\s+)?([A-Za-z_][\w$]*))?/gi;
  const out = []; let m;
  while ((m = re.exec(cm.getValue()))) {
    const t = curTables.find(x => x.name.toLowerCase() === m[1].replace(/"/g, '').toLowerCase());
    if (!t) continue;
    const al = m[2] && !CLAUSE_WORDS.has(m[2].toLowerCase()) ? m[2] : null;
    out.push({ table:t, alias:al });
  }
  return out;
}

function hintItem(label, kind, detail) {
  return { text:label, kind, detail,
    render(el, data) {
      const p = data.partial || '', i = p ? label.toLowerCase().indexOf(p.toLowerCase()) : -1;
      el.innerHTML = `<span class="sg-k ${kind}">${KIND_ICON[kind] || '·'}</span><span class="sg-l">${i < 0 ? esc(label)
        : esc(label.slice(0, i)) + '<b>' + esc(label.slice(i, i + p.length)) + '</b>' + esc(label.slice(i + p.length))}</span>`
        + (detail ? `<span class="sg-d">${esc(detail)}</span>` : '');
    } };
}

function sqlHint(c) {
  const pos = c.getCursor(), tok = c.getTokenAt(pos);
  if (cur === null || /string|comment/.test(tok.type || '')) return null;
  const before = c.getLine(pos.line).slice(0, pos.ch);
  const refs = referencedTables();
  const dotted = /([A-Za-z_][\w$]*)\.([\w$]*)$/.exec(before);
  let pool, partial;
  if (dotted) {
    partial = dotted[2];
    const q = dotted[1].toLowerCase();
    const hit = refs.find(r => (r.alias || '').toLowerCase() === q) || refs.find(r => r.table.name.toLowerCase() === q)
      || { table:curTables.find(t => t.name.toLowerCase() === q) };
    if (!hit.table) return null;
    pool = hit.table.columns.map(col => hintItem(col, 'column', hit.table.name));
  } else {
    partial = (/[A-Za-z_][\w$]*$/.exec(before) || [''])[0];
    const scope = refs.length ? [...new Set(refs.map(r => r.table))] : curTables;
    const cols = scope.flatMap(t => t.columns.map(col => hintItem(col, 'column', t.name)));
    const tabs = curTables.map(t => hintItem(t.name, 'table', 'table'));
    const als = refs.filter(r => r.alias).map(r => hintItem(r.alias, 'alias', r.table.name));
    const kws = SQL_KEYWORDS.map(k => hintItem(k, 'keyword')).concat(SQL_FUNCTIONS.map(k => hintItem(k, 'function')));
    const m = before.match(/\b(from|join|update|into|select|where|group|order|having|on|set)\b/gi);
    const clause = m ? m[m.length - 1].toLowerCase() : '';
    pool = ['from','join','update','into'].includes(clause) ? [...tabs, ...cols, ...als, ...kws] : [...cols, ...als, ...tabs, ...kws];
  }
  const p = partial.toLowerCase(), seen = new Set(), list = [];
  pool.map(it => { const l = it.text.toLowerCase(); return [!p ? 0 : l.startsWith(p) ? 1 : l.includes(p) ? 2 : 9, it]; })
    .filter(([s]) => s < 9).sort((a, b) => a[0] - b[0])
    .forEach(([, it]) => { const k = it.text.toLowerCase(); if (!seen.has(k) && list.length < 30) { seen.add(k); list.push(it); } });
  if (!list.length || (list.length === 1 && list[0].text.toLowerCase() === p && !dotted)) return null;
  return { list, from:CodeMirror.Pos(pos.line, pos.ch - partial.length), to:pos, partial };
}

cm.on('inputRead', (c, ch) => {
  if (!PROFILE.autocomplete || cur === null || c.state.completionActive) return;
  if (/^[\w.$]$/.test(ch.text.join(''))) c.showHint({ completeSingle:false });
});

/* ---------- formatter: sql-formatter (vendored) ---------- */
function basicSqlError(sql) {
  let inStr = false, depth = 0;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (inStr) {
      if (c === "'") {
        if (sql[i + 1] === "'") { i++; continue; }
        inStr = false;
      }
      continue;
    }
    if (c === "'") { inStr = true; continue; }
    if (c === '-' && sql[i + 1] === '-') {
      const j = sql.indexOf('\n', i);
      if (j < 0) break;
      i = j; continue;
    }
    if (c === '/' && sql[i + 1] === '*') {
      const j = sql.indexOf('*/', i + 2);
      if (j < 0) return 'Unterminated block comment.';
      i = j + 1; continue;
    }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth < 0) return 'Unmatched closing parenthesis.'; }
  }
  if (inStr) return "Unterminated string literal: missing closing quote.";
  if (depth > 0) return "Unclosed parenthesis: missing ')'.";
  return null;
}

function formatEditor() {
  const v = cm.getValue().trim();
  if (!v) return;
  const issue = basicSqlError(v);
  if (issue) return renderError(issue);
  let out;
  try {
    out = sqlFormatter.format(v, { language:'postgresql', keywordCase:'upper', functionCase:'upper',
      dataTypeCase:'upper', tabWidth:2, linesBetweenQueries:1 });
  } catch (e) { return renderError('Format failed: ' + e.message); }
  edSet(out);
  cm.setCursor(cm.lastLine());
  G.formats++; bumpDay('a'); updatePointsUI();
  setStatus('formatted ✓');
  setTimeout(() => { if (document.getElementById('status').textContent === 'formatted ✓') setStatus(''); }, 1600);
}

// replace the whole buffer as one undoable step (resetHistory: new problem, Ctrl+Z must not go back into the old one)
function edSet(text, resetHistory) {
  if (cm.getValue() !== text) cm.replaceRange(text, CodeMirror.Pos(cm.firstLine(), 0), CodeMirror.Pos(cm.lastLine()));
  if (resetHistory) cm.clearHistory();
  cm.focus();
}
