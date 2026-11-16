from fastapi.testclient import TestClient
from app.main import app
from app.services.db_service import db_service
from app.services.audio_workflow_service import audio_workflow_service


def _junior(name='Mira Narayan'):
    return db_service.create_performance(performer_name=name, age_group='Junior',
        guardian_name='Rekha Narayan', guardian_phone='6105550102', contact_info='6105550102',
        performance_type='Duet', partner_name='Adult Singer', partner_age_group='Senior', song_title='Duet')


def test_signup_short_alias_uses_existing_person_and_privacy():
    client = TestClient(app)
    _junior()
    response = client.post('/api/signup', json={
        'performer_name': 'Mira Narayan (Rekha)', 'age_group': 'Junior', 'contact_info': '6105550102',
        'guardian_name': 'Rekha Narayan', 'guardian_phone': '6105550102',
        'performances': [{'performance_type': 'Solo', 'song_title': 'Song'}],
    })
    assert response.status_code == 200, response.text
    assert response.json()['performer_name'] == 'Mira Narayan (Rekha)'
    assert 'Rekha Narayan' not in response.text
    assert db_service.get_performance(response.json()['entry_ids'][0])['performer_name'] == 'Mira Narayan'
    again = client.post('/api/signup', json={
        'performer_name': 'Mira Narayan (Rekha)', 'age_group': 'Junior', 'contact_info': '6105550102',
        'guardian_name': 'Rekha Narayan', 'guardian_phone': '6105550102',
        'performances': [{'performance_type': 'Solo', 'song_title': 'Extra'}],
    })
    assert again.status_code == 400


def test_signup_alias_rejects_age_mismatch_and_keeps_namesakes_apart():
    client = TestClient(app)
    _junior()
    bad_age = client.post('/api/signup', json={
        'performer_name': 'Mira Narayan (Rekha)', 'age_group': 'Senior', 'contact_info': '6105550102',
        'performances': [{'performance_type': 'Solo', 'song_title': 'Song'}],
    })
    assert bad_age.status_code == 400
    # Same first name and last initial, different family: each shows its own parent.
    db_service.create_performance(performer_name='Mira Nair', age_group='Junior', guardian_name='Sunil Nair',
        guardian_phone='6105550103', contact_info='6105550103', performance_type='Solo', song_title='Song')
    names = client.get('/api/performer/names').json()
    assert 'Mira Narayan (Rekha)' in names and 'Mira Nair (Sunil)' in names
    assert len(db_service.get_all_performances()) == 2


def test_partner_alias_resolves_to_full_person():
    client = TestClient(app)
    _junior()
    response = client.post('/api/signup', json={
        'performer_name': 'New Singer', 'age_group': 'Senior', 'contact_info': '6105550103',
        'performances': [{'performance_type': 'Duet', 'partner_name': 'Mira Narayan (Rekha)', 'song_title': 'New song'}],
    })
    assert response.status_code == 200, response.text
    assert db_service.get_performance(response.json()['entry_ids'][0])['partner_name'] == 'Mira Narayan'
    assert 'Rekha Narayan' not in client.get('/api/performances').text


def test_public_upload_response_does_not_expose_junior_filename(monkeypatch):
    client = TestClient(app)
    entry_id = _junior()
    async def fake_upload(**kwargs):
        return {'status': 'success', 'performer_name': 'Mira Narayan', 'filename': 'Mira Narayan.mp3',
                'message': 'Uploaded Mira Narayan.mp3', 'entry_id': kwargs['entry_id']}
    monkeypatch.setattr(audio_workflow_service, 'process_track_upload', fake_upload)
    response = client.post('/api/upload', data={'entry_id': entry_id, 'submission_type': 'youtube'})
    assert response.status_code == 200, response.text
    assert 'Mira Narayan.mp3' not in response.text
    assert response.json()['performer_name'] == 'Mira Narayan (Rekha)'
    assert response.json()['filename'] == 'Backing track'


def test_group_partners_list_individually_and_profile_keeps_notes_private():
    client = TestClient(app)
    entry_id = db_service.create_performance(performer_name='Adult Singer', age_group='Senior',
        performance_type='Group', partner_name='Mira Narayan & Leela Thomas', partner_age_group='Junior',
        song_title='Group song', stage_notes='Sensitive private note')
    names = client.get('/api/performer/names').json()
    assert 'Mira Narayan' in names and 'Leela Thomas' in names
    assert 'Mira Narayan & Leela Thomas' not in names
    for name in ('Mira Narayan', 'Leela Thomas'):
        profile = client.get('/api/performer/profile', params={'name': name})
        assert profile.status_code == 200
        assert any(row['entry_id'] == entry_id for row in profile.json()['performances'])
        assert 'Sensitive private note' not in profile.text
        assert 'stage_notes' not in profile.json()['performances'][0]
    # A legacy combined display cannot silently choose either person.
    assert client.get('/api/performer/profile', params={'name': 'Mira Narayan & Leela Thomas'}).status_code == 409
    changed = client.put('/api/signup/performance/' + entry_id, json={'song_title': 'New title'})
    assert changed.status_code == 200
    assert db_service.get_performance(entry_id)['stage_notes'] == 'Sensitive private note'
    clear = client.put('/api/signup/performance/' + entry_id, json={'stage_notes': ''})
    assert clear.status_code == 200
    assert db_service.get_performance(entry_id)['stage_notes'] == ''


