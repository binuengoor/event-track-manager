const {test} = require('node:test');
const assert = require('node:assert/strict');
const {loadConsole} = require('./_console_loader.cjs');

function fakeClock() {
  let t = 0; let next = null;
  return {now: () => t, schedule: fn => { next = fn; return 1; }, cancelSchedule: () => { next = null; },
    advance(ms) { t += ms; const fn = next; next = null; if (fn) fn(); }, get pending() { return next !== null; }};
}

test('hold-to-confirm fires after the full hold only', async () => {
  const {createHoldConfirm} = await loadConsole('hold-confirm');
  const c = fakeClock(); const progress = []; let confirmed = 0;
  const h = createHoldConfirm({duration: 1000, now: c.now, schedule: c.schedule, cancelSchedule: c.cancelSchedule,
    onProgress: p => progress.push(p), onConfirm: () => confirmed++});
  h.start();
  c.advance(500);
  assert.equal(confirmed, 0);
  assert.ok(progress.includes(0.5));
  c.advance(500);
  assert.equal(confirmed, 1);
  assert.equal(progress.at(-1), 1);
});

test('releasing early cancels and resets progress', async () => {
  const {createHoldConfirm} = await loadConsole('hold-confirm');
  const c = fakeClock(); let confirmed = 0; let last = -1; let cancelled = 0;
  const h = createHoldConfirm({duration: 1000, now: c.now, schedule: c.schedule, cancelSchedule: c.cancelSchedule,
    onProgress: p => { last = p; }, onConfirm: () => confirmed++, onCancel: () => cancelled++});
  h.start(); c.advance(900); h.cancel();
  assert.equal(last, 0); assert.equal(cancelled, 1);
  c.advance(500);
  assert.equal(confirmed, 0);
  assert.equal(h.active, false);
});

test('bindHoldButton: click and bare Enter keydown never confirm; held Enter does', async () => {
  const {createHoldConfirm, bindHoldButton} = await loadConsole('hold-confirm');
  const c = fakeClock(); let confirmed = 0;
  const h = createHoldConfirm({duration: 1000, now: c.now, schedule: c.schedule, cancelSchedule: c.cancelSchedule, onConfirm: () => confirmed++});
  const handlers = {};
  const button = {addEventListener: (t, fn) => { handlers[t] = fn; }};
  bindHoldButton(button, h);
  handlers.click({preventDefault() {}});
  assert.equal(confirmed, 0);
  const ev = (key, repeat = false) => ({key, repeat, preventDefault() {}, stopPropagation() {}});
  handlers.keydown(ev('Enter')); c.advance(300); handlers.keyup(ev('Enter'));
  c.advance(1000);
  assert.equal(confirmed, 0);
  handlers.keydown(ev('Enter')); handlers.keydown(ev('Enter', true)); c.advance(1000);
  assert.equal(confirmed, 1);
});

test('fader ramps linearly to zero over 3 s then calls onDone once', async () => {
  const {createFader, FADE_MS} = await loadConsole('fade');
  assert.equal(FADE_MS, 3000);
  const c = fakeClock(); const levels = []; let done = 0;
  const f = createFader({duration: FADE_MS, now: c.now, schedule: c.schedule, cancelSchedule: c.cancelSchedule,
    setLevel: v => levels.push(v), onDone: () => done++});
  assert.equal(f.start(1), true);
  assert.equal(f.start(1), false);
  c.advance(1500);
  assert.equal(levels.at(-1), 0.5);
  assert.equal(done, 0);
  c.advance(1500);
  assert.equal(levels.at(-1), 0);
  assert.equal(done, 1);
  assert.equal(f.active, false);
});

test('fader cancel stops without onDone', async () => {
  const {createFader} = await loadConsole('fade');
  const c = fakeClock(); let done = 0;
  const f = createFader({now: c.now, schedule: c.schedule, cancelSchedule: c.cancelSchedule, setLevel() {}, onDone: () => done++});
  f.start(1); c.advance(1000); f.cancel(); c.advance(5000);
  assert.equal(done, 0);
});

test('gain stage wires element -> gain -> destination and clamps', async () => {
  const {createGainStage} = await loadConsole('fade');
  const log = [];
  class Ctx {
    constructor() { this.destination = 'dest'; this.state = 'suspended'; }
    createMediaElementSource(el) { return {connect: n => log.push(['src', el, n.tag])}; }
    createGain() { return {tag: 'gain', gain: {value: 1}, connect: d => log.push(['gain', d])}; }
    resume() { this.state = 'running'; return Promise.resolve(); }
  }
  const stage = createGainStage('el', Ctx);
  assert.deepEqual(log, [['src', 'el', 'gain'], ['gain', 'dest']]);
  stage.setGain(2); assert.equal(stage.gain.gain.value, 1);
  stage.setGain(-1); assert.equal(stage.gain.gain.value, 0);
  await stage.resume(); assert.equal(stage.ctx.state, 'running');
  assert.equal(createGainStage('el', undefined), null);
  assert.equal(createGainStage('el', class { constructor() { throw new Error('no'); } }), null);
});

test('bindHoldButton with enabled() false leaves native click (Undo mode)', async () => {
  const {createHoldConfirm, bindHoldButton} = await loadConsole('hold-confirm');
  const c = fakeClock(); let confirmed = 0; let prevented = 0; let started = 0;
  const h = createHoldConfirm({now: c.now, schedule: c.schedule, cancelSchedule: c.cancelSchedule, onConfirm: () => confirmed++});
  const origStart = h.start; h.start = () => { started++; origStart(); };
  const handlers = {};
  bindHoldButton({addEventListener: (t, fn) => { handlers[t] = fn; }}, h, {enabled: () => false});
  handlers.keydown({key: 'Enter', repeat: false, preventDefault: () => prevented++, stopPropagation() {}});
  handlers.pointerdown({button: 0});
  handlers.click({preventDefault: () => prevented++});
  assert.equal(prevented, 0);
  assert.equal(started, 0);
});
