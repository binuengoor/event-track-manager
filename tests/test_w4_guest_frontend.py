"""Guest frontend (W4): static checks on the shipped HTML/JS/CSS plus a few rendered-page checks.

There is no browser in the test environment, so behaviour is checked through the markup and source
that the browser runs, and with `node --check` when node is available.
"""
import re
import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app

STATIC = Path(__file__).resolve().parent.parent / 'app' / 'static'
JS = STATIC / 'js'


def read(path):
    return path.read_text(encoding='utf-8')


GUEST_HTML = ['landing.html', 'signup.html', 'index.html', 'dashboard.html']
GUEST_JS = ['signup.js', 'intake.js', 'dashboard.js']


@pytest.mark.parametrize('name', GUEST_HTML)
def test_guest_templates_have_no_staff_links_or_old_footers(name):
    html = read(STATIC / name)
    assert 'href="/console"' not in html
    assert 'href="/admin"' not in html
    assert '<footer' not in html
    for legacy in ('Performer Hub', 'Transparency Dashboard', 'View Dashboard', 'Paattukoottam 2026',
                   'href="/performer"', 'href="/dashboard"'):
        assert legacy not in html, legacy


@pytest.mark.parametrize('name', GUEST_JS)
def test_guest_scripts_use_new_routes_and_copy(name):
    src = read(JS / name)
    for legacy in ('/performer?', '"/dashboard', 'href="/dashboard', 'Transparency Dashboard', 'Paattukoottam 2026', 'Performer Hub'):
        assert legacy not in src, legacy


@pytest.mark.skipif(shutil.which('node') is None, reason='node not installed')
@pytest.mark.parametrize('name', GUEST_JS + ['nav.js'])
def test_guest_scripts_parse(name):
    subprocess.run(['node', '--check', str(JS / name)], check=True)


def test_nav_js_says_admin_not_staff():
    src = read(JS / 'nav.js')
    assert 'Staff' not in src
    assert '>Admin</p>' in src
    assert "'/my-entry'" in src and "'/schedule'" in src


# ---------------------------------------------------------------------------------------- sign-up
def test_signup_offers_perform_dish_both_with_stepper_and_inline_errors():
    html = read(STATIC / 'signup.html')
    for value in ('perform', 'dish', 'both'):
        assert f'name="signup_choice" value="{value}"' in html
    for label in ('Perform', 'Bring a dish', 'Both'):
        assert f'<span>{label}</span>' in html
    assert 'id="stepper"' in html and 'id="step-status"' in html
    errors = re.findall(r'<p id="err-[a-z-]+"[^>]*>', html)
    assert len(errors) >= 8
    for tag in errors:
        assert 'role="alert"' in tag and 'aria-live="polite"' in tag
    # Partner fields live in the act step and start hidden; so does the guardian block.
    assert 'id="partner-box" class="gf-field" hidden' in html
    assert 'id="guardian-container" class="gf-box" hidden' in html


def test_signup_js_uses_registered_entries_and_partner_wording():
    src = read(JS / 'signup.js')
    assert 'registered_entries' in src
    assert 'registered_performers' in src          # fallback when the field is absent
    assert 'No, new act' in src and 'Edit ${id}' in src
    html = read(STATIC / 'signup.html')
    assert 'Yes, same person' in html and 'No, someone else' in html
    assert 'Same person?' in src
    # Phone pre-fill goes through the exact-name profile API only.
    assert '/api/performer/profile?name=' in src
    assert 'registered_performers.filter' not in src


def test_signup_done_card_has_three_actions_and_event_name_from_config():
    html = read(STATIC / 'signup.html')
    assert 'Upload track now' in html and 'Add another act' in html and 'Add a dish' in html
    src = read(JS / 'signup.js')
    assert 'config.event_name' in src or 'c.event_name' in src
    assert '/my-entry?name=' in src
    assert 'Paattukoottam' not in src


def test_acoustic_hides_the_upload_hint():
    src = read(JS / 'signup.js')
    assert 'upload-hint' in src and '$("acoustic").checked' in src


