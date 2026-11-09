const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
  constructor(id = '') { this.id = id; this.attributes = {}; this.dataset = {}; this.listeners = {}; this.children = []; this._innerHTML = ''; this.textContent = ''; this.value = ''; this.checked = false; this.disabled = false; this.min = ''; this.max = ''; this.classNames = new Set(); this.classList = {add: x => this.classNames.add(x), remove: x => this.classNames.delete(x), contains: x => this.classNames.has(x), toggle: (x, force) => { const on = force === undefined ? !this.classNames.has(x) : force; on ? this.classNames.add(x) : this.classNames.delete(x); return on; }}; }
  set innerHTML(value) {
    this._innerHTML = value;
    if (this.id === 'preset-grid') {
      this.children = [...value.matchAll(/<button type="button"([^>]*)>/g)].filter(match => /class="preset-card/.test(match[1])).map(match => {
        const button = new Element();
        button.ownerDocument = this.ownerDocument;
        for (const attr of match[1].matchAll(/([\w-]+)="([^"]*)"/g)) button.setAttribute(attr[1], attr[2]);
        button.dataset.preset = button.getAttribute('data-preset');
        return button;
      });
    }
    if (this.id === 'wizard-body') this.children = [...value.matchAll(/<button type="button"([^>]*)>/g)].map(match => {
      const button = new Element();
      button.ownerDocument = this.ownerDocument;
      for (const attr of match[1].matchAll(/([\w-]+)="([^"]*)"/g)) button.setAttribute(attr[1], attr[2]);
      button.dataset.id = button.getAttribute('data-id');
      return button;
    });
  }
  get innerHTML() { return this._innerHTML; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  async fire(type, event = {}) { for (const fn of [...(this.listeners[type] || [])]) await fn(Object.assign({target: this}, event)); }
  querySelectorAll(selector) { return selector === '.preset-card' || selector === '.wiz-type' ? this.children : []; }
  querySelector(selector) { const match = selector.match(/^\[data-preset="([^"]+)"\]$/); return match ? this.children.find(b => b.dataset.preset === match[1]) || null : null; }
  focus() { this.ownerDocument.activeElement = this; }
  scrollIntoView() {}
}

function setup() {
  const ids = ['preset-grid', 'preset-preview', 'preset-cancel', 'preset-apply', 'wizard-body', 'wizard-dots', 'wizard-sub', 'wizard-title', 'wizard-back', 'wizard-next', 'setup-wizard', 'wizard-close', 'wizard-skip', 'wizard-step-progress', 'overview-wizard-banner', 'overview-wizard-progress', 'wz-name', 'wz-sub', 'wz-start', 'wz-range', 'wz-venue', 'wz-food', 'wz-max', 'wz-solo', 'wz-audio', 'wz-video', 'open-wizard-btn', 'overview-wizard-resume'];
  const els = Object.fromEntries(ids.map(id => [id, new Element(id)]));
  const document = {activeElement: null, listeners: {}, getElementById: id => els[id] || null, addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }, querySelector(selector) { const match = selector.match(/\[data-id="([^"]+)"\]/); return match ? els['wizard-body'].children.find(b => b.dataset.id === match[1]) || null : null; }};
  Object.values(els).forEach(el => { el.ownerDocument = document; });
  const presets = [
    {id: 'night', name: 'Musical Night', icon: 'music', tagline: 'A stage show', changes: [{label: 'Tracks', from: 'Off', to: 'On'}]},
    {id: 'potluck', name: 'Potluck', icon: 'utensils', tagline: 'A shared meal', changes: [{label: 'Food', from: 'Off', to: 'On'}]},
    {id: 'freeze', name: 'Show freeze', icon: 'snowflake', tagline: 'Lock sign-ups', changes: []},
  ];
  const calls = [];
  const context = {
    document,
    window: null,
    adminSettings: {active_preset: 'night', active_event_id: 'event-a'},
    fetch: async (url, options = {}) => { calls.push({url, options}); return {ok: true, json: async () => url === '/api/admin/presets' ? presets : {}}; },
    escapeHtml: value => String(value ?? ''),
    setTimeout: (fn) => { fn(); return 1; }, clearTimeout() {}, Event: function(type) { this.type = type; },
    showToast() {}, sessionStorage: {getItem: () => null, setItem() {}},
  };
  context.window = context;
  vm.createContext(context);
  const file = path.join(__dirname, '../../app/static/js/admin-setup.js');
  let source = fs.readFileSync(file, 'utf8');
  source = source.replace('  // ------------------------------------------------------------------ boot', '  window.__presetTest = {loadPresets, openWizard, renderWizard, bindWizard, finishWizard, getWizard: () => wiz, persistWizardState, syncWizardOverview};\n  // ------------------------------------------------------------------ boot');
  vm.runInContext(source, context, {filename: 'admin-setup.js'});
  return {context, document, els, calls, html: fs.readFileSync(path.join(__dirname, '../../app/static/admin-settings.html'), 'utf8'), css: fs.readFileSync(path.join(__dirname, '../../app/static/css/admin-setup.css'), 'utf8'), shellCss: fs.readFileSync(path.join(__dirname, '../../app/static/css/admin-shell.css'), 'utf8')};
}

test('preset cards use radio semantics, roving tabindex and keep the preview in sync with arrow navigation', async () => {
  const {context, document, els, html} = setup();
  assert.match(html, /id="preset-grid"[^>]*role="radiogroup"/);
  await context.__presetTest.loadPresets();
  let cards = els['preset-grid'].children;
  assert.equal(cards.length, 3);
  assert.deepEqual(cards.map(card => card.getAttribute('role')), ['radio', 'radio', 'radio']);
  assert.deepEqual(cards.map(card => card.getAttribute('aria-checked')), ['false', 'false', 'false']);
  assert.deepEqual(cards.map(card => card.getAttribute('tabindex')), ['0', '-1', '-1']);

  await cards[0].fire('click');
  cards = els['preset-grid'].children;
  assert.deepEqual(cards.map(card => card.getAttribute('aria-checked')), ['true', 'false', 'false']);
  assert.match(els['preset-preview'].innerHTML, /Change preview: Musical Night/);
  await cards[0].fire('keydown', {key: 'ArrowDown', preventDefault() { this.prevented = true; }});
  cards = els['preset-grid'].children;
  assert.deepEqual(cards.map(card => card.getAttribute('aria-checked')), ['false', 'true', 'false']);
  assert.deepEqual(cards.map(card => card.getAttribute('tabindex')), ['-1', '0', '-1']);
  assert.equal(document.activeElement, cards[1]);
  assert.match(els['preset-preview'].innerHTML, /Change preview: Potluck/);
  await cards[1].fire('keydown', {key: 'End', preventDefault() {}});
  cards = els['preset-grid'].children;
  assert.deepEqual(cards.map(card => card.getAttribute('aria-checked')), ['false', 'false', 'true']);
  assert.equal(document.activeElement, cards[2]);
  assert.match(els['preset-preview'].innerHTML, /Change preview: Show freeze/);
});

test('preset cards retain a 44px minimum target and visible keyboard focus style', () => {
  const {css} = setup();
  const cardRule = css.match(/\.as-type-card\s*\{([^}]*)\}/s)?.[1] || '';
  assert.match(cardRule, /min-height:\s*44px/);
  assert.match(css, /\.as-type-card:focus-visible/);
  assert.match(css, /outline:\s*3px solid var\(--accent-primary\)/);
});

test('wizard persists canonical step and draft while navigation remains responsive', async () => {
  const {context, els, calls} = setup();
  await context.__presetTest.loadPresets();
  context.__presetTest.bindWizard();
  context.__presetTest.openWizard();
  assert.match(els['wizard-sub'].textContent, /Step 1 of 5, 20%/);
  await els['wizard-next'].fire('click');
  els['wz-name'].value = 'Draft Event';
  await els['wizard-body'].fire('input');
  await context.__presetTest.persistWizardState();
  assert.match(els['wizard-sub'].textContent, /Step 2 of 5, 40%/);
  const save = calls.filter(call => call.url === '/api/admin/settings' && call.options.method === 'PUT').at(-1);
  assert.ok(save, 'wizard should persist settings while open');
  const settings = JSON.parse(save.options.body).settings;
  assert.equal(settings.wizard_step, 2);
  assert.equal(settings.wizard_draft.preset, 'musical_night');
  assert.equal(settings.wizard_draft.basics.event_name, 'Draft Event');
});

test('wizard resumes saved potluck step and overview banner uses canonical progress', async () => {
  const {context, els, html} = setup();
  context.adminSettings.wizard_step = 3;
  context.adminSettings.wizard_draft = {preset: 'potluck', basics: {event_name: 'Community Dinner'}, food: 'Mains:\nRice', rules: {}};
  await context.__presetTest.loadPresets();
  context.__presetTest.syncWizardOverview();
  assert.equal(els['overview-wizard-banner'].classList.contains('hidden'), false);
  assert.match(els['overview-wizard-progress'].textContent, /Step 3 of 5, 60%/);
  context.__presetTest.openWizard();
  assert.equal(context.__presetTest.getWizard().steps[context.__presetTest.getWizard().step], 'food');
  assert.match(els['wizard-sub'].textContent, /Step 3 of 5, 60%/);
  assert.match(els['wizard-body'].innerHTML, /Mains:/);
  assert.match(html, /id="overview-wizard-progress"/);
});

test('failed progress save does not block wizard navigation or report false persisted progress', async () => {
  const {context, els} = setup();
  context.fetch = async (url, options = {}) => url === '/api/admin/presets'
    ? {ok: true, json: async () => [{id: 'potluck', name: 'Potluck', icon: 'utensils', tagline: 'Meal', changes: []}]}
    : {ok: false, json: async () => ({detail: 'offline'})};
  await context.__presetTest.loadPresets();
  context.__presetTest.bindWizard();
  context.__presetTest.openWizard();
  await els['wizard-next'].fire('click');
  assert.match(els['wizard-sub'].textContent, /Step 2 of 5, 40%/);
  assert.equal(context.adminSettings.wizard_step, undefined);
});

test('wizard finish saves the food menu before marking setup complete', async () => {
  const {context, calls} = setup();
  await context.__presetTest.loadPresets();
  context.__presetTest.openWizard();
  const wiz = context.__presetTest.getWizard();
  wiz.preset = 'potluck'; wiz.steps = ['done']; wiz.step = 0; wiz.food = 'Mains:\nDal';
  await context.__presetTest.finishWizard();
  const bulk = calls.findIndex(call => call.url === '/api/admin/food-items/bulk');
  const completion = calls.findIndex(call => call.url === '/api/admin/settings' && JSON.parse(call.options.body).settings.setup_completed === true);
  assert.ok(bulk >= 0 && completion >= 0 && bulk < completion, 'menu must be saved before completion clears the draft');
});

test('wizard finish never applies a preset when progress could not be saved', async () => {
  const {context} = setup();
  await context.__presetTest.loadPresets();
  const requests = [];
  context.fetch = async (url) => { requests.push(url); return url === '/api/admin/presets'
    ? {ok: true, json: async () => [{id: 'potluck', name: 'Potluck', icon: 'utensils', tagline: 'Meal', changes: []}]}
    : {ok: false, json: async () => ({detail: 'offline'})}; };
  context.__presetTest.openWizard();
  const wiz = context.__presetTest.getWizard();
  wiz.preset = 'potluck'; wiz.steps = ['done']; wiz.step = 0;
  await context.__presetTest.finishWizard();
  assert.equal(requests.includes('/api/admin/apply-preset'), false);
  assert.notEqual(context.adminSettings.setup_completed, true);
});

test('wizard finish leaves setup incomplete when menu save fails', async () => {
  const {context, calls} = setup();
  await context.__presetTest.loadPresets();
  const normalFetch = context.fetch;
  context.fetch = async (url, options = {}) => url === '/api/admin/food-items/bulk'
    ? {ok: false, json: async () => ({detail: 'menu unavailable'})}
    : normalFetch(url, options);
  context.__presetTest.openWizard();
  const wiz = context.__presetTest.getWizard();
  wiz.preset = 'potluck'; wiz.steps = ['done']; wiz.step = 0; wiz.food = 'Mains:\nDal';
  await context.__presetTest.finishWizard();
  assert.equal(calls.some(call => call.url === '/api/admin/settings' && JSON.parse(call.options.body).settings.setup_completed === true), false);
  assert.notEqual(context.adminSettings.setup_completed, true);
});

test('wizard binds progress, preset, menu, and completion writes to the event it opened', async () => {
  const {context, calls} = setup();
  await context.__presetTest.loadPresets();
  context.__presetTest.openWizard();
  const wiz = context.__presetTest.getWizard();
  wiz.preset = 'potluck'; wiz.steps = ['done']; wiz.step = 0; wiz.food = 'Mains:\nDal';
  await context.__presetTest.finishWizard();
  const wizardCalls = calls.filter(call => ['/api/admin/settings', '/api/admin/apply-preset', '/api/admin/food-items/bulk'].includes(call.url) && call.options.method !== undefined);
  assert.ok(wizardCalls.length >= 4);
  for (const call of wizardCalls) {
    assert.equal(JSON.parse(call.options.body).expected_event_id, 'event-a', `${call.url} must include expected_event_id`);
  }
});

test('wizard stops on event identity conflict without writing later steps', async () => {
  const {context} = setup();
  await context.__presetTest.loadPresets();
  const requests = [];
  context.fetch = async (url, options = {}) => {
    requests.push(url);
    if (url === '/api/admin/presets') return {ok: true, json: async () => []};
    return {ok: false, status: 409, json: async () => ({detail: 'Active event changed'})};
  };
  context.__presetTest.openWizard();
  const wiz = context.__presetTest.getWizard();
  wiz.preset = 'potluck'; wiz.steps = ['done']; wiz.step = 0; wiz.food = 'Mains:\nDal';
  await context.__presetTest.finishWizard();
  assert.equal(requests.includes('/api/admin/apply-preset'), false);
  assert.equal(requests.includes('/api/admin/food-items/bulk'), false);
  assert.equal(requests.some(url => url === '/api/admin/settings'), true);
});

test('untouched default wizard data does not show a false resume banner', () => {
  const {context, els} = setup();
  context.adminSettings.setup_completed = false;
  context.adminSettings.wizard_step = 1;
  context.adminSettings.wizard_draft = {preset: 'musical_night', basics: {}, food: '', rules: {}};
  context.__presetTest.syncWizardOverview();
  assert.equal(els['overview-wizard-banner'].classList.contains('hidden'), true);
});

test('overview wizard progress stays visible in the compact mobile banner', () => {
  const {html, shellCss} = setup();
  assert.match(html, /id="overview-wizard-progress"[^>]*class="admin-banner-progress"/);
  assert.match(shellCss, /\.admin-banner p:not\(\.admin-banner-progress\)\s*\{\s*display:\s*none;\s*\}/);
  assert.match(shellCss, /\.admin-banner \.admin-banner-progress\s*\{\s*display:\s*block;/);
});
