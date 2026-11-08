const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class FakeElement {
  constructor(dataset = {}) {
    this.dataset = dataset;
    this.listeners = {};
    this.attributes = {};
    this.classes = new Set(['hidden']);
    this.classList = {
      add: (c) => this.classes.add(c), remove: (c) => this.classes.delete(c),
      toggle: (c, force) => { const on = force == null ? !this.classes.has(c) : force; on ? this.classes.add(c) : this.classes.delete(c); return on; },
      contains: (c) => this.classes.has(c),
    };
    this.value = '';
    this.files = [];
    this.disabled = false;
    this.textContent = '';
    this.innerHTML = '';
  }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  async fire(type, event = {}) {
    for (const fn of [...(this.listeners[type] || [])]) await fn(Object.assign({target: this, preventDefault() {}}, event));
  }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  removeAttribute(key) { delete this.attributes[key]; }
  focus() {}
  reset() {}
  querySelector(selector) {
    if (selector === '[type="submit"]') return this.submitButton;
    if (selector === '.lineup-match-act') return this.matchSelect;
    return null;
  }
  querySelectorAll(selector) { return this.matches[selector] || []; }
  click() { this.clickCount = (this.clickCount || 0) + 1; }
}

function setup({promptValue = 'DELETE', performanceTypes = ['Solo', 'Duet', 'Group']} = {}) {
  const els = Object.fromEntries([
    'lineup-list', 'lineup-foot', 'lineup-incoming', 'lineup-incoming-count', 'lineup-add-form',
    'lineup-add-message', 'lineup-add-act', 'lineup-add-cancel', 'lineup-save-order',
    'lineup-add-performer', 'lineup-add-song', 'lineup-add-type', 'lineup-add-partner',
  ].map((id) => [id, new FakeElement()]));
  els['lineup-add-act'].setAttribute('aria-expanded', 'false');
  const form = els['lineup-add-form'];
  form.submitButton = new FakeElement();
  const docListeners = {};
  const document = {
    getElementById: (id) => els[id] || null,
    addEventListener: (type, fn) => { (docListeners[type] ||= []).push(fn); },
    dispatchEvent: async (event) => { for (const fn of docListeners[event.type] || []) await fn(event); },
  };
  const replaceInput = new FakeElement({entry: 'PK-001'});
  replaceInput.files = [{name: 'replacement.wav', size: 12}];
  const replaceButton = new FakeElement({entry: 'PK-001'});
  const deleteButton = new FakeElement({entry: 'PK-001'});
  const matchSelect = new FakeElement();
  matchSelect.value = 'PK-001';
  const matchButton = new FakeElement({filename: 'drop.mp3'});
  matchButton.parentElement = {querySelector: () => matchSelect};
  els['lineup-list'].matches = {
    '.lineup-restore': [], '.lineup-file': [replaceInput],
    '.lineup-replace-trigger': [replaceButton], '.lineup-delete': [deleteButton],
  };
  els['lineup-incoming'].matches = {'.lineup-match': [matchButton]};

  const calls = [];
  const fetch = async (url, options = {}) => {
    calls.push({url, options});
    let data = {};
    if (url === '/api/admin/participants') data = [{entry_id: 'PK-001', performer_name: 'Asha', song_title: 'Song', sequence_order: 1, track_status: 'Pending'}];
    if (url === '/api/admin/incoming') data = {files: [{name: 'drop.mp3', size: 10}]};
    return {ok: true, status: 200, json: async () => data};
  };
  const sandbox = {
    console, fetch, document, FormData: class { constructor() { this.items = []; } append(...args) { this.items.push(args); } },
    prompt: () => promptValue, setTimeout, clearTimeout,
    showToast() {}, setAdminPageSub() {}, currentAdminTab: 'lineup', adminSettings: {performance_types: performanceTypes},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const src = fs.readFileSync(path.join(__dirname, '../../app/static/js/admin-dashboard.js'), 'utf8');
  vm.runInContext(src, sandbox, {filename: 'admin-dashboard.js'});
  for (const fn of docListeners['DOMContentLoaded'] || []) fn();
  return {els, calls, document, sandbox, replaceInput, replaceButton, deleteButton, matchButton, matchSelect, fetch};
}

test('Add act type options follow the configured performance types', () => {
  const h = setup({performanceTypes: ['Solo', 'Dance Crew', 'Instrumental Duo']});
  assert.match(h.els['lineup-add-type'].innerHTML, /<option value="Dance Crew">Dance Crew<\/option>/);
  assert.match(h.els['lineup-add-type'].innerHTML, /<option value="Instrumental Duo">Instrumental Duo<\/option>/);
  assert.doesNotMatch(h.els['lineup-add-type'].innerHTML, /value="Group"/);
});

async function loadLineup(h) { await h.document.dispatchEvent({type: 'etm:admin-tab', detail: {tab: 'lineup'}}); await new Promise(setImmediate); }

test('Add act form starts hidden and its toggle updates the expanded state', async () => {
  const css = fs.readFileSync(path.join(__dirname, '../../app/static/css/admin-overview.css'), 'utf8');
  const hiddenRule = /#lineup-add-form\.hidden\s*\{[^}]*display:\s*none\s*!important/i;
  assert.match(css, hiddenRule);
  const h = setup();
  assert.equal(h.els['lineup-add-form'].classList.contains('hidden'), true);
  assert.equal(h.els['lineup-add-act'].getAttribute('aria-expanded'), 'false');
  await h.els['lineup-add-act'].fire('click');
  assert.equal(h.els['lineup-add-form'].classList.contains('hidden'), false);
  assert.equal(h.els['lineup-add-act'].getAttribute('aria-expanded'), 'true');
  await h.els['lineup-add-cancel'].fire('click');
  assert.equal(h.els['lineup-add-form'].classList.contains('hidden'), true);
  assert.equal(h.els['lineup-add-act'].getAttribute('aria-expanded'), 'false');
});

// The test harness drives the production event handlers and inspects the actual requests.
test('Add act submits the documented JSON contract then refreshes Lineup', async () => {
  const h = setup();
  h.els['lineup-add-performer'].value = 'Asha';
  h.els['lineup-add-song'].value = 'Song';
  h.els['lineup-add-type'].value = 'Duet';
  h.els['lineup-add-partner'].value = 'Maya';
  await h.els['lineup-add-form'].fire('submit');
  const request = h.calls.find((c) => c.url === '/api/admin/acts');
  assert.equal(request.options.method, 'POST');
  assert.deepEqual(JSON.parse(request.options.body), {performer_name: 'Asha', song_title: 'Song', performance_type: 'Duet', partner_name: 'Maya'});
  assert.ok(h.calls.some((c) => c.url === '/api/admin/participants'));
});

test('Save order calls the existing push-sequence endpoint', async () => {
  const h = setup();
  await h.els['lineup-save-order'].fire('click');
  assert.ok(h.calls.some((c) => c.url === '/api/push-sequence' && c.options.method === 'POST'));
});

test('Replace opens the accessible file control and uploads multipart file field', async () => {
  const h = setup();
  await loadLineup(h);
  await h.replaceButton.fire('click');
  assert.equal(h.replaceInput.clickCount, 1);
  await h.replaceInput.fire('change');
  const request = h.calls.find((c) => c.url === '/api/admin/acts/PK-001/track');
  assert.equal(request.options.method, 'POST');
  assert.deepEqual(request.options.body.items, [['file', h.replaceInput.files[0]]]);
});

test('Delete only sends after exact typed confirmation', async () => {
  const cancelled = setup({promptValue: 'DELETE PK-001'});
  await loadLineup(cancelled);
  await cancelled.deleteButton.fire('click');
  assert.ok(!cancelled.calls.some((c) => c.url === '/api/admin/acts/PK-001'));

  const confirmed = setup();
  await loadLineup(confirmed);
  await confirmed.deleteButton.fire('click');
  assert.ok(confirmed.calls.some((c) => c.url === '/api/admin/acts/PK-001' && c.options.method === 'DELETE'));
});

test('Match sends the selected act and incoming filename', async () => {
  const h = setup();
  await loadLineup(h);
  await h.matchButton.fire('click');
  const request = h.calls.find((c) => c.url === '/api/admin/acts/PK-001/match');
  assert.equal(request.options.method, 'POST');
  assert.deepEqual(JSON.parse(request.options.body), {filename: 'drop.mp3'});
});
