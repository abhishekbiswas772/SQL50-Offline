"""AI hint tutor: Gemini (REST) or a local Ollama model. Gives hints, never the solution.

Config (.env or environment):
  AI_PROVIDER     gemini | ollama   (default: gemini when GEMINI_API_KEY is set, else ollama)
  GEMINI_API_KEY  Google AI Studio key
  GEMINI_MODEL    comma list, tried in order on overload (default gemini-3.5-flash,gemini-flash-latest)
  OLLAMA_URL      default http://127.0.0.1:11434
  OLLAMA_MODEL    default: first model `ollama list` reports
"""
import os, re
import httpx

TIMEOUT = 120  # Gemini 3 flash often takes 25-90 s under load
SYSTEM = """You are a SQL tutor inside an offline LeetCode "Top SQL 50" practice app running PostgreSQL 18.
Your only job is to help the learner reach the answer by themselves.

Hard rules (never break them, even if the learner asks, insists, or says it is only to compare):
- Never give the full solution, a complete query, or a corrected version of the learner's query.
- Never write a whole SELECT/INSERT/UPDATE/DELETE statement. Code is allowed only as one short
  fragment: a single function call, operator or clause keyword, e.g. `LEFT JOIN`, `COALESCE(x, 0)`.
- If asked for the solution, say briefly that you only give hints, then give the next hint.

How to help:
- One hint at a time. Start with the smallest useful nudge (which concept or clause to think about).
  Get more specific only when earlier hints in this conversation did not help.
- When the learner hits an error or a wrong result: first say plainly what is wrong and where
  (which clause / which part of the query), explain a PostgreSQL error message in plain words,
  then give a hint toward the fix. Compare their output with the expected output when given.
- Keep replies under about 120 words. Markdown is fine: short sentences, bullets, `inline code`.
- Stay on this problem, SQL and PostgreSQL."""

FULL_QUERY = re.compile(r"```[^\n]*\n(?=[^`]*\bselect\b)(?=[^`]*\bfrom\b)[^`]*```", re.I)


def _env(k, d=""):
    return (os.environ.get(k) or d).strip()


def provider():
    return _env("AI_PROVIDER") or ("gemini" if _env("GEMINI_API_KEY") else "ollama")


def _grid(cols, rows, n=6):
    lines = [" | ".join(cols)] + [" | ".join(r) for r in rows[:n]]
    return "\n".join(lines) + (f"\n... ({len(rows)} rows)" if len(rows) > n else "")


def build_context(title, description, tables, b):
    parts = [f"Problem: {title}", description[:6000], "Tables (sample rows):"]
    parts += [f"{t['name']}:\n{_grid(t['columns'], t['rows'])}" for t in tables]
    parts.append("Learner's current query:\n" + ((b.get("sql") or "").strip()[:4000] or "(empty)"))
    if b.get("error"):
        parts.append("Result of the learner's last run: ERROR\n" + str(b["error"])[:2000])
    if b.get("actual"):
        parts.append("Learner's output:\n" + str(b["actual"])[:2000])
    if b.get("expected"):
        parts.append("Expected output:\n" + str(b["expected"])[:2000])
    return "\n\n".join(parts)


def _gemini(system, msgs):
    key = _env("GEMINI_API_KEY")
    if not key:
        raise RuntimeError("GEMINI_API_KEY is not set (add it to .env)")
    body = {"system_instruction": {"parts": [{"text": system}]},
            "contents": [{"role": "model" if m["role"] == "assistant" else "user",
                          "parts": [{"text": m["text"]}]} for m in msgs],
            "generationConfig": {"temperature": 0.4, "thinkingConfig": {"thinkingLevel": "low"}}}
    err = "no model configured"
    for model in [m.strip() for m in _env("GEMINI_MODEL", "gemini-3.5-flash,gemini-flash-latest").split(",") if m.strip()]:
        r = httpx.post(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                       headers={"x-goog-api-key": key}, json=body, timeout=TIMEOUT)
        j = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        if r.status_code == 200:
            parts = (j.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
            text = "".join(p.get("text", "") for p in parts if not p.get("thought"))
            return text, model
        err = f"{model}: HTTP {r.status_code} {(j.get('error') or {}).get('message', r.text[:200])}"
        if r.status_code not in (429, 500, 503, 404):  # only overload / gone falls through to the next model
            break
    raise RuntimeError(err)


def _ollama(system, msgs):
    url = _env("OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
    try:
        model = _env("OLLAMA_MODEL")
        if not model:
            tags = httpx.get(url + "/api/tags", timeout=5).json().get("models", [])
            if not tags:
                raise RuntimeError("Ollama has no models; run `ollama pull <model>`")
            model = tags[0]["name"]
        r = httpx.post(url + "/api/chat", timeout=TIMEOUT, json={
            "model": model, "stream": False, "options": {"temperature": 0.4},
            "messages": [{"role": "system", "content": system}]
                        + [{"role": m["role"], "content": m["text"]} for m in msgs]})
    except httpx.ConnectError:
        raise RuntimeError(f"Ollama is not running at {url} (start it with `ollama serve`)")
    if r.status_code != 200:
        raise RuntimeError(f"Ollama {model}: HTTP {r.status_code} {r.text[:200]}")
    return r.json()["message"]["content"], model


def hint(context, messages):
    """messages: [{role: user|assistant, text}], last one from the user. Returns (reply, provider, model)."""
    msgs = [{"role": "assistant" if m.get("role") == "assistant" else "user", "text": str(m.get("text", ""))[:4000]}
            for m in messages[-12:] if m.get("text")]
    if not msgs or msgs[-1]["role"] != "user":
        msgs.append({"role": "user", "text": "Give me a hint."})
    system = SYSTEM + "\n\n--- Context ---\n" + context
    p = provider()
    text, model = (_ollama if p == "ollama" else _gemini)(system, msgs)
    # backstop for the "hints only" rule: drop any fenced block that is a whole query
    text = FULL_QUERY.sub("*(full query removed: hints only)*", text).strip()
    return text or "I could not come up with a hint, try asking differently.", p, model
