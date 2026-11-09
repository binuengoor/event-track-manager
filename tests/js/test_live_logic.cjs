const { test } = require('node:test');
const assert = require('node:assert/strict');
const L = require('../../app/static/js/live/live-logic.js');

const act = (n, extra = {}) => ({ entry_id: `e${n}`, sequence_order: n, performer_name: `P${n}`, song_title: `S${n}`, ...extra });
const FUTURE = Date.now() + 3600e3, PAST = Date.now() - 3600e3;

test('selectState: off wins over everything', () => {
  assert.equal(L.selectState({ live_display_enabled: false, now_performing: act(1) }, Date.now(), PAST), 'off');
});
test('selectState: live when an act is on stage, even before the start time', () => {
  assert.equal(L.selectState({ now_performing: act(1), upcoming: [act(2)] }, Date.now(), FUTURE), 'live');
});
test('selectState: prestart only when nothing is on stage and start is in the future', () => {
  assert.equal(L.selectState({ now_performing: null, upcoming: [act(1)] }, Date.now(), FUTURE), 'prestart');
  assert.equal(L.selectState({ now_performing: null, upcoming: [act(1)] }, Date.now(), PAST), 'live');
});
test('selectState: ended when all acts are done, and it never goes back to Now on Stage or countdown', () => {
  const data = { now_performing: null, up_next: [], upcoming: [], on_hold: [], performed: [act(1), act(2)] };
  assert.equal(L.selectState(data, Date.now(), PAST), 'ended');
  assert.equal(L.selectState(data, Date.now(), FUTURE), 'ended');
});
test('selectState: not ended while acts remain or on hold; not ended with zero performed', () => {
  assert.equal(L.selectState({ performed: [act(1)], on_hold: [act(2)] }, Date.now(), PAST), 'live');
  assert.equal(L.selectState({ performed: [], upcoming: [] }, Date.now(), PAST), 'live');
});
test('selectState: empty or missing data is live', () => {
  assert.equal(L.selectState(null, Date.now(), PAST), 'live');
});

test('announcement cleaning: trims, collapses whitespace, caps at 140', () => {
  assert.equal(L.cleanAnnouncement('  Dinner   is\nserved '), 'Dinner is served');
  assert.equal(L.cleanAnnouncement(null), '');
  assert.equal(L.cleanAnnouncement('x'.repeat(300)).length, 140);
});

test('applyBroadcast: LIVE_STATE replaces status and announcement', () => {
  const next = L.applyBroadcast({ status: null, announcement: '' }, { type: 'LIVE_STATE', status: { announcement: 'Hello', now_performing: act(1) } });
  assert.equal(next.announcement, 'Hello');
  assert.equal(next.status.now_performing.entry_id, 'e1');
});
test('applyBroadcast: ANNOUNCEMENT updates text and keeps status; empty clears', () => {
  const cur = { status: { announcement: 'Old', upcoming: [act(2)] }, announcement: 'Old' };
  const set = L.applyBroadcast(cur, { type: 'ANNOUNCEMENT', text: 'Raffle at 8' });
  assert.equal(set.announcement, 'Raffle at 8');
  assert.equal(set.status.announcement, 'Raffle at 8');
  assert.equal(set.status.upcoming.length, 1);
  assert.equal(L.applyBroadcast(set, { type: 'ANNOUNCEMENT', text: '' }).announcement, '');
  assert.equal(cur.announcement, 'Old', 'input not mutated');
});
test('applyBroadcast: ignores junk', () => {
  const cur = { status: null, announcement: '' };
  for (const m of [null, undefined, 'x', {}, { type: 'LIVE_STATE' }, { type: 'LIVE_STATE', status: 5 }, { type: 'OTHER' }]) assert.equal(L.applyBroadcast(cur, m), cur);
});

test('actName and name wrapping helper', () => {
  assert.equal(L.actName(act(1)), 'P1');
  assert.equal(L.actName({ performer_name: 'A', partner_name: 'B' }), 'A & B');
  const long = 'Anika Mathew-Kurian & Priyadarshini Venkataraman Subramaniam';
  assert.equal(L.actName({ performer_name: 'Anika Mathew-Kurian', partner_name: 'Priyadarshini Venkataraman Subramaniam' }), long);
  assert.match(L.nameClasses(true), /tv-wrap/);
  assert.match(L.nameClasses(true), /tv-clamp2/);
  assert.equal(L.nameClasses(false), 'tv-wrap');
});
test('sanitized live payload acoustic flag activates the band indicator', () => {
  assert.equal(L.isAcousticAct({ is_acoustic: true }), true);
  assert.equal(L.isAcousticAct({ is_acoustic: false, performance_type: 'Solo' }), false);
});
test('seqLabel and countdown parts', () => {
  assert.equal(L.seqLabel({ sequence_order: 7 }), '#07');
  assert.equal(L.seqLabel(null), '#00');
  assert.deepEqual(L.countdownParts(90061000), { days: 1, hours: 1, mins: 1, secs: 1 });
  assert.deepEqual(L.countdownParts(-5), { days: 0, hours: 0, mins: 0, secs: 0 });
});

test('monitorMode priority and connection window', () => {
  assert.equal(L.monitorMode({}), 'standby');
  assert.equal(L.monitorMode({ entryId: 'a', mediaType: 'audio' }), 'name');
  assert.equal(L.monitorMode({ entryId: 'a', mediaType: 'video', streamUrl: '/s' }), 'video');
  assert.equal(L.monitorMode({ entryId: 'a', mediaType: 'video', streamUrl: '/s', lyrics: 'la' }), 'lyrics');
  assert.equal(L.monitorMode({ entryId: 'a', lyrics: 'la', fadeBlack: true }), 'black');
  assert.equal(L.monitorMode({ lyrics: '   ' }), 'standby');
  assert.equal(L.isConnected(1000, 8999), true);
  assert.equal(L.isConnected(1000, 9000), false);
  assert.equal(L.isConnected(NaN, 9000), false);
});
