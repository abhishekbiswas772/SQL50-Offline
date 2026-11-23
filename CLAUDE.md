# SQL50 — LeetCode-style SQL practice

Trainer for LeetCode's **Top SQL 50** study plan. FastAPI + Jinja web UI lists the 50 problems, shows each
problem's sample tables, runs your SQL against a real PostgreSQL 18 database (Neon), checks your result against
the problem's Example 1 output, gives AI hints (never the solution), and saves progress in the same database.
Study-plan dashboard, points, achievements and the Arena (20 contests, a contest per section, a speed run per
section; `contest.js`, results in the `game` blob: `contests`, `speed`, `arena` = live run) run in the client;
state persists in the DB. During a run the editor starts blank and editorial/solutions/submissions/hints are locked.

## Run

```
pip install -r requirements.txt
python server.py          # or double-click start.bat; opens http://127.0.0.1:8000/
```

All config is in `.env` (never commit it; template: `.env.example`). Required: `DATABASE_URL` (Neon) and
`SQL50_PSQL` (path to the `psql` client; use forward slashes on Windows, dotenv expands backslashes).
Env: `SQL50_PORT`, `SQL50_NO_BROWSER=1`.

## Layout

| Path | Purpose |
|------|---------|
| `server.py` | Launcher: uvicorn `app.main:app` on 127.0.0.1, opens the browser. |
| `app/main.py` | FastAPI routes + local-only guard middleware + lifespan (connect, create tables). |
| `app/db.py` | Runs SQL by shelling to `psql --csv` (no driver). Neon only; `-pooler` host swapped for unpooled. |
| `app/ai.py` | AI hint tutor: Gemini REST or Ollama, system prompt forbids full solutions + regex backstop. |
| `app/storage.py` | Reads `data/*` from Neon object storage (S3, key prefix `data/`), local `data/` fallback. |
| `app/templates/` | `base.html`, `index.html`, `partials/*.html` (nav, list, workspace, plan, home, arena, settings, login, modals). |
| `app/static/css/app.css` | All styles (theme tokens on `:root` / `[data-theme=light]`). |
| `app/static/js/` | Classic scripts sharing globals, load order matters: core, game, problems, editor, hints, actions, contest, profile, app. |
| `app/static/vendor/` | CodeMirror 5.65.18 (sql mode, show-hint, closebrackets, matchbrackets, comment, sublime keymap) + sql-formatter 15. Vendored, no CDN. |
| `data/` | `sql50.sql` (schema + sample data + catalog), `solutions.json`, `problems/*.md`. |
| `scripts/scrape.py` | Pull problems from LeetCode GraphQL, convert MySQL→Postgres, write `data/`. |
| `scripts/seed_db.py` | (Re)load `sql50.sql` into Neon (keeps progress/app_state). ~3 min. |
| `scripts/sync_data.py` | Upload `data/` to the object storage bucket. |
| `tests/test_ui.py` | Playwright end-to-end test. |

## Database (Neon)

- Each problem lives in its **own schema** `q<leetcode_id>` (e.g. `q1757`); table names collide across problems.
- `public.problems(seq, id, title, difficulty, topic, schema_name, url, description)` — catalog.
- `public.progress(problem_id, status, solution, updated)`; `status` ∈ {`todo`, `attempted`, `solved`}.
- `public.app_state(key, value jsonb)` keys `profile`, `game`. localStorage `sql50-profile`/`sql50-game` is a cache; DB wins.
- `public.sql50_sample(schema) → json`: all tables of a problem + first 100 rows, so opening a problem is one round trip.
- `progress`, `app_state`, `sql50_sample` are created by `ensure_tables()` on startup.
- Every psql call to Neon costs ~1.5–2 s (TLS); keep endpoints to one call.

## AI hints

`POST /api/hint {id, sql, error?, actual?, expected?, messages}`. Provider: `AI_PROVIDER` (gemini|ollama; default
gemini when `GEMINI_API_KEY` set). `GEMINI_MODEL` is a comma list tried in order on 429/5xx/404
(default `gemini-3.5-flash,gemini-flash-latest`). Ollama: `OLLAMA_URL`, `OLLAMA_MODEL` (default first pulled model).
The reference solution is never sent to the model. A failed Run/Check auto-requests a hint (Settings toggle
`aiAuto`); chat per problem is cached in localStorage `sql50-chats`.

## API

| Endpoint | Purpose |
|----------|---------|
| `GET /api/problems` | Catalog + status. |
| `GET /api/problem?id=N` | Description, sample tables, saved solution, status, updated. |
| `GET /api/solution?id=N` | Reference SQL + note from `solutions.json`. |
| `GET /api/export` | Progress/solution export. |
| `POST /api/run` | Run a statement (writes really execute). |
| `POST /api/check` | `BEGIN; <sql>; [table snapshot]; ROLLBACK;` — never mutates data. |
| `POST /api/progress` | Save status + last solution. |
| `POST /api/reset-progress` | Delete progress rows + `game` state. |
| `GET/POST /api/state` | Read all / upsert one profile or game blob. |
| `POST /api/hint` | AI hint (see above). |

Checker compares with the first Example output parsed from the description. Write problems 196 and 1667 compare
table state. `CHECK_FIXES` in `app/static/js/core.js` normalizes the 1484 fixture typo (`T-shirt` vs `T-Shirt`).

## Test

```
python tests/test_ui.py   # spawns server on 8020 headless; stubs /api/hint; asserts PASS
```
Runs against the real Neon DB: deletes progress for 1757 and backs up `app_state` to `app_state_testbak`, restoring after.

## Conventions

- Query via `psql` only; keep `app/db.py` driver-free. Endpoints are plain `def` (psql blocks; FastAPI threadpool).
- No CDN: new front-end libs go in `app/static/vendor/`.
- Never cut security at the trust boundary: `/api/run` executes arbitrary SQL as the Neon owner role, so keep
  the local-only middleware in `app/main.py` (Host must be 127.0.0.1/localhost:PORT, JSON Content-Type) and
  never publish the port beyond 127.0.0.1. Any server started for testing must set `SQL50_NO_BROWSER=1`.
- Secrets live only in `.env` (gitignored).

## Assistant instructions (this project)

Every session, before writing or changing code, invoke these skills and follow them:
- `ponytail:ponytail` — smallest change that fully solves the task; no speculative code.
- `caveman:caveman` — terse replies in chat (never changes code, comments, or docs).
- `andrej-karpathy-skills:karpathy-guidelines` — think before coding, surgical changes, verifiable success criteria.
