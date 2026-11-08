const test = require('node:test');
const assert = require('node:assert/strict');
const {loadConsole} = require('./_console_loader.cjs');

const mem = () => { const m = {}; return {getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; }}; };

test('dbToLinear converts and clamps', async () => {
  const {dbToLinear} = await loadConsole('loudness');
  assert.equal(dbToLinear(0), 1);
  assert.ok(Math.abs(dbToLinear(6) - 1.9953) < 1e-3);
  assert.ok(Math.abs(dbToLinear(-6) - 0.5012) < 1e-3);
  assert.equal(dbToLinear(99), dbToLinear(9));
  assert.equal(dbToLinear('x'), 1);
});

test('gain store keeps values across reloads, ignores unmeasured, defaults to unity', async () => {
  const {createGainStore, dbToLinear} = await loadConsole('loudness');
  const storage = mem();
  const a = createGainStore(storage);
  a.update([{entry_id: 'E-1', gain_db: 4}, {entry_id: 'E-2', gain_db: null}]);
  assert.equal(a.linear('E-1'), dbToLinear(4));
  assert.equal(a.linear('E-2'), 1);
  const b = createGainStore(storage); // offline reload
  assert.equal(b.linear('E-1'), dbToLinear(4));
  b.update([{entry_id: 'E-1', gain_db: null}]); // a later unmeasured manifest keeps the old value
  assert.equal(b.linear('E-1'), dbToLinear(4));
  assert.equal(createGainStore({getItem() { throw new Error('x'); }, setItem() {}}).linear('E-1'), 1);
});

test('gain stage multiplies track gain by fade level and allows boosts', async () => {
  const {createGainStage} = await loadConsole('fade');
  const Ctx = function () {
    this.createMediaElementSource = () => ({connect() {}});
    this.createGain = () => ({gain: {value: 1}, connect() {}});
    this.destination = {};
  };
  const stage = createGainStage({}, Ctx);
  stage.setBase(2);
  assert.equal(stage.gain.gain.value, 2);
  stage.setGain(0.5);
  assert.equal(stage.gain.gain.value, 1);
  stage.setGain(0);
  assert.equal(stage.gain.gain.value, 0);
  stage.setGain(1);
  stage.setBase(0);            // invalid base falls back to unity
  assert.equal(stage.gain.gain.value, 1);
});
