"""data/ files (solutions.json, sql50.sql, problems/*.md): Neon object storage first, local data/ as fallback.

Bucket config (.env): AWS_ENDPOINT_URL_S3, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, S3_BUCKET.
Objects live under the key prefix "data/", mirroring the local folder. Upload with: python scripts/sync_data.py
"""
import os
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
PREFIX = "data/"


def _client():
    if not (os.environ.get("S3_BUCKET") and os.environ.get("AWS_ENDPOINT_URL_S3")):
        return None
    import boto3
    from botocore.config import Config
    return boto3.client("s3", endpoint_url=os.environ["AWS_ENDPOINT_URL_S3"],
                        config=Config(s3={"addressing_style": "path"}, connect_timeout=5, read_timeout=20,
                                      retries={"max_attempts": 2}))


def read_text(name):
    """Return (text, source) for data/<name>; source is 's3' or 'local'."""
    try:
        s3 = _client()
        if s3:
            body = s3.get_object(Bucket=os.environ["S3_BUCKET"], Key=PREFIX + name)["Body"].read()
            return body.decode("utf-8"), "s3"
    except Exception as e:  # bucket down / object missing: local copy keeps the app working
        print(f"object storage read failed for {name} ({type(e).__name__}), using local data/")
    return (DATA / name).read_text(encoding="utf-8"), "local"


def upload_all():
    """Push every file under local data/ to the bucket. Returns the uploaded keys."""
    s3 = _client()
    if not s3:
        raise RuntimeError("object storage is not configured (S3_BUCKET / AWS_ENDPOINT_URL_S3 in .env)")
    keys = []
    for f in sorted(p for p in DATA.rglob("*") if p.is_file()):
        key = PREFIX + f.relative_to(DATA).as_posix()
        ctype = "application/json" if f.suffix == ".json" else "text/plain; charset=utf-8"
        s3.upload_file(str(f), os.environ["S3_BUCKET"], key, ExtraArgs={"ContentType": ctype})
        keys.append(key)
    return keys
