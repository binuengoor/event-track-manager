const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function loadVault() {
  const source = fs.readFileSync(path.join(__dirname, '../../app/static/js/console/vault-store.js'), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

test('vault module reads existing records and stores metadata with original schema', async () => {
  const records = new Map([['PK-001', {entry_id: 'PK-001', blob: 'existing'}]]);
  let dbName, version, storeName;
  const operation = (fn) => {
    const request = {};
    queueMicrotask(() => {request.result = fn(); request.onsuccess();});
    return request;
  };
  const store = {
    get: (id) => operation(() => records.get(id)),
    put: (record) => operation(() => {records.set(record.entry_id, record); return record.entry_id;}),
    getAllKeys: () => operation(() => [...records.keys()]),
  };
  const db = {transaction(name) {storeName = name; return {objectStore: () => store};}};
  global.window = {indexedDB: true};
  global.indexedDB = {open(name, v) {
    dbName = name; version = v;
    const request = {};
    queueMicrotask(() => {request.result = db; request.onsuccess();});
    return request;
  }};
  const vault = await loadVault();
  assert.equal((await vault.getCachedTrack('PK-001')).blob, 'existing');
  const blob = {size: 123, type: 'audio/wav'};
  assert.equal(await vault.saveCachedTrack('PK-002', blob, {version: 'v2'}), true);
  assert.deepEqual([...await vault.getVaultTrackIds()], ['PK-001', 'PK-002']);
  assert.equal(records.get('PK-002').size_bytes, 123);
  assert.equal(records.get('PK-002').content_type, 'audio/wav');
  assert.equal(records.get('PK-002').version, 'v2');
  assert.equal(dbName, 'PaattukoottamAudioVault');
  assert.equal(version, 1);
  assert.equal(storeName, 'audio_tracks');
});
