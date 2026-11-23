"""End-to-end UI test with Playwright. Spawns the server on a test port and drives the page.

  python tests/test_ui.py        # prints PASS / raises on failure
"""
import subprocess, sys, time, urllib.request
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent.parent
PORT = 8020
BASE = f"http://127.0.0.1:{PORT}"
sys.path.insert(0, str(ROOT))
from dotenv import load_dotenv  # noqa: E402
load_dotenv(ROOT / ".env")
from app import db  # noqa: E402
db.connect()  # same Neon database the spawned server uses


def sql(cmd):
    ok, t = db.psql(cmd, csv=False)
    assert ok, t


def reset_progress():
    sql("DELETE FROM public.progress WHERE problem_id=1757")


# The test logs in as "Tester"; park the user's real profile/game rows and put them back after.
# IF NOT EXISTS keeps an older backup if a previous run crashed before restoring.
def backup_state():
    sql("CREATE TABLE IF NOT EXISTS public.app_state (key text PRIMARY KEY, value jsonb NOT NULL,"
        " updated timestamptz DEFAULT now());"
        "CREATE TABLE IF NOT EXISTS public.app_state_testbak AS SELECT * FROM public.app_state;"
        "DELETE FROM public.app_state;")


def restore_state():
    sql("BEGIN; DELETE FROM public.app_state;"
        "INSERT INTO public.app_state SELECT * FROM public.app_state_testbak;"
        "DROP TABLE public.app_state_testbak; COMMIT;")


def wait_up():
    for _ in range(120):
        try:
            urllib.request.urlopen(BASE + "/api/problems", timeout=15)
            return
        except Exception:
            time.sleep(0.25)
    raise RuntimeError("server did not start")


