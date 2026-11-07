const {test} = require('node:test');
const assert = require('node:assert/strict');
const {loadConsole} = require('./_console_loader.cjs');

test('reorder is locked by default and only draggable when unlocked and not searching', async () => {
  const {createReorderLock} = await loadConsole('reorder');
  const lock = createReorderLock();
  assert.equal(lock.locked, true);
  assert.equal(lock.canDrag(false), false);
  lock.toggle();
  assert.equal(lock.canDrag(false), true);
  assert.equal(lock.canDrag(true), false);
  lock.toggle();
  assert.equal(lock.locked, true);
});

test('moveItem renumbers sequence and does not mutate input', async () => {
  const {moveItem} = await loadConsole('reorder');
  const input = [{entry_id: 'A', sequence_order: 1}, {entry_id: 'B', sequence_order: 2}, {entry_id: 'C', sequence_order: 3}];
  const out = moveItem(input, 0, 2);
  assert.deepEqual(out.map(i => [i.entry_id, i.sequence_order]), [['B', 1], ['C', 2], ['A', 3]]);
  assert.equal(input[0].sequence_order, 1);
});

test('idle pusher debounces drops, pushes once after idle, flush pushes now', async () => {
  const {createIdlePusher, PUSH_IDLE_MS} = await loadConsole('reorder');
  assert.equal(PUSH_IDLE_MS, 5000);
  let timer = null; let pushes = 0; let cleared = 0;
  const p = createIdlePusher({push: async () => { pushes++; },
    setTimer: fn => { timer = fn; return 7; }, clearTimer: () => { cleared++; timer = null; }});
  p.touch(); p.touch();
  assert.equal(cleared, 1);
  assert.equal(pushes, 0);
  await timer();
  assert.equal(pushes, 1);
  assert.equal(p.pending, false);
  p.touch();
  assert.equal(p.flush(), true);
  assert.equal(pushes, 2);
  assert.equal(p.flush(), false);
});

test('login lockout message uses Retry-After then retry_after', async () => {
  const {retryAfterSeconds, lockoutMessage, describeLoginFailure} = await loadConsole('login');
  const headers = v => ({get: k => (k === 'Retry-After' ? v : null)});
  assert.equal(retryAfterSeconds(headers('300'), null), 300);
  assert.equal(retryAfterSeconds(headers(null), {retry_after: 120}), 120);
  assert.equal(retryAfterSeconds(headers(null), {}), null);
  assert.equal(lockoutMessage(300), 'Too many attempts, try again in 5 min');
  assert.equal(lockoutMessage(61), 'Too many attempts, try again in 2 min');
  assert.equal(lockoutMessage(5), 'Too many attempts, try again in 1 min');
  const r = await describeLoginFailure({status: 429, headers: headers('600'), json: async () => ({})});
  assert.equal(r.locked, true);
  assert.match(r.message, /try again in 10 min/);
  const bad = await describeLoginFailure({status: 401, headers: headers(null)});
  assert.equal(bad.locked, false);
  assert.doesNotMatch(bad.message, /Staff/);
});

function channel() { const sent = []; return {sent, postMessage: m => sent.push(m)}; }

test('announcement PUTs, posts to monitor and live, then relays redacted LIVE_STATE', async () => {
  const {createScreens} = await loadConsole('screens');
  const monitor = channel(); const live = channel(); const calls = [];
  const fetchRequest = async (url, opts) => {
    calls.push([url, opts && opts.method]);
    if (url === '/api/announcement') return {ok: true, json: async () => ({text: 'Dinner after act 12'})};
    return {ok: true, json: async () => ({status: 'live', announcement: 'Dinner after act 12', schedule: []})};
  };
  const s = createScreens({monitorChannel: monitor, liveChannel: live, fetchRequest, getHeaders: () => ({'X-Admin-PIN': '1'})});
  const out = await s.sendAnnouncement('  Dinner after act 12 ');
  assert.equal(out.persisted, true);
  assert.deepEqual(calls, [['/api/announcement', 'PUT'], ['/api/live-status', undefined]]);
  assert.deepEqual(monitor.sent, [{type: 'ANNOUNCEMENT', text: 'Dinner after act 12'}]);
  assert.equal(live.sent[0].type, 'ANNOUNCEMENT');
  assert.equal(live.sent[1].type, 'LIVE_STATE');
  assert.equal(live.sent[1].status.announcement, 'Dinner after act 12');
});

test('announcement still reaches local screens when the endpoint 404s; length capped at 140', async () => {
  const {createScreens, clampAnnouncement} = await loadConsole('screens');
  const monitor = channel(); const live = channel();
  const s = createScreens({monitorChannel: monitor, liveChannel: live, fetchRequest: async () => ({ok: false, status: 404})});
  const out = await s.sendAnnouncement('x'.repeat(200));
  assert.equal(out.persisted, false);
  assert.equal(monitor.sent[0].text.length, 140);
  assert.equal(live.sent.length, 1);
  assert.equal(clampAnnouncement(null), '');
});

test('fade-to-black and lyrics messages follow the contract', async () => {
  const {createScreens} = await loadConsole('screens');
  const monitor = channel();
  const s = createScreens({monitorChannel: monitor, liveChannel: null, fetchRequest: async () => ({ok: false})});
  s.setFadeBlack(true); s.setFadeBlack(0); s.sendLyrics('la la');
  assert.deepEqual(monitor.sent, [{type: 'FADE_BLACK', on: true}, {type: 'FADE_BLACK', on: false}, {type: 'LYRICS', text: 'la la'}]);
  assert.equal(await s.relayLiveState(), false);
});
