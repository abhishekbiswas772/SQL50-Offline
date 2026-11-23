"""Postgres access by shelling out to psql --csv (no Python DB driver needed).

Database: Neon, from DATABASE_URL in .env. Neon's pooled host ("-pooler") rejects the search_path
startup option this module relies on, so the unpooled host is used; fine for a single-user tool.
"""
import csv, io, json, os, subprocess

PSQL = os.environ.get("SQL50_PSQL")  # client only; data lives in Neon
if not PSQL:
    raise ValueError("PSQL is missing")
_url = []


def connect():
    """Read DATABASE_URL once and check it answers. Returns the host it connected to."""
    url = (os.environ.get("DATABASE_URL") or "").strip()
    if not url:
        raise RuntimeError("DATABASE_URL is not set: add your Neon connection string to .env")
    _url[:] = [url.replace("-pooler.", ".")]
    ok, err = psql("SELECT 1;", csv=False)
    if not ok:
        raise RuntimeError("cannot reach the database: " + err)
    return _url[0].split("@", 1)[-1].split("/", 1)[0]  # host only; never log the password


def psql(sql, schema=None, csv=True, quiet=False):
    """Run SQL via psql. Returns (ok, text). text is CSV (or psql messages) / error."""
    env = {**os.environ, "PGCONNECT_TIMEOUT": "10"}
    if schema:
        env["PGOPTIONS"] = f"-c search_path={schema}"
    args = [PSQL, *_url, "-v", "ON_ERROR_STOP=1"]
    if quiet:
        args.append("-q")
    if csv:
        args.append("--csv")
    r = subprocess.run(args + ["-c", sql], capture_output=True, text=True, encoding="utf-8", env=env)
    return (r.returncode == 0, (r.stdout if r.returncode == 0 else (r.stderr or r.stdout)).strip())


def csv_to_grid(text):
    rows = list(csv.reader(io.StringIO(text)))
    if not rows:
        return {"columns": [], "rows": []}
    return {"columns": rows[0], "rows": rows[1:]}


def q(s):  # escape a string literal for SQL (local tool; doubling quotes is the standard escape)
    return "'" + s.replace("'", "''") + "'"


def ensure_tables():
    # sql50_sample(schema): every table of a problem schema with its first 100 rows, as one JSON value,
    # so opening a problem is one round trip (each psql call to Neon costs a TLS handshake).
    psql("CREATE TABLE IF NOT EXISTS public.progress ("
         "problem_id int PRIMARY KEY, status text NOT NULL DEFAULT 'todo',"
         " solution text, updated timestamptz DEFAULT now());"
         "CREATE TABLE IF NOT EXISTS public.app_state ("
         "key text PRIMARY KEY, value jsonb NOT NULL, updated timestamptz DEFAULT now());"
         """CREATE OR REPLACE FUNCTION public.sql50_sample(sch text) RETURNS json LANGUAGE plpgsql STABLE AS $f$
DECLARE r record; cols json; exprs text; rws json; res json[] := '{}';
BEGIN
  FOR r IN SELECT table_name FROM information_schema.tables WHERE table_schema = sch ORDER BY table_name LOOP
    SELECT json_agg(column_name ORDER BY ordinal_position),
           string_agg(format('s.%I::text', column_name), ',' ORDER BY ordinal_position)
      INTO cols, exprs FROM information_schema.columns WHERE table_schema = sch AND table_name = r.table_name;
    EXECUTE format('SELECT coalesce(json_agg(json_build_array(%s)), ''[]'') FROM (SELECT * FROM %I.%I LIMIT 100) s',
                   exprs, sch, r.table_name) INTO rws;
    res := res || json_build_object('name', r.table_name, 'columns', cols, 'rows', rws);
  END LOOP;
  RETURN array_to_json(res);
END $f$;""", csv=False)


def parse_sample(text):
    """sql50_sample() JSON -> [{name, columns, rows}] with NULL shown as '' (same as psql CSV)."""
    return [{**t, "rows": [["" if v is None else v for v in r] for r in t["rows"]]} for t in json.loads(text or "[]")]
