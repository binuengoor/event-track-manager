const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
  constructor() { this.listeners = {}; this.value = ''; this.checked = false; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  async fire(type, event = {}) {
    for (const fn of [...(this.listeners[type] || [])]) {
      await fn(Object.assign({target: this, currentTarget: this, preventDefault() {}}, event));
    }
  }
}

const root = path.join(__dirname, '../../app/static');

test('Event Details saves and loads event_passcode', async () => {
  const ids = [
    'save-event-settings-btn', 'setting-header-brand-title', 'setting-header-brand-subtitle', 'setting-event-name',
    'setting-event-subtitle', 'setting-event-date-time', 'setting-event-time-range', 'setting-event-venue',
    'setting-event-poster-url', 'setting-entry-id-prefix', 'setting-payment-url', 'setting-hero-tag-primary',
    'setting-hero-tag-status', 'setting-general-notes', 'setting-external-link-url', 'setting-doors-open-time',
    'setting-post-event-link-url', 'setting-event-passcode',
  ];
  const els = Object.fromEntries(ids.map(id => [id, new Element()]));
  els['setting-event-name'].value = 'Passcode Test Event';
  els['setting-event-passcode'].value = 'secret123';

  const document = {getElementById: id => els[id] || null, querySelectorAll: () => []};
  let saved;
  const context = {document, window: null, updateSettingsApi: async payload => { saved = payload; }, updateCharCounters() {}, alert() {}};
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/settings/action-handlers.js'), 'utf8'), context);
  context.setupActionHandlers();
  await els['save-event-settings-btn'].fire('click');
  assert.equal(saved.event_name, 'Passcode Test Event');
  assert.equal(saved.event_passcode, 'secret123');
});

test('gate.html has accessible form controls and tokens', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../app/templates/gate.html'), 'utf8');
  assert.match(html, /<form/);
  assert.match(html, /id="passcode"/);
  assert.match(html, /type="password"|type="text"/);
  assert.match(html, /tokens\.css/);
});
