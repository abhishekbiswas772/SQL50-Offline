"""Accounts: PBKDF2 password hashes in public.users, random session tokens (stored as SHA-256) in
public.sessions. Token -> user id is cached in memory so authed requests don't pay an extra psql call."""
import hashlib, hmac, re, secrets, time

from .db import csv_to_grid, psql, q

COOKIE = "sql50_session"
MAX_AGE = 30 * 24 * 3600
USERNAME = re.compile(r"^[A-Za-z0-9_.-]{3,24}$")
_ITER = 200_000
_cache: dict[str, tuple[int, float]] = {}  # sha256(token) -> (user id, expiry epoch)


def hash_password(pw: str) -> str:
    salt = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), _ITER).hex()
    return f"pbkdf2${_ITER}${salt}${h}"


def verify_password(pw: str, stored: str) -> bool:
    try:
        _, it, salt, h = stored.split("$")
        got = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), int(it)).hex()
    except ValueError:
        return False
    return hmac.compare_digest(got, h)


_th = lambda token: hashlib.sha256(token.encode()).hexdigest()


def validate(username, password):
    if not isinstance(username, str) or not USERNAME.fullmatch(username):
        return "Username must be 3–24 letters, digits, _ . or -"
    if not isinstance(password, str) or not 8 <= len(password) <= 128:
        return "Password must be 8–128 characters"
    return None


def signup(username, password):
    """Create the user and a session in one round trip. The first account ever created takes over
    progress/app_state saved before accounts existed (user_id 0). Returns (token, user) or (None, error)."""
    token = secrets.token_urlsafe(32)
    ok, t = psql(
        "WITH first AS (SELECT NOT EXISTS (SELECT 1 FROM public.users) AS f),"
        " u AS (INSERT INTO public.users(username,pass) VALUES(%s,%s) ON CONFLICT DO NOTHING RETURNING id),"
        " s AS (INSERT INTO public.sessions(token,user_id) SELECT %s,id FROM u),"
        " p AS (UPDATE public.progress SET user_id=(SELECT id FROM u) WHERE user_id=0 AND (SELECT f FROM first) AND EXISTS (SELECT 1 FROM u)),"
        " a AS (UPDATE public.app_state SET user_id=(SELECT id FROM u) WHERE user_id=0 AND (SELECT f FROM first) AND EXISTS (SELECT 1 FROM u))"
        " SELECT id FROM u;" % (q(username), q(hash_password(password)), q(_th(token))))
    rows = csv_to_grid(t)["rows"] if ok else []
    if not ok:
        return None, "Could not create the account"
    if not rows:
        return None, "That username is taken"
    _cache[_th(token)] = (int(rows[0][0]), time.time() + MAX_AGE)
    return token, {"id": int(rows[0][0]), "username": username}


def signin(username, password):
    ok, t = psql("SELECT id,username,pass FROM public.users WHERE lower(username)=lower(%s);" % q(str(username)))
    rows = csv_to_grid(t)["rows"] if ok else []
    if not rows or not verify_password(str(password), rows[0][2]):
        return None, "Wrong username or password"
    uid, token = int(rows[0][0]), secrets.token_urlsafe(32)
    ok, _ = psql("INSERT INTO public.sessions(token,user_id) VALUES(%s,%d);" % (q(_th(token)), uid), csv=False)
    if not ok:
        return None, "Could not sign in"
    _cache[_th(token)] = (uid, time.time() + MAX_AGE)
    return token, {"id": uid, "username": rows[0][1]}


def user_id(token):
    """Session token -> user id, or None. Expired sessions (older than MAX_AGE) are rejected."""
    if not token:
        return None
    th = _th(token)
    if th not in _cache:
        ok, t = psql("SELECT user_id, extract(epoch FROM created)::bigint + %d FROM public.sessions WHERE token=%s;"
                     % (MAX_AGE, q(th)))
        rows = csv_to_grid(t)["rows"] if ok else []
        if not rows:
            return None
        _cache[th] = (int(rows[0][0]), float(rows[0][1]))
    uid, exp = _cache[th]
    return uid if exp > time.time() else None


def signout(token):
    if token:
        _cache.pop(_th(token), None)
        psql("DELETE FROM public.sessions WHERE token=%s;" % q(_th(token)), csv=False)


def me(uid):
    ok, t = psql("SELECT id,username,created::date FROM public.users WHERE id=%d;" % uid)
    rows = csv_to_grid(t)["rows"] if ok else []
    return {"id": int(rows[0][0]), "username": rows[0][1], "since": rows[0][2]} if rows else None
