"""Static-content checks for the consolidated admin (5 destinations over the original 10 tabs)."""
import re
from pathlib import Path

STATIC = Path(__file__).resolve().parent.parent / "app" / "static"
HTML = (STATIC / "admin-settings.html").read_text()
JS = "\n".join(f.read_text() for f in [STATIC / "js" / "admin-settings.js", *sorted((STATIC / "js" / "settings").glob("*.js"))])
SETUP_JS = (STATIC / "js" / "admin-setup.js").read_text()
DASH_JS = (STATIC / "js" / "admin-dashboard.js").read_text()
CSS = (STATIC / "css" / "admin-shell.css").read_text()

OLD_TABS = ["event", "rules", "features", "food", "participants", "sheet", "payments", "stats", "backup", "activity"]
NEW_TABS = ["overview", "lineup", "system"]
OLD_SETTING_IDS = [
    "allowed-media-audio", "allowed-media-video", "force-backup-btn", "pay-all", "pay-bar", "pay-body", "pay-dirty",
    "pay-discard", "pay-filters", "pay-save", "pay-search", "pay-summary", "save-event-settings-btn", "save-food-note-btn",
    "save-rules-btn", "setting-entry-id-prefix", "setting-event-date-time", "setting-event-name", "setting-event-poster-url",
    "setting-event-subtitle", "setting-event-time-range", "setting-event-venue", "setting-food-serving-note",
    "setting-general-notes", "setting-header-brand-subtitle", "setting-header-brand-title", "setting-hero-tag-primary",
    "setting-hero-tag-status", "setting-max-perfs", "setting-max-solo", "setting-payment-url", "setting-external-link-url",
    "sync-sheet-now-btn", "toggle-food-status-btn", "toggle-signup-status-btn",
]


def destinations():
    """{dest_id: [tab ids]} parsed from the ADMIN_DESTINATIONS table in admin-settings.js."""
    block = JS[JS.index("const ADMIN_DESTINATIONS"):JS.index("window.ADMIN_DESTINATIONS")]
    out = {}
    for m in re.finditer(r'id:\s*"(\w+)".*?tabs:\s*\[([^\]]*)\]', block):
        out[m.group(1)] = re.findall(r'"(\w+)"', m.group(2))
    return out


def test_five_destinations_in_spec_order():
    assert list(destinations()) == ["overview", "lineup", "people", "setup", "system"]
    assert 'id="admin-rail"' in HTML and 'id="admin-bottom-bar"' in HTML


def test_every_old_tab_still_has_button_panel_and_a_destination():
    dests = destinations()
    reachable = {t for tabs in dests.values() for t in tabs}
    for tab in OLD_TABS + NEW_TABS:
        assert f'data-tab="{tab}"' in HTML, tab
        assert f'id="panel-{tab}"' in HTML, tab
        assert tab in reachable, f"{tab} not in any destination"
        dest = next(d for d, tabs in dests.items() if tab in tabs)
        assert re.search(rf'data-tab="{tab}" data-dest="{dest}"', HTML), f"{tab} button must carry data-dest={dest}"


def test_every_old_setting_control_still_exists():
    for ident in OLD_SETTING_IDS:
        assert f'id="{ident}"' in HTML, ident


def test_two_clicks_rule_each_tab_is_one_destination_plus_one_subtab():
    dests = destinations()
    assert all(len(tabs) <= 4 for tabs in dests.values())


def test_new_settings_fields_present_and_saved():
    assert 'id="setting-max-audio-mb"' in HTML and 'id="setting-max-video-mb"' in HTML
    assert 'role="switch" id="setting-shorten-junior-names"' in HTML
    assert "Anika M." in HTML and "full names" in HTML
    for key in ("max_audio_upload_mb", "max_video_upload_mb", "shorten_junior_names", "event_passcode"):
        assert key in JS
    assert 'id="setting-event-passcode"' in HTML
    assert 'id="setting-announcement"' not in HTML  # announcement is console-only


def test_copy_fixes():
    for text in (HTML, JS, SETUP_JS, DASH_JS):
        assert "Staff" not in text
        assert "Cloud Backup" not in text and "One-Way Sync" not in text


def test_overview_has_readiness_totals_switches_presets_banner():
    for needle in ('id="readiness-card"', 'id="overview-totals"', 'id="overview-switches"', 'id="overview-presets"',
                   'id="overview-wizard-banner"', 'id="overview-wizard-resume"'):
        assert needle in HTML, needle
    for key in ("signup_enabled", "track_upload_enabled", "live_display_enabled"):
        assert key in DASH_JS
    assert "data-fix" in SETUP_JS  # readiness rows link to the place that fixes them


def test_lineup_and_system_use_the_backend_endpoints():
    for path in ("/api/admin/incoming", "/api/admin/tracks/", "/api/admin/snapshots", "/api/admin/events"):
        assert path in DASH_JS, path
    assert "/api/export-zip" in HTML
    assert "RESTORE" in DASH_JS  # typed confirmation for snapshot restore
    assert "manage-events-modal" in HTML and "clear-media-box" in HTML  # clear media (typed event id) is kept


def test_lineup_keeps_full_width_table_until_two_column_layout_fits():
    lineup_css = (STATIC / "css" / "admin-overview.css").read_text()
    assert re.search(
        r"@media\s*\(min-width:\s*1320px\)\s*\{\s*\.ad-lineup\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+15rem\s*;",
        lineup_css,
    )


def test_activity_log_shows_role():
    assert "item.role" in JS and "Role:" in JS


def test_login_errors_and_chooser():
    assert "Too many attempts, try again in" in JS
    assert "Retry-After" in JS and "retry_after" in JS
    assert "Cannot reach the server" in JS
    assert 'id="pin-go-console"' in HTML and 'href="/console"' in HTML and 'id="pin-go-admin"' in HTML


def test_accessibility_hooks():
    assert 'aria-current' in JS
    assert re.search(r'<nav id="admin-rail"[^>]*aria-label', HTML)
    assert "role=\"switch\"" in HTML and "role=\"switch\"" in DASH_JS
    assert ":focus-visible" in CSS and "--admin-accent: var(--accent-primary)" in CSS
    import pathlib
    tokens = (pathlib.Path(__file__).resolve().parents[1] / "app/static/css/tokens.css").read_text()
    assert "#C84B31" in tokens  # the light accent lives in the token file
    assert "min-height: 44px" in CSS
    assert "admin-shell.css" in HTML and "admin-dashboard.js" in HTML
