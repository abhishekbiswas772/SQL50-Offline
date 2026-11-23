"""FastAPI app: serves the Jinja UI and the JSON API. Endpoints are plain `def` because psql
runs as a blocking subprocess (FastAPI runs them in its threadpool)."""
import json, os, re
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from fastapi import Body, FastAPI, Request
from fastapi.responses import JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")  # before app imports: db reads SQL50_PSQL at import

from . import ai, db, storage  # noqa: E402
from .db import csv_to_grid, parse_sample, psql, q  # noqa: E402
PORT = int(os.environ.get("SQL50_PORT", 8000))
STATUSES = {"todo", "attempted", "solved"}
STATE_KEYS = {"profile", "game"}  # client-side profile + gamification blobs persisted as jsonb
SOLUTIONS = json.loads(storage.read_text("solutions.json")[0])  # object storage, local data/ fallback; cached once
IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_$]*$")
HERE = Path(__file__).parent

@asynccontextmanager
async def lifespan(_):
    print("database:", db.connect())
    db.ensure_tables()
    yield


app = FastAPI(title="SQL50", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
app.mount("/static", StaticFiles(directory=HERE / "static"), name="static")
templates = Jinja2Templates(directory=HERE / "templates")


@app.middleware("http")
async def local_only(request: Request, call_next):
    # local-only guard: block cross-site POSTs (superuser DB access). Requiring an
    # application/json Content-Type forces a CORS preflight the server never answers,
    # and the Host check stops DNS-rebinding.
    if request.method != "GET" and (
            request.headers.get("host") not in (f"127.0.0.1:{PORT}", f"localhost:{PORT}")
            or not request.headers.get("content-type", "").startswith("application/json")):
        return PlainTextResponse("forbidden", 403)
    return await call_next(request)


@app.get("/")
def index(request: Request):
    return templates.TemplateResponse(request, "index.html")


@app.get("/api/problems")
def problems():
    ok, t = psql("SELECT p.seq,p.id,p.title,p.difficulty,p.topic,p.schema_name,"
                 "COALESCE(g.status,'todo') FROM public.problems p "
                 "LEFT JOIN public.progress g ON g.problem_id=p.id ORDER BY p.seq;")
    keys = ["seq", "id", "title", "difficulty", "topic", "schema_name", "status"]
    return [dict(zip(keys, r)) for r in csv_to_grid(t)["rows"]] if ok else []


@app.get("/api/state")
def get_state():
    ok, t = psql("SELECT key, value::text FROM public.app_state;")
    if not ok:
        return JSONResponse({"error": t}, 500)
    return {k: json.loads(v) for k, v in csv_to_grid(t)["rows"]}


@app.get("/api/solution")
def solution(id: str):
    rec = SOLUTIONS.get(id)
    if not rec:
        return JSONResponse({"error": "not found"}, 404)
    return {"solution": "\n".join(rec.get("solution") or []), "note": rec.get("note", "")}


@app.get("/api/export")
def export():
    ok, t = psql("SELECT p.seq,p.id,p.title,p.difficulty,p.topic,"
                 "COALESCE(g.status,'todo'),COALESCE(g.solution,''),"
                 "COALESCE(g.updated::text,'') FROM public.problems p "
                 "LEFT JOIN public.progress g ON g.problem_id=p.id ORDER BY p.seq;")
    if not ok:
        return JSONResponse({"error": t}, 500)
    keys = ["seq", "id", "title", "difficulty", "topic", "status", "solution", "updated"]
    return {"app": "SQL50", "exported_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "problems": [dict(zip(keys, r)) for r in csv_to_grid(t)["rows"]]}


def _problem_row(pid):
    ok, t = psql("SELECT p.schema_name,p.description,COALESCE(g.status,'todo'),"
                 "COALESCE(g.updated::text,''),p.title,COALESCE(g.solution,''),"
                 "public.sql50_sample(p.schema_name)::text FROM public.problems p "
                 "LEFT JOIN public.progress g ON g.problem_id=p.id WHERE p.id=%d;" % pid)
    rows = csv_to_grid(t)["rows"] if ok else []
    return rows[0] if rows else None


@app.get("/api/problem")
def problem(id: int):
    row = _problem_row(id)
    if not row:
        return JSONResponse({"error": "not found"}, 404)
    schema, desc, status, updated, _, sol, sample = row
    return {"schema": schema, "description": desc, "tables": parse_sample(sample),
            "solution": sol, "status": status, "updated": updated}


@app.post("/api/run")
def run(body: dict = Body(...)):
    ok, t = psql(body["sql"], schema=body["schema"])
    if not ok:
        return {"ok": False, "error": t}
    # non-SELECT psql prints a command tag like "INSERT 0 1", "UPDATE 3", "SET"
    if re.fullmatch(r"[A-Z]+( \d+)*", t):
        return {"ok": True, "message": t}
    return {"ok": True, "result": csv_to_grid(t)}


@app.post("/api/check")
def check(body: dict = Body(...)):
    sql = (body.get("sql") or "").strip()
    table, cols = body.get("table") or "", body.get("columns") or []
    if not sql:
        return JSONResponse({"ok": False, "error": "empty sql"}, 400)
    if (table and not IDENT.fullmatch(str(table))) or not all(IDENT.fullmatch(str(c)) for c in cols):
        return JSONResponse({"ok": False, "error": "bad table/columns"}, 400)
    script = "BEGIN;\n" + sql.rstrip(";").rstrip() + ";\n"
    if table and cols:
        script += "SELECT %s FROM \"%s\";\n" % (",".join('"%s"' % c for c in cols), table)
    ok, t = psql(script + "ROLLBACK;", schema=body.get("schema") or None, quiet=True)
    if not ok:
        return {"ok": False, "error": t}
    return {"ok": True, "result": csv_to_grid(t)}


@app.post("/api/reset-progress")
def reset_progress(body: dict = Body(default={})):
    ok, t = psql("DELETE FROM public.progress; DELETE FROM public.app_state WHERE key='game';", csv=False)
    return {"ok": ok, "error": None if ok else t}


@app.post("/api/state")
def set_state(body: dict = Body(...)):
    key, value = body.get("key"), body.get("value")
    if key not in STATE_KEYS or not isinstance(value, dict):
        return JSONResponse({"ok": False, "error": "bad state"}, 400)
    ok, t = psql("INSERT INTO public.app_state(key,value,updated) VALUES(%s,%s::jsonb,now()) "
                 "ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated=now();"
                 % (q(key), q(json.dumps(value))), csv=False)
    return {"ok": ok, "error": None if ok else t}


@app.post("/api/progress")
def progress(body: dict = Body(...)):
    pid, status, sol = int(body["id"]), body["status"], body.get("solution", "")
    if status not in STATUSES:
        return JSONResponse({"ok": False, "error": "bad status"}, 400)
    ok, t = psql("INSERT INTO public.progress(problem_id,status,solution,updated) "
                 "VALUES(%d,%s,%s,now()) ON CONFLICT(problem_id) DO UPDATE SET "
                 "status=EXCLUDED.status,solution=EXCLUDED.solution,updated=now();"
                 % (pid, q(status), q(sol)), csv=False)
    return {"ok": ok, "error": None if ok else t}


@app.post("/api/hint")
def hint(body: dict = Body(...)):
    """AI tutor. body: {id, sql, error?, actual?, expected?, messages:[{role,text}]}."""
    row = _problem_row(int(body.get("id") or 0))
    if not row:
        return JSONResponse({"ok": False, "error": "unknown problem"}, 404)
    _, desc, _, _, title, _, sample = row
    context = ai.build_context(title, desc, parse_sample(sample), body)
    try:
        reply, prov, model = ai.hint(context, body.get("messages") or [])
    except Exception as e:  # network / provider errors go to the UI as text
        return {"ok": False, "error": f"AI unavailable: {e}"}
    return {"ok": True, "reply": reply, "provider": prov, "model": model}
