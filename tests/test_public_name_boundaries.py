"""Public endpoints must not leak a junior's name through secondary fields."""
import json

from fastapi.testclient import TestClient

from app.main import app
from app.config import settings
from app.services.db_service import db_service


def test_public_endpoints_redact_junior_names_and_storage_fields():
    client = TestClient(app)
    result = client.post('/api/signup', json={
        'performer_name': 'Mira Narayan', 'contact_info': '6105550142',
        'age_group': 'Junior', 'guardian_name': 'Parent Narayan',
        'guardian_phone': '6105550142',
        'performances': [{'performance_type': 'Solo', 'song_title': 'Song'}],
    })
    assert result.status_code == 200, result.text
    entry_id = result.json()['entry_ids'][0]
    db_service.update_performance_field(entry_id, 'drive_file_name', 'Mira Narayan.mp3')
    cue = client.post(f'/api/set-active/{entry_id}', headers={'X-Admin-PIN': settings.admin_pin})
    assert cue.status_code == 200
    group = db_service.add_food_group('Mains')
    item = db_service.add_food_item('Rice', group)
    signup = client.post('/api/signup/food', json={
        'item_id': item, 'signer_name': 'Mira Narayan', 'signer_phone': '6105551234', 'dish_description': 'Rice',
    })
    assert signup.status_code == 200
    for path in ['/api/performances', '/api/stage-queue', '/api/live-status',
                 '/api/dashboard/food', '/api/signup/config']:
        response = client.get(path)
        assert response.status_code == 200, path
        assert 'Mira Narayan' not in json.dumps(response.json()), path
    live = client.get('/api/live-status').json()['now_performing']
    assert live['performer_name'] == 'Mira N.'
    assert not {'drive_file_name', 'age_group', 'extra_tags'} & live.keys()
    for path in ['/api/performances', '/api/stage-queue']:
        row = next(p for p in client.get(path).json() if p['entry_id'] == entry_id)
        assert not {'drive_file_name', 'age_group', 'partner_age_group', 'extra_tags'} & row.keys()
    profile = client.get('/api/performer/profile', params={'name': 'Mira Narayan'}).json()
    assert 'Mira Narayan' not in json.dumps(profile)
    assert profile['performer_name'] == 'Mira N.'
    assert profile['food_signup']['signup_id'] == signup.json()['signup_id']


def test_short_display_name_resolves_to_profile_without_exposing_full_name():
    client = TestClient(app)
    for name in ('Mira Narayan', 'Mira Nair'):
        db_service.create_performance(performer_name=name, performance_type='Solo',
                                      song_title='Song', age_group='Junior', created_via='signup')
    ambiguous = client.get('/api/performer/profile', params={'name': 'Mira N.'})
    assert ambiguous.status_code == 409
    assert 'Mira Narayan' not in ambiguous.text and 'Mira Nair' not in ambiguous.text
    db_service.create_performance(performer_name='Leela Thomas', performance_type='Solo',
                                  song_title='Other', age_group='Junior', created_via='signup')
    response = client.get('/api/performer/profile', params={'name': 'Leela T.'})
    assert response.status_code == 200
    assert len(response.json()['performances']) == 1
    assert 'Leela Thomas' not in response.text
    assert not {'age_group', 'partner_age_group', 'extra_tags'} & response.json()['performances'][0].keys()


