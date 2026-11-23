"""Mirror every row change in the local database to Neon (NEON_URL).

Row triggers on every table write a ready-to-run statement into sync.changes (rolled-back transactions,
e.g. /api/check, leave nothing). A worker thread replays the queue on Neon in order and deletes what it sent.
The queue survives restarts, so pgAdmin edits made while the app is down sync on next start.
Run standalone (no web app): python -m app.sync
"""
import os, subprocess, threading, time
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")  # standalone run: db reads SQL50_PSQL at import
from . import db  # noqa: E402

SETUP = r"""
CREATE SCHEMA IF NOT EXISTS sync;
CREATE TABLE IF NOT EXISTS sync.changes (id bigserial PRIMARY KEY, stmt text NOT NULL, at timestamptz DEFAULT now());
CREATE OR REPLACE FUNCTION sync.log() RETURNS trigger LANGUAGE plpgsql AS $f$
DECLARE t text := format('%I.%I', TG_TABLE_SCHEMA, TG_TABLE_NAME); pick text; cols text;
BEGIN
  IF TG_OP = 'TRUNCATE' THEN INSERT INTO sync.changes(stmt) VALUES ('TRUNCATE ' || t); RETURN NULL; END IF;
  -- rows are matched by full old content (many problem tables have no primary key)
  IF TG_OP <> 'INSERT' THEN
    pick := format('ctid = (SELECT ctid FROM %s x WHERE to_jsonb(x) = %L::jsonb LIMIT 1)', t, to_jsonb(OLD));
  END IF;
  IF TG_OP = 'UPDATE' THEN
    SELECT string_agg(quote_ident(attname), ',' ORDER BY attnum) INTO cols
      FROM pg_attribute WHERE attrelid = TG_RELID AND attnum > 0 AND NOT attisdropped;
  END IF;
  INSERT INTO sync.changes(stmt) VALUES (CASE TG_OP
    WHEN 'INSERT' THEN format('INSERT INTO %s SELECT * FROM jsonb_populate_record(NULL::%s, %L)', t, t, to_jsonb(NEW))
    WHEN 'DELETE' THEN format('DELETE FROM %s WHERE %s', t, pick)
    ELSE format('UPDATE %s SET (%s) = (SELECT * FROM jsonb_populate_record(NULL::%s, %L)) WHERE %s',
                t, cols, t, to_jsonb(NEW), pick) END);
  RETURN NULL;
END $f$;
DO $d$ DECLARE r record; BEGIN
  FOR r IN SELECT schemaname s, tablename n FROM pg_tables
           WHERE schemaname NOT IN ('sync', 'pg_catalog', 'information_schema') LOOP
    EXECUTE format('CREATE OR REPLACE TRIGGER sql50_sync AFTER INSERT OR UPDATE OR DELETE ON %I.%I'
                   ' FOR EACH ROW EXECUTE FUNCTION sync.log()', r.s, r.n);
    EXECUTE format('CREATE OR REPLACE TRIGGER sql50_sync_truncate AFTER TRUNCATE ON %I.%I'
                   ' FOR EACH STATEMENT EXECUTE FUNCTION sync.log()', r.s, r.n);
  END LOOP;
END $d$;
"""


def push_once(neon):
    """Send up to 200 queued changes to Neon in one transaction. Returns how many were sent."""
    ok, out = db.psql("SELECT id, stmt, current_setting('TimeZone') FROM sync.changes ORDER BY id LIMIT 200;")
    if not ok:
        raise RuntimeError(out)
    rows = db.csv_to_grid(out)["rows"]
    if not rows:
        return 0
    # row matching compares jsonb text; timestamptz renders in the session zone, so use the local one on Neon
    sql = f"BEGIN;\nSET LOCAL TIME ZONE {db.q(rows[0][2])};\n" + ";\n".join(r[1] for r in rows) + ";\nCOMMIT;\n"
    r = subprocess.run([db.PSQL, neon, "-q", "-v", "ON_ERROR_STOP=1", "-f", "-"], input=sql, capture_output=True,
                       text=True, encoding="utf-8", env={**os.environ, "PGCONNECT_TIMEOUT": "10"})
    if r.returncode:
        raise RuntimeError(f"neon rejected change {rows[0][0]}..{rows[-1][0]}: {r.stderr.strip()[:500]}")
    ok, out = db.psql(f"DELETE FROM sync.changes WHERE id = ANY('{{{','.join(r[0] for r in rows)}}}');", csv=False)
    if not ok:
        raise RuntimeError(out)
    return len(rows)


def _loop(neon):
    while True:
        try:
            n = push_once(neon)
            if n:
                print(f"sync: pushed {n} change(s) to Neon")
            time.sleep(0 if n == 200 else 2)
        # shortcut: a change Neon keeps rejecting (e.g. DDL drift) blocks the queue; fix it or delete it from sync.changes
        except Exception as e:  # noqa: BLE001 - keep the worker alive; queue stays intact for retry
            print("sync:", e)
            time.sleep(10)


def start(block=False):
    """Install triggers (also on tables created since last start) and start the worker. No-op without NEON_URL."""
    neon = (os.environ.get("NEON_URL") or "").strip().replace("-pooler.", ".")
    if not neon:
        return False
    ok, err = db.psql(SETUP, csv=False, quiet=True)
    if not ok:
        raise RuntimeError("sync setup failed: " + err)
    if block:
        _loop(neon)
    threading.Thread(target=_loop, args=(neon,), daemon=True, name="neon-sync").start()
    return True


if __name__ == "__main__":
    db.connect()
    start(block=True)
