"""Phase 3 guards: token palette passes WCAG AA, themes are wired on the right pages, no hard-coded brand text."""
import re
from pathlib import Path

import pytest

STATIC = Path(__file__).resolve().parents[1] / "app" / "static"
TOKENS = (STATIC / "css" / "tokens.css").read_text()


def _block(selector_start: str) -> dict:
    start = TOKENS.index(selector_start)
    body = TOKENS[TOKENS.index("{", start) + 1:TOKENS.index("}", start)]
    return dict(re.findall(r"--([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})", body))


DARK = _block(':root, html[data-theme="dark"]')
LIGHT = _block('html[data-theme="light"]')


def _lum(hex_color: str) -> float:
    rgb = [int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    lin = [c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb]
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]


def ratio(a: str, b: str) -> float:
    hi, lo = sorted((_lum(a), _lum(b)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


# (foreground token, background token, minimum ratio)
PAIRS = [
    ("text-primary", "bg-canvas", 4.5), ("text-primary", "bg-surface-1", 4.5), ("text-primary", "bg-surface-2", 4.5),
    ("text-primary", "bg-elevated", 4.5),
    ("text-secondary", "bg-canvas", 4.5), ("text-secondary", "bg-surface-1", 4.5), ("text-secondary", "bg-surface-2", 4.5),
    ("text-muted", "bg-canvas", 4.5), ("text-muted", "bg-surface-1", 4.5), ("text-muted", "bg-surface-2", 4.5),
    ("accent-on", "accent-primary", 4.5), ("accent-text", "bg-canvas", 4.5), ("accent-text", "bg-surface-1", 4.5),
    ("status-playing-fg", "status-playing-bg", 4.5), ("status-cued-fg", "status-cued-bg", 4.5),
    ("status-danger-fg", "status-danger-bg", 4.5),
    ("focus-ring", "bg-canvas", 3.0), ("border-strong", "bg-canvas", 1.5),
]


@pytest.mark.parametrize("theme,palette", [("dark", DARK), ("light", LIGHT)])
@pytest.mark.parametrize("fg,bg,minimum", PAIRS)
def test_token_pair_meets_wcag_aa(theme, palette, fg, bg, minimum):
    assert fg in palette and bg in palette, f"{fg}/{bg} missing in {theme}"
    assert ratio(palette[fg], palette[bg]) >= minimum, f"{theme}: {fg} on {bg} = {ratio(palette[fg], palette[bg]):.2f}"


def test_light_and_dark_define_the_same_colour_roles():
    assert set(LIGHT) <= set(DARK)
    for needed in ("bg-canvas", "text-primary", "accent-primary", "accent-on", "focus-ring"):
        assert needed in LIGHT and needed in DARK


GUEST_AND_ADMIN = ["landing.html", "signup.html", "index.html", "dashboard.html", "admin-settings.html"]
ALWAYS_DARK = ["live.html", "stage-monitor.html", "admin.html"]


@pytest.mark.parametrize("page", GUEST_AND_ADMIN)
def test_themed_pages_load_tokens_theme_and_switcher(page):
    html = (STATIC / page).read_text()
    for needed in ("/static/css/tokens.css", "/static/css/theme.css", "/static/js/theme.js"):
        assert needed in html, f"{page} missing {needed}"
    assert html.index("theme.js") < html.index("style.css"), "theme.js must run before first paint"


@pytest.mark.parametrize("page", ALWAYS_DARK)
def test_console_monitor_and_live_stay_dark(page):
    html = (STATIC / page).read_text()
    assert 'data-theme="dark"' in html and "theme.js" not in html
    assert "/static/css/tokens.css" in html


def test_no_hard_coded_brand_text_in_pages_or_scripts():
    offenders = []
    for path in list(STATIC.glob("*.html")) + list((STATIC / "js").rglob("*.js")):
        for line_no, line in enumerate(path.read_text().splitlines(), 1):
            if "EMA Paattukoottam" in line and "e.g." not in line and not line.lstrip().startswith("//"):
                offenders.append(f"{path.name}:{line_no}")
    assert not offenders, offenders


def test_disabled_console_secondary_control_uses_accessible_token_contrast():
    console = (STATIC / "css" / "console.css").read_text()
    match = re.search(r"\.c-sbtn\.is-disabled\s*\{([^}]+)\}", console)
    assert match, "console disabled control rule is missing"
    rule = match.group(1)
    assert re.search(r"color:\s*var\(--text-secondary\)", rule), rule
    assert re.search(r"background:\s*var\(--bg-surface-2\)", rule), rule
    assert not re.search(r"opacity:\s*(?:0?\.\d+)", rule), "translucency dims disabled text below its token contrast"
    assert ratio(DARK["text-secondary"], DARK["bg-surface-2"]) >= 4.5


def test_theme_script_resolves_system_light_dark():
    js = (STATIC / "js" / "theme.js").read_text()
    assert "prefers-color-scheme: light" in js and "etm-theme" in js and "data-theme" in js
