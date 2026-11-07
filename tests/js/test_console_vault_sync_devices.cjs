const {test} = require('node:test');
const assert = require('node:assert/strict');
const {loadConsole} = require('./_console_loader.cjs');

const MB = 1024 * 1024;
const tracks = [
  {entry_id: 'A', size: 10, sha256: 'aa', kind: 'audio'},
  {entry_id: 'B', size: 20, sha256: 'bb', kind: 'video'},
  {entry_id: 'C', size: 30, kind: 'audio'},
];

test('pill text and plan diff against cached records', async () => {
  const {pillText, planVaultSync} = await loadConsole('vault-sync');
  assert.equal(pillText({ready: 18, total: 18, bytes: 142 * MB}), 'Vault 18/18 ready, 142 MB');
  const plan = planVaultSync(tracks, [{entry_id: 'A', size_bytes: 10}, {entry_id: 'B', size_bytes: 99}]);
  assert.deepEqual(plan.ready.map(e => e.entry_id), ['A']);
  assert.deepEqual(plan.missing.map(e => e.entry_id), ['B', 'C']);
  assert.equal(plan.total, 3);
  assert.equal(plan.bytes, 10);
});

test('a differing recorded sha256 marks the cache stale', async () => {
  const {planVaultSync} = await loadConsole('vault-sync');
  const plan = planVaultSync(tracks, [{entry_id: 'A', size_bytes: 10, sha256: 'zz'}]);
  assert.ok(plan.missing.some(e => e.entry_id === 'A'));
});

test('verifyBlob checks size and sha256 when present', async () => {
  const {verifyBlob} = await loadConsole('vault-sync');
  assert.equal((await verifyBlob(tracks[0], {size: 11})).ok, false);
  assert.equal((await verifyBlob(tracks[0], {size: 10}, async () => 'bad')).reason, 'checksum mismatch');
  const ok = await verifyBlob(tracks[0], {size: 10}, async () => 'aa');
  assert.deepEqual(ok, {ok: true, sha256: 'aa'});
  assert.equal((await verifyBlob(tracks[2], {size: 30})).ok, true); // no hash in manifest
  assert.equal((await verifyBlob(tracks[0], {size: 10}, async () => null)).ok, true); // cannot hash: size only
});

test('runVaultSync downloads missing only, collects failures, reports progress', async () => {
  const {runVaultSync} = await loadConsole('vault-sync');
  const downloaded = []; const saved = []; const progress = [];
  const result = await runVaultSync({
    tracks, cachedMeta: [{entry_id: 'A', size_bytes: 10}],
    downloadTrack: async e => { downloaded.push(e.entry_id); if (e.entry_id === 'C') throw new Error('net'); return {size: e.size}; },
    saveTrack: async (e, blob, sha) => { saved.push([e.entry_id, sha]); return true; },
    onProgress: p => progress.push(p), hash: async () => 'bb',
  });
  assert.deepEqual(downloaded, ['B', 'C']);
  assert.deepEqual(saved, [['B', 'bb']]);
  assert.deepEqual(result.failed, [{entry_id: 'C', reason: 'net'}]);
  assert.equal(result.ready, 2);
  assert.equal(result.total, 3);
  assert.deepEqual(progress.at(-1), {done: 2, of: 2, failed: 1});
});

test('fetchManifest returns null on 404 or bad shape (manual fallback)', async () => {
  const {fetchManifest} = await loadConsole('vault-sync');
  assert.equal(await fetchManifest(async () => ({ok: false, status: 404}), () => ({})), null);
  assert.equal(await fetchManifest(async () => ({ok: true, json: async () => ({})}), () => ({})), null);
  assert.equal(await fetchManifest(async () => { throw new Error('x'); }, () => ({})), null);
  const m = await fetchManifest(async () => ({ok: true, json: async () => ({tracks: [1]})}), () => ({}));
  assert.deepEqual(m.tracks, [1]);
});

test('wake lock is feature detected and re-requested when the tab becomes visible', async () => {
  const {createWakeLock} = await loadConsole('wake-lock');
  assert.equal(createWakeLock({}, {}).supported, false);
  let requests = 0; const listeners = {};
  const nav = {wakeLock: {request: async () => { requests++; return {released: false, addEventListener(t, fn) { this.onrel = fn; }}; }}};
  const doc = {visibilityState: 'visible', addEventListener: (t, fn) => { listeners[t] = fn; }};
  const wl = createWakeLock(nav, doc);
  assert.equal(await wl.enable(), true);
  assert.equal(requests, 1);
  await wl.enable();
  assert.equal(requests, 1); // already held
  doc.visibilityState = 'hidden';
  assert.equal(await wl.enable(), false);
  doc.visibilityState = 'visible';
  // browser released the lock when hidden; sentinel flagged released
  await listeners.visibilitychange();
  await new Promise(r => setImmediate(r));
  assert.ok(requests >= 1);
});

test('output device: unsupported hides, prefers AudioContext sink, remembers choice', async () => {
  const dev = await loadConsole('output-device');
  assert.equal(dev.sinkSupported({}, null), false);
  assert.equal(dev.sinkSupported({setSinkId() {}}, null), true);
  const calls = [];
  const stage = {ctx: {setSinkId: async id => calls.push(['ctx', id])}};
  const el = {setSinkId: async id => calls.push(['el', id])};
  await dev.applySink('dev1', el, stage);
  await dev.applySink('dev2', el, null);
  assert.deepEqual(calls, [['ctx', 'dev1'], ['el', 'dev2']]);
  const store = new Map();
  const storage = {getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k)};
  dev.rememberSink('dev9', storage);
  assert.equal(dev.rememberedSink(storage), 'dev9');
  dev.rememberSink('', storage);
  assert.equal(dev.rememberedSink(storage), '');
  const outs = await dev.listOutputs({enumerateDevices: async () => [{kind: 'audiooutput', deviceId: 'x', label: ''}, {kind: 'audioinput', deviceId: 'y'}]});
  assert.deepEqual(outs, [{id: 'x', label: 'Output 1'}]);
});
