"""Dashboard smoke test: every screen opens and renders without errors.

Starts the backend on synthetic data (backend/tests/seed_demo.py) in its own
Postgres schema, walks through all the screens in headless Chromium and checks: loading
has finished, there is no "Failed to load data" banner, no console errors and no
page exceptions, and no /api/* response is 5xx. A screenshot is saved from each
screen to frontend/tests/screenshots/.

Buttons are not clicked: a POST spends YouTube quota and LLM money. Working data is not
touched: it uses its own schema nf_smoke_<hex>, which is dropped after the run.

    make frontend-test
"""
import os
import re
import socket
import subprocess
import sys
import time
import urllib.request
import uuid
import warnings
from pathlib import Path

import pytest
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
SHOTS = Path(__file__).resolve().parent / "screenshots"

# The 24 keys of ROUTES from router.js (before the split -- from app.js) + deep links
# to objects from seed_demo.py.
ROUTES = [
    "overview", "find", "viral", "channels", "categories", "keywords", "tags",
    "tracker", "alerts", "ideas", "language", "transcripts", "clusters", "titles", "saved", "packaging", "metadata", "calendar",
    "niches", "enter", "own", "data", "help", "mcp",
    "niche/demo", "channel/UC0000000000000000000a", "channel/UC0000000000000000000f", "brief/avid000",
    "brief/avid000?gap=how%20to%20start%20a%20tiny%20AI%20lab%3F",
    "compare/avid000,avid001",
]

READY_JS = """() => {
  const v = document.querySelector('#view');
  return !!v && !v.querySelector('.skeleton-page') && v.textContent.trim().length > 0;
}"""


def _env(schema):
    # An empty key overrides the root .env (dotenv does not overwrite already set
    # variables); the LLM is off: no quota, no money.
    return dict(os.environ, NICHE_DB_SCHEMA=schema, YOUTUBE_API_KEY="", LLM_PROVIDER="none")


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _drop_schema(env, schema):
    code = ("import infrastructure.postgres as db\n"
            "c = db.get_conn()\n"
            f"c.execute('DROP SCHEMA IF EXISTS \"{schema}\" CASCADE')\n"
            "c.commit()\n"
            "c.close()\n")
    result = subprocess.run([sys.executable, "-c", code], cwd=BACKEND, env=env,
                             check=False, capture_output=True, text=True)
    if result.returncode != 0:
        # Do not fail an otherwise green run -- but do not stay silent: without this warning
        # the nf_smoke_* schema would quietly stay in the database.
        warnings.warn(
            f"failed to drop schema {schema!r} (exit {result.returncode}):\n{result.stderr}",
            stacklevel=2)


def _wait_healthy(url, proc, log_path, timeout=90):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            pytest.fail(f"uvicorn exited early:\n{log_path.read_text()[-3000:]}")
        try:
            with urllib.request.urlopen(f"{url}/api/health", timeout=5) as r:
                if r.status == 200:
                    return
        except OSError:
            pass
        time.sleep(0.5)
    pytest.fail(f"/api/health not ready in {timeout}s:\n{log_path.read_text()[-3000:]}")


@pytest.fixture(scope="session")
def base_url(tmp_path_factory):
    schema = f"nf_smoke_{uuid.uuid4().hex[:8]}"
    env = _env(schema)
    proc = None
    try:
        subprocess.run([sys.executable, "tests/seed_demo.py"], cwd=BACKEND, env=env, check=True)
        port = _free_port()
        log_path = tmp_path_factory.mktemp("uvicorn") / "server.log"
        with open(log_path, "w") as log:
            proc = subprocess.Popen(
                [sys.executable, "-m", "uvicorn", "api:app", "--host", "127.0.0.1", "--port", str(port)],
                cwd=BACKEND, env=env, stdout=log, stderr=subprocess.STDOUT)
        url = f"http://127.0.0.1:{port}"
        _wait_healthy(url, proc, log_path)
        yield url
    finally:
        if proc is not None:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
        _drop_schema(env, schema)


@pytest.fixture(scope="session")
def browser():
    with sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


def _is_benign_console(text):
    # The browser itself writes a 4xx/5xx response to the console as "Failed to load resource".
    # 4xx is normal for screens (for example, 428 without a YouTube key), while 5xx
    # is caught separately by the responses.
    return text.startswith("Failed to load resource")


def _router_js_route_keys():
    """Keys of the ROUTES object from frontend/router.js (without deep links)."""
    text = (ROOT / "frontend" / "router.js").read_text(encoding="utf-8")
    block = re.search(r"const\s+ROUTES\s*=\s*\{(.*?)\n\};", text, re.S)
    assert block, "router.js: could not find the `const ROUTES = { ... };` block"
    return re.findall(r"^\s*([A-Za-z_$][\w$]*)\s*:\s*\{", block.group(1), re.M)


def test_routes_list_matches_router_js():
    # A screen added to router.js but not to ROUTES here would never be tested --
    # silently; this check catches the desync without a browser/server.
    expected = {r for r in ROUTES if "/" not in r}
    actual = set(_router_js_route_keys())
    assert actual == expected, (
        f"ROUTES in test_smoke.py has diverged from router.js: "
        f"missing from the test {sorted(actual - expected)}, "
        f"extra in the test {sorted(expected - actual)}"
    )


