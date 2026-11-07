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
    assert ('href="/dashboard"' in shell) == flags.get('dashboard_enabled', True)
    assert 'href="/console"' not in shell
    assert 'href="/admin"' in shell
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


@pytest.mark.parametrize('path', ['/', '/signup', '/performer', '/dashboard', '/live'])
def test_each_guest_route_serves_its_own_current_navigation(path):
    with TestClient(app) as client:
        response = client.get(path)
    assert response.status_code == 200
    shell = response.text.split('<nav aria-label="Main"', 1)[1].split('</nav>', 1)[0]
    assert f'href="{path}" aria-current="page"' in shell
    assert '/static/js/nav.js' not in response.text


@pytest.mark.parametrize(('alias', 'target'), [
    ('landing', '/'), ('index', '/performer'), ('signup', '/signup'),
    ('dashboard', '/dashboard'), ('live', '/live'),
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
