const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
  constructor() { this.listeners = {}; this.value = ''; this.checked = false; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  async fire(type, event = {}) { for (const fn of [...(this.listeners[type] || [])]) await fn(Object.assign({target: this, currentTarget: this, preventDefault() {}}, event)); }
}

const root = path.join(__dirname, '../../app/static');

test('Event Details saves Doors Open time and post-event link with existing settings', async () => {
  const ids = ['save-event-settings-btn', 'setting-header-brand-title', 'setting-header-brand-subtitle', 'setting-event-name',
    'setting-event-subtitle', 'setting-event-date-time', 'setting-event-time-range', 'setting-event-venue',
    'setting-event-poster-url', 'setting-entry-id-prefix', 'setting-payment-url', 'setting-hero-tag-primary',
    'setting-hero-tag-status', 'setting-general-notes', 'setting-external-link-url', 'setting-doors-open-time',
    'setting-post-event-link-url'];
  const els = Object.fromEntries(ids.map(id => [id, new Element()]));
  els['setting-event-name'].value = 'Summer Music';
  els['setting-doors-open-time'].value = '4:30 PM';
  els['setting-post-event-link-url'].value = 'https://example.com/photos';
  const document = {getElementById: id => els[id] || null, querySelectorAll: () => []};
  let saved;
  const context = {document, window: null, updateSettingsApi: async payload => { saved = payload; }, updateCharCounters() {}, alert() {}};
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/settings/action-handlers.js'), 'utf8'), context);
  context.setupActionHandlers();
  await els['save-event-settings-btn'].fire('click');
  assert.equal(saved.event_name, 'Summer Music');
  assert.equal(saved.doors_open_time, '4:30 PM');
  assert.equal(saved.post_event_link_url, 'https://example.com/photos');
});

test('/live has a prestart Doors Open pill and an ended post-event QR callout', () => {
  const html = fs.readFileSync(path.join(root, 'live.html'), 'utf8');
  assert.match(html, /id="doors-open-pill"/);
  assert.match(html, /id="doors-open-time"/);
  assert.match(html, /id="post-event-qr-wrap"/);
  assert.match(html, /id="post-event-qr"/);
  assert.match(html, /Scan for photos and feedback/);
  assert.match(html, /id="post-event-qr-wrap" class="hidden/);
});

test('live QR URL accepts only absolute HTTP(S) URLs without credentials', () => {
  let source = fs.readFileSync(path.join(root, 'js/live/live-view.js'), 'utf8');
  const marker = "  document.addEventListener('DOMContentLoaded', () => {";
  source = source.replace(marker, '  window.__a4Test = {safeHttpUrl};\n' + marker);
  const context = {window: null, document: {addEventListener() {}, getElementById() {}}, URL};
  context.window = context;
  context.EtmLive = {};
  vm.createContext(context);
  vm.runInContext(source, context);
  const safe = context.__a4Test.safeHttpUrl;
  assert.equal(typeof safe, 'function');
  assert.equal(safe('https://example.com/photos?event=1'), 'https://example.com/photos?event=1');
  assert.equal(safe('http://example.com/photos'), 'http://example.com/photos');
  assert.equal(safe('javascript:alert(1)'), '');
  assert.equal(safe('data:text/html,<script>1</script>'), '');
  assert.equal(safe('//example.com/photos'), '');
  assert.equal(safe('https://user:pass@example.com/photos'), '');
});

test('live details render doors time and reuse EtmQr only for safe photo links', () => {
  let source = fs.readFileSync(path.join(root, 'js/live/live-view.js'), 'utf8');
  const marker = "  document.addEventListener('DOMContentLoaded', () => {";
  source = source.replace(marker, '  window.__a4Test = {renderEventDetails};\n' + marker);
  const doors = {textContent: ''}, qr = {innerHTML: ''}, calls = [];
  const context = {
    window: null,
    document: {addEventListener() {}, getElementById: id => ({'doors-open-time': doors, 'post-event-qr': qr})[id]},
    URL,
    EtmLive: {},
    EtmQr: {toSvg: (url, options) => { calls.push({url, options}); return '<svg>encoded QR</svg>'; }},
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context);
  context.__a4Test.renderEventDetails({doors_open_time: '4:30 PM', post_event_link_url: 'javascript:alert(1)'});
  assert.equal(doors.textContent, '4:30 PM');
  assert.equal(qr.innerHTML, '');
  assert.equal(calls.length, 0);
  context.__a4Test.renderEventDetails({doors_open_time: '', post_event_link_url: 'https://example.com/photos'});
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://example.com/photos');
  assert.match(calls[0].options.label, /photos and feedback/i);
  assert.equal(qr.innerHTML, '<svg>encoded QR</svg>');
});

test('event detail inputs have phone-safe target heights', () => {
  const html = fs.readFileSync(path.join(root, 'admin-settings.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/admin-setup.css'), 'utf8');
  assert.match(html, /id="setting-doors-open-time"/);
  assert.match(html, /id="setting-post-event-link-url"/);
  assert.match(css, /as-event-detail-input[^}]*min-height:\s*44px/s);
});
