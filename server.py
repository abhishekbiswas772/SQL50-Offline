"""Launcher: python server.py  (opens http://127.0.0.1:8000 in the browser).

Env: SQL50_PORT (default 8000), SQL50_NO_BROWSER=1 to skip opening the browser.
"""
import os, threading, webbrowser
import uvicorn

if __name__ == "__main__":
    port = int(os.environ.get("SQL50_PORT", 8000))
    url = f"http://127.0.0.1:{port}/"
    print("SQL50 practice UI:", url, "  (Ctrl+C to stop)")
    if os.environ.get("SQL50_NO_BROWSER") != "1":
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    uvicorn.run("app.main:app", host="127.0.0.1", port=port, log_level="warning")
