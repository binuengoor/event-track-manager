import uuid
from fastapi.testclient import TestClient
from app.config import settings
from app.main import app
from app.routers.auth import failure_limiter, MAX_FAILS_PER_CLIENT
from app.services.db_service import db_service


def test_food_edit_requires_name_and_full_phone_with_admin_override():
    unique = uuid.uuid4().hex[:8]
    group = db_service.add_food_group('Ownership ' + unique)
    first = db_service.add_food_item('Owner first ' + unique, group)
    second = db_service.add_food_item('Owner second ' + unique, group)
    legacy = db_service.add_food_item('Owner legacy ' + unique, group)
    client = TestClient(app)
    try:
        signup = client.post('/api/signup/food', json={
            'item_id': first, 'signer_name': 'Maya Example', 'signer_phone': '(610) 555-1234'
        }).json()['signup_id']
        route = '/api/signup/food/' + signup
        assert client.put(route, json={'item_id': second}).status_code == 403
        assert client.put(route, json={'item_id': second, 'signer_name': 'Maya Example', 'signer_phone': '1234'}).status_code == 403
        assert client.put(route, json={'item_id': second, 'signer_name': 'Other Person', 'signer_phone': '6105551234'}).status_code == 403
        assert client.put(route, json={'item_id': second, 'signer_name': ' maya  example ', 'signer_phone': '+1 610 555 1234'}).status_code == 200
        assert client.request('DELETE', route, json={'signer_name': 'Maya Example', 'signer_phone': '6105550000'}).status_code == 403
        assert client.request('DELETE', route, json={'signer_name': 'Maya Example', 'signer_phone': '6105551234'}).status_code == 200
        assert client.post('/api/signup/food', json={'item_id': legacy, 'signer_name': 'Old Claim'}).status_code == 400
        assert client.post('/api/signup/food', json={'item_id': legacy, 'signer_name': 'Old Claim', 'signer_phone': '1234'}).status_code == 400
        old = db_service.claim_food_item(legacy, 'Old Claim')
        old_route = '/api/signup/food/' + old
        assert client.request('DELETE', old_route, json={'signer_name': 'Old Claim', 'signer_phone': '6105551234'}).status_code == 403
        assert client.delete(old_route, headers={'X-Admin-PIN': settings.admin_pin}).status_code == 200
    finally:
        for item in (first, second, legacy):
            db_service.delete_food_item(item, force=True)
        db_service.delete_food_group(group)


def test_food_admin_override_uses_normal_rate_limiting():
    unique = uuid.uuid4().hex[:8]
    group = db_service.add_food_group('Admin proof ' + unique)
    item = db_service.add_food_item('Admin proof item ' + unique, group)
    signup = db_service.claim_food_item(item, 'Old Claim')
    client = TestClient(app)
    route = '/api/signup/food/' + signup
    failure_limiter.reset()
    try:
        for _ in range(MAX_FAILS_PER_CLIENT):
            assert client.delete(route, headers={'X-Admin-PIN': 'invalid'}).status_code == 401
        assert client.delete(route, headers={'X-Admin-PIN': settings.admin_pin}).status_code == 429
        failure_limiter.reset()
        assert client.delete(route, headers={'X-Admin-PIN': settings.admin_pin}).status_code == 200
    finally:
        failure_limiter.reset()
        db_service.delete_food_item(item, force=True)
        db_service.delete_food_group(group)
