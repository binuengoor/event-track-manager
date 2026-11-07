const {test} = require('node:test');
const assert = require('node:assert/strict');
const {loadConsole} = require('./_console_loader.cjs');

test('transport walks IDLE -> CUED -> PLAYING -> FADING -> ENDED', async () => {
  const {createTransport} = await loadConsole('transport');
  const t = createTransport();
  const seen = [];
  t.subscribe((n) => seen.push(n));
  assert.equal(t.state, 'IDLE');
  t.send('CUE'); t.send('PLAY'); t.send('FADE_START'); t.send('FADE_DONE');
  assert.deepEqual(seen, ['CUED', 'PLAYING', 'FADING', 'ENDED']);
});

test('invalid transitions are ignored', async () => {
  const {createTransport} = await loadConsole('transport');
  const t = createTransport();
  t.send('PLAY');            // nothing cued
  assert.equal(t.state, 'IDLE');
  t.send('CUE');
  t.send('FADE_START');      // not playing
  assert.equal(t.state, 'CUED');
  t.send('PLAY'); t.send('PAUSE');
  assert.equal(t.state, 'PAUSED');
  t.send('PLAY'); t.send('FINISH');
  assert.equal(t.state, 'ENDED');
  t.send('PLAY');
  assert.equal(t.state, 'PLAYING');
  t.send('UNCUE');
  assert.equal(t.state, 'IDLE');
});

test('pause during a fade cancels it; live only while PLAYING or FADING', async () => {
  const {createTransport, isLive} = await loadConsole('transport');
  const t = createTransport('PLAYING');
  t.send('FADE_START');
  assert.equal(t.isLive(), true);
  t.send('PAUSE');
  assert.equal(t.state, 'PAUSED');
  assert.equal(isLive('PAUSED'), false);
  assert.equal(isLive('ENDED'), false);
});

const queue = [
  {entry_id: 'A', track_status: 'Uploaded'},
  {entry_id: 'B', track_status: 'Uploaded'},
  {entry_id: 'C', track_status: 'Pending'},
  {entry_id: 'D', track_status: 'Uploaded', performance_status: 'Performed'},
  {entry_id: 'E', track_status: 'Uploaded', performance_status: 'On Hold'},
  {entry_id: 'F', track_status: 'Uploaded'},
];

test('selecting a row during playback sets on-deck and never loads or stops', async () => {
  const {createTransport} = await loadConsole('transport');
  const {selectAct} = await loadConsole('deck-policy');
  for (const state of ['PLAYING', 'FADING']) {
    const t = createTransport(state);
    const calls = [];
    const result = selectAct({
      transport: t, item: queue[1], currentId: 'A',
      loadAct: () => calls.push('load'), setOnDeck: it => calls.push(`ondeck:${it.entry_id}`),
    });
    assert.equal(result, 'ondeck');
    assert.deepEqual(calls, ['ondeck:B']);
    assert.equal(t.state, state);
  }
});

test('selecting a row while not live loads it', async () => {
  const {createTransport} = await loadConsole('transport');
  const {selectAct} = await loadConsole('deck-policy');
  const t = createTransport('CUED');
  const calls = [];
  assert.equal(selectAct({transport: t, item: queue[1], currentId: 'A',
    loadAct: it => calls.push(`load:${it.entry_id}`), setOnDeck: () => calls.push('ondeck')}), 'loaded');
  assert.deepEqual(calls, ['load:B']);
});

test('cue next uses on-deck, else next eligible skipping done, held and unready', async () => {
  const {resolveCueNext, findNextEligible} = await loadConsole('deck-policy');
  assert.equal(resolveCueNext({queue, currentId: 'A', onDeckId: 'F'}).entry_id, 'F');
  assert.equal(resolveCueNext({queue, currentId: 'A', onDeckId: null}).entry_id, 'B');
  assert.equal(findNextEligible(queue, 'B').entry_id, 'F');
  assert.equal(findNextEligible(queue, 'F').entry_id, 'A'); // wraps
  assert.equal(resolveCueNext({queue, currentId: 'A', onDeckId: 'D'}).entry_id, 'B'); // done on-deck ignored
  assert.equal(findNextEligible([], null), null);
});
