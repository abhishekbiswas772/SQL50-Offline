"""End-to-end UI test with Playwright. Spawns the server on a test port and drives the page.

  python tests/test_ui.py        # prints PASS / raises on failure
"""
import subprocess, sys, time, urllib.request
import os, secrets
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


# Test accounts get random names; their rows are deleted afterwards. Real accounts are never touched.
USERS = ["t_" + secrets.token_hex(4), "t_" + secrets.token_hex(4)]
PASSWORD = "correct-horse-1"


def guard_legacy():
    # the first account ever created takes over pre-account progress; never let a test account be it
    db.ensure_tables()
    ok, t = db.psql("SELECT (SELECT count(*) FROM public.users), (SELECT count(*) FROM public.progress WHERE user_id=0)"
                    " + (SELECT count(*) FROM public.app_state WHERE user_id=0);")
    users, legacy = map(int, db.csv_to_grid(t)["rows"][0])
    if not users and legacy:
        raise SystemExit("Sign up your own account in the app first: it claims the existing progress.")


def cleanup():
    names = ",".join(db.q(u) for u in USERS)
    sql("DELETE FROM public.progress WHERE user_id IN (SELECT id FROM public.users WHERE username IN (%s));"
        "DELETE FROM public.app_state WHERE user_id IN (SELECT id FROM public.users WHERE username IN (%s));"
        "DELETE FROM public.users WHERE username IN (%s);" % (names, names, names))


def auth(page, mode, user, password=PASSWORD, name=None):
    page.click("#tabSignup" if mode == "signup" else "#tabSignin")
    if name:
        page.fill("#loginName", name)
    page.fill("#authUser", user)
    page.fill("#authPass", password)
    if mode == "signup":
        page.fill("#authPass2", password)
    page.click("#loginGo")


def wait_up():
    for _ in range(120):
        try:
            urllib.request.urlopen(BASE + "/", timeout=15)
            return
        except Exception:
            time.sleep(0.25)
    raise RuntimeError("server did not start")


def main():
    guard_legacy()
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
            expect(page.locator("#login")).to_be_visible()     # no session: sign-in screen first
            page.click("#loginGo")                             # empty form is rejected client-side
            expect(page.locator("#authErr")).to_be_visible()
            page.click("#tabSignup")
            page.fill("#loginName", "Tester")
            page.fill("#authUser", USERS[0])
            page.fill("#authPass", PASSWORD)
            page.fill("#authPass2", PASSWORD + "x")
            page.click("#loginGo")
            expect(page.locator("#authErr")).to_contain_text("do not match")
            auth(page, "signup", USERS[0], name="Tester")
            expect(page.locator("#onboard")).to_be_visible()   # new account: onboarding tour
            for _ in range(3):
                page.click("#obNext")
            page.click("#obGoal [data-goal='1']")
            page.click("#obNext")                              # finish
            expect(page.locator("#onboard")).to_be_hidden()
            expect(page.locator("#home")).to_be_visible()      # dashboard is the landing view
            expect(page.locator("#helloText")).to_contain_text("Tester")
            expect(page.locator("#ptAchievements .achv")).to_have_count(page.evaluate("ACHIEVEMENTS.length"))
            page.click("#navUser")                             # settings page
            expect(page.locator("#settings")).to_be_visible()
            expect(page.locator("#setName")).to_have_value("Tester")
            page.click("#brandHome")                           # logo goes Home
            expect(page.locator("#home")).to_be_visible()
            page.click("#navProblems")                         # go to the problem workspace
            page.click('.item[data-id="1757"]')               # open first problem
            expect(page.locator("#desc h2")).to_contain_text("Recyclable")
            expect(page.locator("#desc table").first).to_be_visible()  # sample data shown
            assert page.locator('.item[data-id="1757"]').get_attribute("href") == "#problem/1757"
            assert page.url.endswith("#problem/1757")
            with ctx.expect_page() as tab_info:               # Ctrl+click opens the problem in a new tab
                page.locator('.item[data-id="1757"]').click(modifiers=["Control"])
            linked = tab_info.value
            expect(linked.locator("#desc h2")).to_contain_text("Recyclable")
            assert linked.url.endswith("#problem/1757"), linked.url
            linked.close()
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
            home_tab = ctx.new_page()                          # dashboard in a second tab
            home_tab.goto(BASE)
            expect(home_tab.locator("#home")).to_be_visible()
            setv("SELECT product_id FROM products WHERE low_fats='Y' AND recyclable='Y'")
            page.click("#run")
            expect(page.locator("#out table")).to_be_visible()
            cells = page.locator("#out table td").all_inner_texts()
            assert cells == ["1", "3"], f"wrong result rows: {cells}"
            page.click("#solved")
            expect(page.locator("#status")).to_contain_text("solved")
            expect(home_tab.locator("#kSolved")).to_have_text("1")   # updates live across tabs
            expect(home_tab.locator('.item[data-id="1757"] .dot.solved')).to_have_count(1)
            home_tab.close()
            page.reload()                                      # deep link: refresh reopens this problem
            expect(page.locator("#login")).to_be_hidden()      # session cookie: no re-login
            expect(page.locator("#desc h2")).to_contain_text("Recyclable")
            page.click("#navHome")
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
            page.click("#navProblems")                         # back to the workspace
            page.locator('.item[data-id="1757"]').click()
            expect(page.locator(".CodeMirror-code")).to_contain_text("recyclable='Y'")
            assert val() == "SELECT product_id FROM products WHERE low_fats='Y' AND recyclable='Y'", val()
            setv("SELECT broken")                              # reset restores the saved solution
            page.click("#resetEditor")
            assert val() == "SELECT product_id FROM products WHERE low_fats='Y' AND recyclable='Y'", val()
            page.click("#navUser")
            expect(page.locator("#setMeta")).to_contain_text("@" + USERS[0])
            page.wait_for_timeout(800)                         # let debounced state writes land
            page.click("#setLogout")                           # sign out returns to the sign-in screen
            expect(page.locator("#login")).to_be_visible()
            auth(page, "signin", USERS[0], password="wrong-password")
            expect(page.locator("#authErr")).to_contain_text("Wrong username or password")
            assert not errors, f"page errors: {errors}"
            fresh = browser.new_context().new_page()           # empty localStorage: state must come from DB
            fresh.goto(BASE)
            expect(fresh.locator("#login")).to_be_visible()
            auth(fresh, "signup", USERS[0].upper(), name="Dup")   # usernames are case-insensitive
            expect(fresh.locator("#authErr")).to_contain_text("taken")
            auth(fresh, "signin", USERS[0])
            expect(fresh.locator("#home")).to_be_visible()
            expect(fresh.locator("#onboard")).to_be_hidden()   # onboarded flag persisted
            expect(fresh.locator("#helloText")).to_contain_text("Tester")
            expect(fresh.locator("#ptAchievements .achv.on").first).to_contain_text("First Blood")
            other = browser.new_context().new_page()           # a second account has its own progress
            other.goto(BASE)
            auth(other, "signup", USERS[1], name="Other")
            expect(other.locator("#onboard")).to_be_visible()
            other.click("#obSkip")
            expect(other.locator('.item[data-id="1757"]')).to_have_count(1)
            expect(other.locator('.item[data-id="1757"] .dot.solved')).to_have_count(0)
            print("PASS: sign-up, sign-in, sign-out, sessions, per-user progress, onboarding, home, settings, "
                  "run, result, save-to-DB, reload-persists, achievements persist in DB, editor, formatter, AI hints")
    finally:
        srv.terminate()
        cleanup()


if __name__ == "__main__":
    main()
