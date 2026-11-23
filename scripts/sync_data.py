"""Upload local data/ (sql50.sql, solutions.json, problems/*.md) to Neon object storage.

  python scripts/sync_data.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from dotenv import load_dotenv  # noqa: E402
load_dotenv(Path(__file__).resolve().parent.parent / ".env")
from app import storage  # noqa: E402

keys = storage.upload_all()
print(f"uploaded {len(keys)} files to bucket under {storage.PREFIX}")
