const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {plainScript} = require('./_module_source.cjs');

function playerBarContext() {
  return vm.createContext({
    S: {currentCuedItem: null, currentCuedObjectUrl: null, wavesurfer: null},
    hooks: {}, transport: {send() {}}, fader: {cancel() {}}, setOutputLevel() {},
    updatePlayPauseButton() {}, updateTransportUi() {}, broadcastStageMonitor() {}, relayLiveSoon() {},
    localStorage: {removeItem() {}}, URL: {revokeObjectURL() {}}, document: {getElementById: () => null, querySelector: () => null},
    window: {},
  });
}

test('remaining display formats fractional time, pads minutes, and clamps at zero', () => {
  const context = playerBarContext();
  vm.runInContext(plainScript('util.js', 'player-bar.js'), context);
  assert.equal(context.formatRemainingTime(29, 180), '-02:31');
  assert.equal(context.formatRemainingTime(0.2, 60), '-01:00');
  assert.equal(context.formatRemainingTime(62, 60), '-00:00');
  assert.equal(context.formatRemainingTime(0, 6000), '-100:00');
});

test('remaining display handles invalid duration and updates its own readout', () => {
  const context = playerBarContext();
  vm.runInContext(plainScript('util.js', 'player-bar.js'), context);
  assert.equal(context.formatRemainingTime(1, 0), '--:--');
  assert.equal(context.formatRemainingTime(1, NaN), '--:--');
  const node = {textContent: ''};
  context.document.getElementById = id => id === 'player-remaining-time' ? node : null;
  context.updatePlayerRemainingTime(29, 180);
  assert.equal(node.textContent, '-02:31');
});

test('acoustic and cleared cues ignore stale WaveSurfer time events', () => {
  const context = playerBarContext();
  vm.runInContext(plainScript('util.js', 'player-bar.js'), context);
  const values = {'player-current-time': 'Live', 'player-duration': 'Stage', 'player-remaining-time': '--:--'};
  context.document.getElementById = id => values[id] === undefined ? null : {set textContent(value) { values[id] = value; }};
  assert.equal(context.updatePlayerTimeReadouts(0.2, 1, {track_status: 'Acoustic'}, true), false);
  assert.deepEqual(values, {'player-current-time': 'Live', 'player-duration': 'Stage', 'player-remaining-time': '--:--'});
  assert.equal(context.updatePlayerTimeReadouts(0.2, 1, null, true), false);
  assert.deepEqual(values, {'player-current-time': 'Live', 'player-duration': 'Stage', 'player-remaining-time': '--:--'});
});

test('audio events update remaining time and reset/acoustic states clear it', () => {
  const root = path.join(__dirname, '../../app/static');
  const audio = fs.readFileSync(path.join(root, 'js/console/audio-engine.js'), 'utf8');
  const player = fs.readFileSync(path.join(root, 'js/console/player-bar.js'), 'utf8');
  const deck = fs.readFileSync(path.join(root, 'js/console/deck.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
  assert.match(html, /id="player-remaining-time"/);
  assert.match(html, /id="player-current-time" aria-label="Elapsed time"/);
  assert.match(html, /id="player-duration" aria-label="Total duration"/);
  assert.match(html, /id="player-remaining-time" aria-label="Time remaining"/);
  assert.match(audio, /timeupdate'[\s\S]*?updatePlayerTimeReadouts\(currentTime[\s\S]*?return/);
  assert.match(audio, /ready'[\s\S]*?updatePlayerTimeReadouts\([\s\S]*?return/);
  assert.match(player, /player-remaining-time[\s\S]*?--:--/);
  assert.match(deck, /player-remaining-time[\s\S]*?--:--/);
});
