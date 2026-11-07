import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.db_service import db_service
from app.services.presets import PRESET_CATALOG


@pytest.mark.parametrize('preset', PRESET_CATALOG, ids=lambda p: p['id'])
def test_guest_shell_uses_preset_flags_on_initial_response(preset):
    for name, value in preset['flags'].items():
        db_service.set_app_setting(name, value)
    with TestClient(app) as client:
        response = client.get('/')
    assert response.status_code == 200
    shell = response.text.split('<nav aria-label="Main"', 1)[1].split('</nav>', 1)[0]
    flags = preset['flags']
    assert ('href="/signup"' in shell) == (flags.get('signup_enabled', True) or flags.get('food_signup_enabled', True))
    assert ('href="/live"' in shell) == flags.get('live_display_enabled', True)
    assert ('href="/schedule"' in shell) == flags.get('dashboard_enabled', True)
    assert 'href="/console"' not in shell
    assert 'href="/admin"' not in shell
    assert '<footer class="guest-admin-link"><a href="/admin">' in response.text
    assert ('href="/my-entry"' in shell) == (flags.get('performer_edits_enabled', True) or flags.get('track_upload_enabled', True) or flags.get('food_signup_enabled', True))
    assert '/static/js/nav.js' not in response.text


def test_guest_shell_has_active_page_and_does_not_interpolate_event_name():
    attack = '<script>alert("xss")</script>'
    db_service.set_app_setting('event_name', attack)
    with TestClient(app) as client:
        response = client.get('/signup')
    shell = response.text.split('<nav aria-label="Main"', 1)[1].split('</nav>', 1)[0]
    assert 'href="/signup" aria-current="page"' in shell
    assert attack not in shell
    assert response.headers['cache-control'].startswith('no-cache')


@pytest.mark.parametrize('path', ['/', '/signup', '/my-entry', '/schedule'])
def test_each_guest_route_serves_its_own_current_navigation(path):
    with TestClient(app) as client:
        response = client.get(path)
    assert response.status_code == 200
    shell = response.text.split('<nav aria-label="Main"', 1)[1].split('</nav>', 1)[0]
    assert f'href="{path}" aria-current="page"' in shell
    assert '/static/js/nav.js' not in response.text


@pytest.mark.parametrize(('alias', 'target'), [
    ('landing', '/'), ('index', '/my-entry'), ('signup', '/signup'),
    ('dashboard', '/schedule'), ('live', '/live'),
])
def test_guest_static_aliases_redirect_to_dynamic_pages(alias, target):
    with TestClient(app) as client:
        response = client.get(f'/static/{alias}.html', follow_redirects=False)
        css = client.get('/static/css/app.css')
    assert response.status_code == 307
    assert response.headers['location'] == target
    assert css.status_code == 200


def test_active_link_has_visible_style():
    with TestClient(app) as client:
        response = client.get('/signup')
    shell = response.text.split('<nav aria-label="Main"', 1)[1].split('</nav>', 1)[0]
    active = shell.split('href="/signup" aria-current="page"', 1)[1].split('</a>', 1)[0]
    assert 'bg-orange-600' in active


@pytest.mark.parametrize(('old', 'new'), [
    ('/dashboard', '/schedule'), ('/performer', '/my-entry'),
    ('/upload', '/my-entry'), ('/intake', '/my-entry'), ('/tracks', '/my-entry'),
])
def test_old_guest_routes_permanently_redirect(old, new):
    with TestClient(app) as client:
        response = client.get(old, follow_redirects=False)
    assert response.status_code == 301
    assert response.headers['location'] == new


def test_live_is_full_screen_without_guest_navigation():
    with TestClient(app) as client:
        response = client.get('/live')
    assert response.status_code == 200
    assert '<nav aria-label="Main"' not in response.text
    assert 'guest-admin-link' not in response.text


def test_single_destination_has_no_navigation_bar():
    for flag in ('signup_enabled', 'food_signup_enabled', 'dashboard_enabled',
                 'performer_edits_enabled', 'track_upload_enabled', 'live_display_enabled'):
        db_service.set_app_setting(flag, False)
    with TestClient(app) as client:
        response = client.get('/')
    assert '<nav aria-label="Main"' not in response.text
    assert '<footer class="guest-admin-link"><a href="/admin">' in response.text


@pytest.mark.parametrize(('old', 'new'), [
    ('/performer', '/my-entry'), ('/dashboard', '/schedule'),
    ('/tracks', '/my-entry'), ('/upload', '/my-entry'), ('/intake', '/my-entry'),
    ('/static/index.html', '/my-entry'), ('/static/dashboard.html', '/schedule'),
])
def test_redirects_preserve_encoded_query_for_guest_links(old, new):
    query = 'name=Arun%20%26%20Divya&food_item=rice%2Bbeans'
    with TestClient(app) as client:
        redirect = client.get(f'{old}?{query}', follow_redirects=False)
        page = client.get(f'{old}?{query}')
    assert redirect.headers['location'] == f'{new}?{query}'
    assert page.status_code == 200
    assert page.url.path == ('/schedule' if 'dashboard' in old else '/my-entry')
    assert page.url.params['name'] == 'Arun & Divya'
    assert page.url.params['food_item'] == 'rice+beans'


@pytest.mark.parametrize('path', ['/', '/signup', '/my-entry', '/schedule'])
def test_guest_pages_have_no_staff_links_except_the_footer_sign_in(path):
    with TestClient(app) as client:
        html = client.get(path).text
    assert 'href="/console"' not in html
    assert html.count('href="/admin"') == 1
    assert '<footer class="guest-admin-link"><a href="/admin">Admin sign-in</a></footer>' in html
    for legacy in ('Performer Hub', 'Transparency Dashboard', 'href="/dashboard"', 'href="/performer"',
                   'href="/upload"', 'href="/intake"', 'Staff'):
        assert legacy not in html, legacy
