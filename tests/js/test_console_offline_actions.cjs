const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function load() {
  const source = fs.readFileSync(path.join(__dirname, '../../app/static/js/console/offline-actions.js'), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

test('queue keeps existing storage key and tolerates invalid JSON', async () => {
  const values = new Map();
  global.localStorage = {getItem: k => values.get(k), setItem: (k,v) => values.set(k,v)};
  const {getOfflineActions, saveOfflineActions} = await load();
  values.set('paattukoottam_offline_actions', '{bad');
  assert.deepEqual(getOfflineActions(), []);
  const queue = [{type:'update_status', entryId:'PK-001', payload:{status:'Done'}, timestamp:123}];
  saveOfflineActions(queue);
  assert.deepEqual(JSON.parse(values.get('paattukoottam_offline_actions')), queue);
  assert.deepEqual(getOfflineActions(), queue);
});

test('replay preserves order and keeps failed or unknown actions for retry', async () => {
  const {replayOfflineActions} = await load();
  const actions = [
    {type:'update_status', entryId:'PK-001', payload:{status:'Done'}},
    {type:'stage_notes', entryId:'PK-002', payload:{notes:'Hi'}},
    {type:'set_active', entryId:'PK-003', payload:{}},
    {type:'uncue', entryId:null, payload:{}},
    {type:'reorder', entryId:null, payload:{order:['PK-003']}},
    {type:'unknown', entryId:'PK-004', payload:{}},
  ];
  const requests = [];
  const fetch = async (url, options) => {
    requests.push({url, options});
    if (url.includes('performance-notes')) throw Error('offline');
    return {ok: !url.includes('set-active')};
  };
  const remaining = await replayOfflineActions(actions, () => ({'X-Admin-PIN':'test'}), fetch);
  assert.deepEqual(requests.map(r => r.url), ['/api/status/PK-001', '/api/performance-notes/PK-002', '/api/set-active/PK-003', '/api/clear-active', '/api/reorder-queue']);
  assert.deepEqual(remaining, [actions[1], actions[2], actions[5]]);
  assert.equal(requests[0].options.headers['X-Admin-PIN'], 'test');
  assert.deepEqual(JSON.parse(requests[0].options.body), {status:'Done'});
});

test('console imports the replay module and service worker precaches it', () => {
  const root = path.join(__dirname, '../../app/static');
  const consoleScript = fs.readFileSync(path.join(root, 'js/admin.js'), 'utf8');
  const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.match(consoleScript, /import\s*\{[^}]*replayOfflineActions[^}]*\}\s*from\s*["']\.\/console\/offline-actions\.js["']/);
  assert.match(worker, /['"]\/static\/js\/console\/offline-actions\.js['"]/);
});

test('production replay stops at first failure and retains later actions in order', async () => {
  const {drainOfflineActions, saveOfflineActions, getOfflineActions} = await load();
  const values = new Map();
  global.localStorage = {getItem: k => values.get(k), setItem: (k,v) => values.set(k,v)};
  const acts = [
    {type:'update_status', entryId:'PK-001', payload:{status:'Playing'}},
    {type:'update_status', entryId:'PK-001', payload:{status:'Done'}},
  ];
  saveOfflineActions(acts);
  const calls = [];
  assert.equal(await drainOfflineActions(() => ({}), async (url, opts) => {calls.push(opts); return {ok:false};}), 0);
  assert.equal(calls.length, 1);
  assert.deepEqual(getOfflineActions(), acts);
  assert.equal(await drainOfflineActions(() => ({}), async (url, opts) => {calls.push(opts); return {ok:true};}), 2);
  assert.deepEqual(calls.slice(1).map(x=>JSON.parse(x.body).status), ['Playing', 'Done']);
  assert.deepEqual(getOfflineActions(), []);
});

test('production replay keeps actions added during a pending request and avoids overlapping syncs', async () => {
  const {drainOfflineActions, saveOfflineActions, getOfflineActions} = await load();
  const values = new Map();
  global.localStorage = {getItem: k => values.get(k), setItem: (k,v) => values.set(k,v)};
  const first = {type:'uncue', entryId:null, payload:{}};
  const added = {type:'set_active', entryId:'PK-002', payload:{}};
  saveOfflineActions([first]);
  let release;
  const gate = new Promise(resolve => {release = resolve;});
  const calls = [];
  const fetch = async url => {calls.push(url); if (calls.length === 1) await gate; return {ok:true};};
  const firstRun = drainOfflineActions(() => ({}), fetch);
  const secondRun = drainOfflineActions(() => ({}), fetch);
  saveOfflineActions([...getOfflineActions(), added]);
  release();
  assert.equal(await firstRun, 2);
  assert.equal(await secondRun, 2);
  assert.deepEqual(calls, ['/api/clear-active', '/api/set-active/PK-002']);
  assert.deepEqual(getOfflineActions(), []);
});