# ---------------------------------------------------------------------------------------- upload
def test_upload_uses_event_info_limits_and_no_legacy_formats():
    src = read(JS / 'intake.js')
    assert 'max_audio_upload_mb' in src and 'max_video_upload_mb' in src and 'allowed_extensions' in src
    assert 'maxAudioMb = audioLimit > 0 ? audioLimit : 200' in src
    assert 'maxVideoMb = videoLimit > 0 ? videoLimit : 500' in src
    assert "DEFAULT_ALLOWED_EXTS = ['mp3', 'wav', 'm4a', 'mp4', 'webm']" in src
    # .mov may appear only in the list used to recognise (and then reject) video-like names.
    assert not re.search(r'\.(mov|mkv|aac)\b', src)
    assert 'accept=".mov' not in read(STATIC / 'index.html')
    assert '.aac' not in read(STATIC / 'index.html')


def test_upload_reports_real_byte_progress_and_offers_try_again():
    src = read(JS / 'intake.js')
    assert 'new XMLHttpRequest()' in src
    assert 'xhr.upload.onprogress' in src
    assert "fetch('/api/upload'" not in src
    html = read(STATIC / 'index.html')
    assert 'id="retry-upload-btn"' in html and 'Try again' in html
    assert 'id="cancel-upload-btn"' in html
    assert 'retry-upload-btn' in src


def test_upload_accepts_only_the_listed_link_hosts():
    src = read(JS / 'intake.js')
    for host in ('soundcloud.com', 'on.soundcloud.com', 'youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'):
        assert f"'{host}'" in src, host
    assert "ytUrl.includes('youtube.com')" not in src


# ---------------------------------------------------------------------------------------- schedule
def test_schedule_markup_has_pressed_buttons_offline_banner_and_no_status_badges():
    html = read(STATIC / 'dashboard.html')
    assert re.search(r'<button type="button" id="tab-songs-btn" aria-pressed="true"', html)
    assert re.search(r'<button type="button" id="tab-food-btn" aria-pressed="false"', html)
    assert 'id="offline-banner"' in html and 'You are offline. Showing the schedule as of' in html
    src = read(JS / 'dashboard.js')
    for banned in ('Pending', 'Needs track', 'Junior', 'age_group', 'track_status'):
        assert banned not in src, banned
    assert 'sequence_order' in src


def test_schedule_orders_unscheduled_last_and_does_not_split_partners():
    src = read(JS / 'dashboard.js')
    assert 'if (sa !== null) return -1' in src
    assert 'display_partner' not in src and 'link_performer' not in src
    assert '`${name} & ${partner}`' in src


def test_view_transition_rule_is_wrapped_for_reduced_motion():
    css = read(STATIC / 'css' / 'guest-navigation.css')
    assert re.search(r'@media \(prefers-reduced-motion: no-preference\)\s*\{\s*@view-transition \{ navigation: auto; \}', css)


# ---------------------------------------------------------------------------------------- dish wording
def test_dish_boards_say_yours_for_the_owner_and_release_asks_to_confirm():
    board = read(JS / 'dashboard.js')
    assert 'Yours' in board and 'Taken' in board
    entry = read(JS / 'intake.js')
    assert "isOwn ? 'Yours' : 'Open'" in entry
    assert 'confirm(`Release' in entry


# ---------------------------------------------------------------------------------------- redirects and rendering
@pytest.mark.parametrize('old', ['/upload', '/intake'])
def test_upload_and_intake_redirect_301_to_my_entry_with_query(old):
    with TestClient(app) as client:
        r = client.get(f'{old}?name=Maya%20Nair&food_item=x', follow_redirects=False)
    assert r.status_code == 301
    assert r.headers['location'] == '/my-entry?name=Maya%20Nair&food_item=x'


def test_rendered_guest_pages_use_the_configured_brand_not_a_hard_coded_one():
    from app.services.db_service import db_service
    db_service.set_app_setting('header_brand_title', 'Spring <Gala>')
    with TestClient(app) as client:
        html = client.get('/signup').text
    assert 'Spring &lt;Gala&gt;' in html
    assert 'EMA Paattukoottam' not in html
    assert 'Spring <Gala>' not in html