def test_edit_partner_alias_keeps_canonical_name_and_rejects_collision():
    client = TestClient(app)
    _junior()
    entry_id = db_service.create_performance(performer_name='Other Singer', age_group='Senior',
        performance_type='Solo', song_title='Existing')
    response = client.put('/api/signup/performance/' + entry_id, json={
        'performance_type': 'Duet', 'partner_name': 'Mira Narayan (Rekha)', 'partner_phone': '6105550102',
    })
    assert response.status_code == 200, response.text
    assert db_service.get_performance(entry_id)['partner_name'] == 'Mira Narayan'
    _junior('Mira Nair')
    response = client.put('/api/signup/performance/' + entry_id, json={'partner_name': 'Mira Nair (Rekha)'})
    assert response.status_code == 200, response.text
    assert db_service.get_performance(entry_id)['partner_name'] == 'Mira Nair'


def test_group_partner_quota_counts_each_person():
    client = TestClient(app)
    for song in ('First group', 'Second group'):
        db_service.create_performance(performer_name='Lead Singer', age_group='Senior',
            performance_type='Group', partner_name='Mira Narayan & Leela Thomas',
            partner_age_group='Junior', song_title=song)
    assert db_service.count_performances_for_performer('Mira Narayan')['total'] == 2
    response = client.post('/api/signup', json={
        'performer_name': 'Mira Narayan', 'age_group': 'Junior', 'contact_info': '6105550102',
        'guardian_name': 'Parent', 'guardian_phone': '6105550102',
        'performances': [{'performance_type': 'Solo', 'song_title': 'New song'}],
    })
    assert response.status_code == 400
    assert 'Maximum allowed' in response.json()['detail']


def test_existing_junior_partner_keeps_protection_after_original_removed():
    client = TestClient(app)
    original = _junior()
    response = client.post('/api/signup', json={
        'performer_name': 'New Singer', 'age_group': 'Senior', 'contact_info': '6105550103',
        'performances': [{'performance_type': 'Duet', 'partner_name': 'Mira Narayan (Rekha)',
                          'partner_same_person': True, 'song_title': 'New song'}],
    })
    assert response.status_code == 200, response.text
    act = db_service.get_performance(response.json()['entry_ids'][0])
    assert act['partner_name'] == 'Mira Narayan'
    assert act['partner_age_group'] == 'Junior'
    assert act['partner_guardian_name'] == 'Rekha Narayan'
    assert act['partner_guardian_phone'] == '6105550102'
    db_service.delete_performance(original)
    assert 'Rekha Narayan' not in client.get('/api/performances').text
    assert 'Mira Narayan (Rekha)' in client.get('/api/performances').text


def test_partner_no_never_attaches_existing_person():
    client = TestClient(app)
    _junior()
    response = client.post('/api/signup', json={
        'performer_name': 'New Singer', 'age_group': 'Senior', 'contact_info': '6105550103',
        'performances': [{'performance_type': 'Duet', 'partner_name': 'Mira Narayan (Rekha)',
                          'partner_same_person': False, 'partner_phone': '6105550109', 'song_title': 'New song'}],
    })
    assert response.status_code == 400
    assert 'Mira Narayan' not in response.text
    assert len(db_service.get_all_performances()) == 1


def test_conflicting_known_age_never_reclassifies_junior():
    client = TestClient(app)
    _junior()
    db_service.create_performance(performer_name='Mira Narayan', age_group='Senior',
                                  performance_type='Duet', partner_name='Other Singer', song_title='Legacy')
    response = client.post('/api/signup', json={
        'performer_name': 'Mira Narayan (Rekha)', 'age_group': 'Senior', 'contact_info': '6105550102',
        'performances': [{'performance_type': 'Solo', 'song_title': 'New song'}],
    })
    assert response.status_code == 400
    assert len(db_service.get_all_performances()) == 2


def test_suggestions_include_partner_and_food_only_without_private_details():
    client = TestClient(app)
    db_service.create_performance(performer_name='Lead Singer', age_group='Senior',
        performance_type='Duet', partner_name='Mira Narayan', partner_age_group='Junior',
        partner_guardian_name='Rekha Narayan', partner_guardian_phone='6105550102', song_title='Duet')
    group = db_service.add_food_group('Mains')
    item = db_service.add_food_item('Rice', group)
    food = client.post('/api/signup/food', json={'item_id': item, 'signer_name': 'Food Guest',
        'signer_phone': '6105550104'})
    assert food.status_code == 200
    config = client.get('/api/signup/config').json()
    names = {entry['name'] for entry in config['registered_entries']}
    assert 'Mira Narayan (Rekha)' in names and 'Food Guest' in names
    assert 'Rekha Narayan' not in str(config) and '6105550102' not in str(config)
    assert 'Food Guest' not in config['registered_performers']