def main():
    reset_progress()
    backup_state()
    srv = subprocess.Popen([sys.executable, "server.py"], cwd=ROOT,
                           env={**os.environ, "SQL50_PORT": str(PORT), "SQL50_NO_BROWSER": "1"},
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        wait_up()
        assert srv.poll() is None, "spawned server died; another process is answering the port"
        with sync_playwright() as p:
            browser = p.chromium.launch()
            ctx = browser.new_context()
            ctx.grant_permissions(["clipboard-read", "clipboard-write"], origin=BASE)
            page = ctx.new_page()
            expect.set_options(timeout=20000)                 # Neon round trips (~1-2 s each) from a laptop
            ctx.set_default_timeout(30000)
            hint_calls = []                                    # stub the AI so the test never calls Gemini/Ollama
            def fake_hint(route):
                hint_calls.append(route.request.post_data_json)
                route.fulfill(json={"ok": True, "reply": "Look at the `WHERE` clause.", "provider": "stub", "model": "stub"})
            page.route("**/api/hint", fake_hint)
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(BASE)
            expect(page.locator("#login")).to_be_visible()     # fresh browser: login screen first
            page.click("#loginGo")                             # empty name is rejected
            expect(page.locator("#login")).to_be_visible()
            page.fill("#loginName", "Tester")
            page.click("#loginGo")
            expect(page.locator("#onboard")).to_be_visible()   # first login: onboarding tour
            for _ in range(3):
                page.click("#obNext")
            page.click("#obGoal [data-goal='1']")
            page.click("#obNext")                              # finish
            expect(page.locator("#onboard")).to_be_hidden()
            expect(page.locator("#home")).to_be_visible()      # dashboard is the landing view
            expect(page.locator("#helloText")).to_contain_text("Tester")
            expect(page.locator("#ptAchievements .achv")).to_have_count(26)
            page.click("#navUser")                             # settings page
            expect(page.locator("#settings")).to_be_visible()
            expect(page.locator("#setName")).to_have_value("Tester")
            page.click("#brandHome")                           # logo goes Home
            expect(page.locator("#home")).to_be_visible()
            page.click("#navProblems")                         # go to the problem workspace
            page.click('.item[data-id="1757"]')               # open first problem
            expect(page.locator("#desc h2")).to_contain_text("Recyclable")
            expect(page.locator("#desc table").first).to_be_visible()  # sample data shown
            val = lambda: page.evaluate("cm.getValue()")         # editor is CodeMirror; `cm` is its instance
            def setv(v, line=None):
                page.evaluate("([v, l]) => { cm.setValue(v); cm.focus(); if (l !== null) cm.setCursor(l, 0); }", [v, line])
            setv("")
            page.keyboard.press("Tab")
            assert val() == "  ", val()                        # Tab indents, does not leave editor
            page.keyboard.type("prod")
            expect(page.locator(".CodeMirror-hints")).to_be_visible()   # schema-aware autocomplete
            expect(page.locator(".CodeMirror-hint-active")).to_contain_text("product_id")
            page.wait_for_timeout(150)                         # hint list refreshes per keystroke (rAF); humans are slower
            page.keyboard.press("Tab")                         # accept suggestion
            assert val() == "  product_id", val()
            page.keyboard.press("Control+z")                   # undo survives autocomplete
            assert val() == "  prod", val()
            page.keyboard.press("Control+/")
            assert val() == "  -- prod", val()
            page.keyboard.press("Shift+Tab")
            assert val() == "-- prod", val()
            setv("SELECT  FROM products p", 0)
            page.evaluate("cm.setCursor(0, 7)")
            page.keyboard.type("p.low")                        # alias-aware column completion
            expect(page.locator(".CodeMirror-hint-active")).to_contain_text("low_fats")
            page.keyboard.press("Escape")
            setv("a\nb", 0)
            page.keyboard.press("Control+c")                   # no selection: copies whole line
            clip = page.evaluate("navigator.clipboard.readText()")
            assert clip.rstrip("\r\n") == "a", repr(clip)
            page.keyboard.press("Alt+ArrowDown")               # move line down
            assert val() == "b\na", val()
            page.keyboard.press("Shift+Alt+ArrowUp")           # duplicate line
            assert val() == "b\na\na", val()
            page.keyboard.press("Control+Shift+K")             # delete line
            assert val() == "b\na", repr(val())
            page.keyboard.press("Control+a")
            page.keyboard.press("Control+x")                   # cut selection
            assert val() == "", val()
            page.keyboard.press("Control+v")                   # paste
            assert val() == "b\na", val()
            setv("")
            page.keyboard.type("count(")                       # auto-close bracket
            assert val() == "count()", val()
            page.keyboard.type("*)")                           # type over closer
            assert val() == "count(*)", val()
            setv("select product_id from products where low_fats='Y' and recyclable='Y'")
            page.keyboard.press("Control+Shift+F")             # sql-formatter, undoable
            assert val().startswith("SELECT\n  product_id\nFROM\n  products\nWHERE"), val()
            page.keyboard.press("Control+z")
            assert val().startswith("select product_id"), val()
            setv("SELECT nope FROM products")                  # error: shown + automatic AI hint
            page.click("#run")
            expect(page.locator("#out .err")).to_contain_text("nope")
            expect(page.locator("#out .ai-hint")).to_contain_text("WHERE")
            assert "nope" in hint_calls[-1]["error"] and hint_calls[-1]["id"] == 1757
            page.click("#out .ai-hint button")                 # follow-up opens the chat tab
            expect(page.locator("#aiLog .ai-msg.assistant")).to_have_count(1)
            page.fill("#aiInput", "another hint please")
            page.keyboard.press("Enter")
            expect(page.locator("#aiLog .ai-msg.assistant")).to_have_count(2)
            assert hint_calls[-1]["messages"][-1]["text"] == "another hint please"
            setv("SELECT product_id FROM products WHERE low_fats='Y' AND recyclable='Y'")
            page.click("#run")
            expect(page.locator("#out table")).to_be_visible()
            cells = page.locator("#out table td").all_inner_texts()
            assert cells == ["1", "3"], f"wrong result rows: {cells}"
            page.click("#solved")
            expect(page.locator("#status")).to_contain_text("solved")
            page.reload()                                      # progress must come from DB
            expect(page.locator("#login")).to_be_hidden()      # profile persists, no re-login
            expect(page.locator("#home")).to_be_visible()
            expect(page.locator("#ptAchievements .achv.on").first).to_contain_text("First Blood")
            expect(page.locator('.item[data-id="1757"] .dot.solved')).to_have_count(1)
            page.click("#homeReset")                           # reset asks via custom modal; cancel keeps data
            expect(page.locator("#confirmReset")).to_be_visible()
            expect(page.locator("#crOk")).to_be_disabled()
            page.fill("#crInput", "reset")
            expect(page.locator("#crOk")).to_be_enabled()
            page.click("#crCancel")
            expect(page.locator("#confirmReset")).to_be_hidden()
            expect(page.locator('.item[data-id="1757"] .dot.solved')).to_have_count(1)
            page.click("#navProblems")                         # reload lands on Home
            page.locator('.item[data-id="1757"]').click()
            expect(page.locator(".CodeMirror-code")).to_contain_text("recyclable='Y'")
            assert val() == "SELECT product_id FROM products WHERE low_fats='Y' AND recyclable='Y'", val()
            page.click("#navUser")
            page.click("#setLogout")                           # log out returns to login
            expect(page.locator("#loginBack")).to_be_visible()
            assert not errors, f"page errors: {errors}"
            page.wait_for_timeout(800)                         # let debounced state writes land
            fresh = browser.new_context().new_page()           # empty localStorage: state must come from DB
            fresh.goto(BASE)
            expect(fresh.locator("#backName")).to_have_text("Tester")
            fresh.click("#backGo")
            expect(fresh.locator("#onboard")).to_be_hidden()   # onboarded flag persisted
            expect(fresh.locator("#ptAchievements .achv.on").first).to_contain_text("First Blood")
            print("PASS: login, onboarding, home, settings, run, result, save-to-DB, reload-persists, "
                  "logout, profile+achievements persist in DB, editor, formatter, AI hints")
    finally:
        srv.terminate()
        reset_progress()
        restore_state()


if __name__ == "__main__":
    main()