@pytest.mark.parametrize("route", ROUTES)
def test_screen_renders_without_errors(browser, base_url, route):
    page = browser.new_page(viewport={"width": 1400, "height": 900})
    problems = []
    page.on("console", lambda m: m.type == "error" and not _is_benign_console(m.text)
            and problems.append(f"console.error: {m.text}"))
    page.on("pageerror", lambda e: problems.append(f"pageerror: {e}"))
    page.on("response", lambda r: "/api/" in r.url and r.status >= 500
            and problems.append(f"HTTP {r.status}: {r.url}"))
    try:
        page.goto(f"{base_url}/#/{route}")
        page.wait_for_function(READY_JS, timeout=30000)
        page.wait_for_load_state("networkidle")
        SHOTS.mkdir(exist_ok=True)
        shot = re.sub(r"[^\w.-]+", "_", route)
        page.screenshot(path=str(SHOTS / f"{shot}.png"), full_page=True)
        text = page.inner_text("#view")
    finally:
        page.close()
    assert "Failed to load data" not in text, text[:500]
    assert not problems, "\n".join(problems)


@pytest.mark.parametrize("route,expected", [
    # The gaps card (plan 03): without a comment cache -- the "Read
    # comments" button; quota is not spent by itself.
    ("niche/demo", ["Content gaps", "Read comments"]),
    # Thumbnail styles (plan 13): without vectors -- a compute button, no quota spent.
    ("niche/demo", ["Thumbnail styles", "Compute the niche's thumbnail vectors"]),
    # My channels (plan 14): without an OAuth client -- a step-by-step setup, not an error.
    ("own", ["Connection is not set up", "OWN_TOKENS_KEY"]),
    ("own?error=access_denied", ["Connection failed", "access_denied"]),
    # MCP scenarios (plan 11): a section on the connection screen.
    ("mcp", ["Scenarios", "find_niche", "niche_health"]),
    # Niche trend (plan 08): a block on the niche screen and a column in the niche list.
    ("niche/demo", ["Niche trend", "Videos in 30 days"]),
    ("niches", ["Trend"]),
    # What breakouts have in common (plan 29): a block on the niche screen, "not enough data" on demo data.
    ("niche/demo", ["What breakouts have in common", "Correlation, not cause"]),
    # Another language (plan 26): on demo data -- either a pair picker or a hint to collect a second language.
    ("language", ["Another language"]),
    # Where to enter (plan 27): the niche ranking with a note that the weights are a judgement.
    ("enter", ["Where to enter", "The weights are our judgement", "Compare selected"]),
    # Net profit (plan 30): the channel and niche card, the profile editor on "Data".
    ("channel/UC0000000000000000000a", ["Net profit", "There is no cost profile"]),
    # Content calendar (plan 33): a week and drafts without a date.
    ("calendar", ["Calendar", "No date", "stored in UTC"]),
    # Collaboration partners (plan 31): a block on the channel screen.
    ("channel/UC0000000000000000000a", ["Collaboration partners", "YouTube provides no contacts"]),
    ("niche/demo", ["Net profit", "Breaks even at"]),
    ("data", ["Cost profiles", "No profiles yet"]),
    # A brief for a viewer question: the topic from ?gap= reaches the screen.
    ("brief/avid000?gap=how%20to%20start%20a%20tiny%20AI%20lab%3F",
     ["Brief for a gap", "how to start a tiny AI lab?"]),
])
def test_content_gaps_parts_are_on_screen(browser, base_url, route, expected):
    page = browser.new_page(viewport={"width": 1400, "height": 900})
    try:
        page.goto(f"{base_url}/#/{route}")
        page.wait_for_function(READY_JS, timeout=30000)
        page.wait_for_load_state("networkidle")
        text = page.inner_text("#view")
    finally:
        page.close()
    # CSS shows tile captions and table headers in capitals, inner_text
    # returns the already transformed text -- compare case-insensitively.
    for part in expected:
        assert part.lower() in text.lower(), f"{part!r} not on #/{route}: {text[:400]}"


def test_sign_in_screen_when_multi_user_mode_has_no_session(browser, base_url):
    # Plan 15: a server with NF_MULTI_USER=1 without a session -- the dashboard shows sign-in instead of
    # throwing 401 errors across screens. The /api/auth/me response is replaced.
    page = browser.new_page(viewport={"width": 1400, "height": 900})
    problems = []
    page.on("pageerror", lambda e: problems.append(str(e)))
    page.route("**/api/auth/me", lambda r: r.fulfill(
        status=200, content_type="application/json", body='{"multiUser": true, "user": null}'))
    try:
        page.goto(f"{base_url}/#/overview")
        page.wait_for_selector("#signInForm", timeout=30000)
        text = page.inner_text("#view")
    finally:
        page.close()
    assert "Sign in to niche-finder" in text and not problems



def test_token_section_shows_only_with_sign_in(browser, base_url):
    # Plan 15 (5.7-5.8): without sign-in there is no token section, with sign-in there is.
    page = browser.new_page(viewport={"width": 1400, "height": 900})
    page.route("**/api/auth/me", lambda r: r.fulfill(status=200, content_type="application/json",
        body='{"multiUser": true, "user": {"id": 2, "email": "a@x", "isAdmin": false}, "quota": null}'))
    page.route("**/api/auth/tokens", lambda r: r.fulfill(status=200, content_type="application/json",
        body='{"tokens": [{"id": 1, "name": "ext", "createdAt": "2026-09-29T00:00:00+00:00", "lastUsedAt": null}]}'))
    try:
        page.goto(f"{base_url}/#/mcp")
        page.wait_for_selector("#apiTokens .card", timeout=30000)
        text = page.inner_text("#apiTokens")
    finally:
        page.close()
    assert "Personal tokens" in text and "ext" in text
