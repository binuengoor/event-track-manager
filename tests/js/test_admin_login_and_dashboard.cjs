const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadScript(file, extra = {}) {
  const src = fs.readFileSync(path.join(__dirname, '../../app/static/js', file), 'utf8');
  const sandbox = Object.assign({
    console, setTimeout, clearTimeout, fetch: async () => { throw new Error('no network'); },
    document: {addEventListener() {}, getElementById: () => null, querySelectorAll: () => []},
    CustomEvent: class {}, history: {replaceState() {}}, location: {hash: ''},
  }, extra);
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, {filename: file});
  return sandbox;
}

const res = (status, retryAfter) => ({status, headers: {get: n => (n === 'Retry-After' && retryAfter != null ? String(retryAfter) : null)}});

test('429 shows minutes from retry_after, falling back to the Retry-After header', () => {
  const w = loadScript('admin-settings.js');
  assert.equal(w.loginErrorMessage(res(429), {retry_after: 240}), 'Too many attempts, try again in 4 min');
  assert.equal(w.loginErrorMessage(res(429, 90), {}), 'Too many attempts, try again in 2 min');
  assert.equal(w.loginErrorMessage(res(429), {retry_after: 5}), 'Too many attempts, try again in 1 min');
});

test('wrong PIN and server errors read differently', () => {
  const w = loadScript('admin-settings.js');
  assert.match(w.loginErrorMessage(res(401), {}), /not right/);
  assert.match(w.loginErrorMessage(res(500), {}), /server had a problem/);
  assert.notEqual(w.loginErrorMessage(res(401), {}), w.loginErrorMessage(res(500), {}));
});

test('five destinations cover every original tab', () => {
  const w = loadScript('admin-settings.js');
  const dests = w.ADMIN_DESTINATIONS;
  assert.deepEqual(Array.from(dests, d => d.id), ['overview', 'lineup', 'people', 'setup', 'system']);
  const tabs = new Set(dests.flatMap(d => d.tabs));
  for (const t of ['event', 'rules', 'features', 'food', 'participants', 'sheet', 'payments', 'stats', 'backup', 'activity']) assert.ok(tabs.has(t), t);
});

test('track badge and lineup ordering', () => {
  const {AdminDash} = loadScript('admin-dashboard.js');
  assert.equal(AdminDash.trackBadge({track_status: 'Uploaded'}).ready, true);
  assert.equal(AdminDash.trackBadge({track_status: 'Acoustic'}).label, 'No track needed');
  assert.equal(AdminDash.trackBadge({track_status: 'Pending'}).ready, false);
  const order = AdminDash.sortLineup([{sequence_order: 3, id: 'c'}, {sequence_order: null, id: 'z'}, {sequence_order: 1, id: 'a'}]).map(p => p.id);
  assert.deepEqual(Array.from(order), ['a', 'c', 'z']);
});

test('snapshot restore needs the exact typed word; totals add up', () => {
  const {AdminDash} = loadScript('admin-dashboard.js');
  assert.equal(AdminDash.confirmMatches('restore', 'RESTORE'), false);
  assert.equal(AdminDash.confirmMatches(' RESTORE ', 'RESTORE'), true);
  const t = AdminDash.totalsFrom({total_performances: 4, food_taken: 2, food_total: 5}, [{track_status: 'Uploaded'}, {track_status: 'Pending'}], {paid: 1, total: 3, enabled: true});
  assert.equal(JSON.stringify([t.acts, t.tracksReady, t.tracksTotal, t.dishesTaken, t.paid, t.paidTotal]), '[4,1,2,2,1,3]');
  assert.equal(AdminDash.fmtBytes(1572864), '1.5 MB');
});
