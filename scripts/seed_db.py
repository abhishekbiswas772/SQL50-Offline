"""(Re)load schema + sample data + catalog into the Neon database (DATABASE_URL). Reads sql50.sql from object storage, falling back to local data/.
Drops and recreates the q<id> schemas and public.problems; progress and app_state are kept.

  python scripts/seed_db.py
"""
import os, subprocess, sys, tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from dotenv import load_dotenv  # noqa: E402
load_dotenv(Path(__file__).resolve().parent.parent / ".env")
from app import db, storage  # noqa: E402

name = db.connect()
text, src = storage.read_text("sql50.sql")
with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False, encoding="utf-8") as f:
    f.write(text)
r = subprocess.run([db.PSQL, *db._url, "-q", "-1", "-v", "ON_ERROR_STOP=1", "-f", f.name])
os.unlink(f.name)
db.ensure_tables()
print(f"loaded sql50.sql ({src}) into {name}" if r.returncode == 0 else "load failed")
sys.exit(r.returncode)