def test_track_metadata_and_legacy_file_id_do_not_reveal_name(monkeypatch):
    from app.services.audio_service import audio_service
    client = TestClient(app)
    entry_id = db_service.create_performance(performer_name='Mira Narayan', performance_type='Solo',
                                             song_title='Song', age_group='Junior', created_via='signup')
    db_service.update_performance_field(entry_id, 'drive_file_id', 'Mira Narayan.mp3')
    monkeypatch.setattr(audio_service, 'get_track_metadata', lambda _: {
        'exists': True, 'filename': 'Mira Narayan.mp3', 'media_type': 'audio', 'stream_url': '/api/stream/' + entry_id,
    })
    meta = client.get('/api/track-info/' + entry_id)
    assert meta.status_code == 200
    assert meta.json()['performer_name'] == 'Mira N.'
    assert 'Mira Narayan' not in meta.text
    admin = client.get('/api/track-info/' + entry_id, headers={'X-Admin-PIN': settings.admin_pin})
    assert admin.json()['filename'] == 'Mira Narayan.mp3'
    profile = client.get('/api/performer/profile', params={'name': 'Mira N.'})
    assert 'Mira Narayan' not in profile.text
    assert profile.json()['performances'][0]['drive_file_id'] == 'available'


def test_duet_partner_new_act_uses_partner_demographics():
    client = TestClient(app)
    db_service.create_performance(
        performer_name='Adult Singer', age_group='Senior', contact_info='6105550101',
        performance_type='Duet', song_title='Duet', partner_name='Mira Narayan',
        partner_age_group='Junior', partner_phone='6105550102',
        partner_guardian_name='Rekha Narayan', partner_guardian_phone='6105550102',
    )
    response = client.post('/api/performer/performances', json={
        'performer_name': 'Mira N.', 'performance_type': 'Solo', 'song_title': 'New song',
    })
    assert response.status_code == 200, response.text
    act = db_service.get_performance(response.json()['entry_id'])
    assert act['performer_name'] == 'Mira Narayan'
    assert act['age_group'] == 'Junior'
    assert act['guardian_name'] == 'Rekha Narayan'
    assert act['guardian_phone'] == '6105550102'
    assert act['contact_info'] == '6105550102'
    assert 'Mira Narayan' not in client.get('/api/performances').text


def test_partner_with_missing_age_never_inherits_primary_age(monkeypatch):
    client = TestClient(app)
    db_service.create_performance(performer_name='Adult Singer', age_group='Senior',
                                  performance_type='Duet', song_title='Duet',
                                  partner_name='Unknown Partner')
    monkeypatch.setattr(db_service, 'get_participant', lambda _: None)
    response = client.post('/api/performer/performances', json={
        'performer_name': 'Unknown Partner', 'performance_type': 'Solo', 'song_title': 'New song',
    })
    assert response.status_code == 400
    assert 'age group is missing' in response.json()['detail']
    assert all(p['performer_name'] != 'Unknown Partner' for p in db_service.get_all_performances())


def test_partner_legacy_backfill_guardian_is_not_trusted():
    client = TestClient(app)
    db_service.create_performance(performer_name='Primary Person', age_group='Junior',
        guardian_name='Wrong Guardian', guardian_phone='6105550100', performance_type='Duet',
        song_title='Duet', partner_name='Mira Narayan', partner_age_group='Junior')
    participant = db_service.get_participant('Mira Narayan')
    db_service.participant_repo.update_participant(participant['participant_id'],
        guardian_name='Wrong Guardian', guardian_phone='6105550100')
    response = client.post('/api/performer/performances', json={
        'performer_name': 'Mira N.', 'performance_type': 'Solo', 'song_title': 'New song',
    })
    assert response.status_code == 400
    assert 'guardian details are missing' in response.json()['detail']
    assert all(p['performer_name'] != 'Mira Narayan' for p in db_service.get_all_performances())


def test_adult_privacy_preference_survives_added_act():
    client = TestClient(app)
    db_service.create_performance(performer_name='Asha Nair', age_group='Senior',
        performance_type='Duet', partner_name='Other Singer', partner_age_group='Senior',
        song_title='Duet', public_first_name_only=True)
    response = client.post('/api/performer/performances', json={
        'performer_name': 'Asha N.', 'performance_type': 'Solo', 'song_title': 'New song',
    })
    assert response.status_code == 200, response.text
    act = db_service.get_performance(response.json()['entry_id'])
    assert act['public_first_name_only']
    assert 'Asha Nair' not in client.get('/api/performances').text
