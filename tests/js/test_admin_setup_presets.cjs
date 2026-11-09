const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
  constructor(id = '') { this.id = id; this.attributes = {}; this.dataset = {}; this.listeners = {}; this.children = []; this._innerHTML = ''; this.classList = {add() {}, remove() {}, toggle() {}}; }
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
  }
  get innerHTML() { return this._innerHTML; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  async fire(type, event = {}) { for (const fn of [...(this.listeners[type] || [])]) await fn(Object.assign({target: this}, event)); }
  querySelectorAll(selector) { return selector === '.preset-card' ? this.children : []; }
  querySelector(selector) { const match = selector.match(/^\[data-preset="([^"]+)"\]$/); return match ? this.children.find(b => b.dataset.preset === match[1]) || null : null; }
  focus() { this.ownerDocument.activeElement = this; }
  scrollIntoView() {}
}

function setup() {
  const ids = ['preset-grid', 'preset-preview', 'preset-cancel', 'preset-apply'];
  const els = Object.fromEntries(ids.map(id => [id, new Element(id)]));
  const document = {activeElement: null, getElementById: id => els[id] || null, addEventListener() {}};
  Object.values(els).forEach(el => { el.ownerDocument = document; });
  const presets = [
    {id: 'night', name: 'Musical Night', icon: 'music', tagline: 'A stage show', changes: [{label: 'Tracks', from: 'Off', to: 'On'}]},
    {id: 'potluck', name: 'Potluck', icon: 'utensils', tagline: 'A shared meal', changes: [{label: 'Food', from: 'Off', to: 'On'}]},
    {id: 'freeze', name: 'Show freeze', icon: 'snowflake', tagline: 'Lock sign-ups', changes: []},
  ];
  const context = {
    document,
    window: null,
    adminSettings: {active_preset: 'night'},
    fetch: async url => ({ok: true, json: async () => url === '/api/admin/presets' ? presets : {}}),
    escapeHtml: value => String(value ?? ''),
  };
  context.window = context;
  vm.createContext(context);
  const file = path.join(__dirname, '../../app/static/js/admin-setup.js');
  let source = fs.readFileSync(file, 'utf8');
  source = source.replace('  // ------------------------------------------------------------------ boot', '  window.__presetTest = {loadPresets};\n  // ------------------------------------------------------------------ boot');
  vm.runInContext(source, context, {filename: 'admin-setup.js'});
  return {context, document, els, html: fs.readFileSync(path.join(__dirname, '../../app/static/admin-settings.html'), 'utf8'), css: fs.readFileSync(path.join(__dirname, '../../app/static/css/admin-setup.css'), 'utf8')};
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
