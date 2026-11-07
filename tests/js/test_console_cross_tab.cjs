const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../../app/static/js/console/offline-actions.js'), 'utf8');
const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;

function fakeLocks() {
  const tails = new Map();
  return {request(name, callback) {
    const previous = tails.get(name) || Promise.resolve();
    const operation = previous.then(callback);
    tails.set(name, operation.catch(() => {}));
    return operation;
  }};
}

test('two tabs serialize replay and preserve appended actions during fetch', async () => {
  const values = new Map();
  global.localStorage = {getItem:k=>values.get(k), setItem:(k,v)=>values.set(k,v)};
  Object.defineProperty(globalThis, 'navigator', {value:{locks:fakeLocks()}, configurable:true});
  const tab1 = await import(url+'#tab1');
  const tab2 = await import(url+'#tab2');
  const a = {type:'uncue',entryId:null,payload:{}};
  const b = {type:'set_active',entryId:'PK-002',payload:{}};
  const c = {type:'stage_notes',entryId:'PK-002',payload:{notes:'hello'}};
  await Promise.all([tab1.appendSynchronized(a),tab2.appendSynchronized(b)]);
  let release;
  const gate = new Promise(resolve=>{release=resolve});
  const requests = [];
  const fetch = async url => {requests.push(url); if (requests.length === 1) await gate; return {ok:true};};
  const run1 = tab1.drainSynchronized(()=>({}), fetch);
  const run2 = tab2.drainSynchronized(()=>({}), fetch);
  // Wait until the first replay has begun before adding the third action.
  while (!requests.length) await new Promise(resolve=>setImmediate(resolve));
  await tab2.appendSynchronized(c);
  release();
  assert.equal(await run1, 3);
  assert.equal(await run2, 0);
  assert.deepEqual(requests, ['/api/clear-active','/api/set-active/PK-002','/api/performance-notes/PK-002']);
  assert.deepEqual(tab1.getOfflineActions(), []);
});

test('unsupported locking fails safely without changing or sending queued actions', async () => {
  const values = new Map();
  global.localStorage = {getItem:k=>values.get(k), setItem:(k,v)=>values.set(k,v)};
  Object.defineProperty(globalThis, 'navigator', {value:{}, configurable:true});
  const tab = await import(url+'#unsupported');
  const action = {type:'uncue',entryId:null,payload:{}};
  tab.saveOfflineActions([action]);
  await assert.rejects(tab.appendSynchronized(action), /Web Locks/);
  await assert.rejects(tab.drainSynchronized(()=>({}), async()=>{throw Error('must not send');}), /Web Locks/);
  assert.deepEqual(tab.getOfflineActions(), [action]);
});
