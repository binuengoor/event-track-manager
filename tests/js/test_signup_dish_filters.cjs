const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
  constructor(tag = 'div') { this.tagName = tag; this.children = []; this.listeners = {}; this.attributes = {}; this.dataset = {}; this.hidden = false; this.value = ''; this.checked = false; this.textContent = ''; this._innerHTML = ''; }
  set innerHTML(value) { this._innerHTML = value; if (value === '') this.children = []; }
  get innerHTML() { return this._innerHTML; }
  append(...children) { children.forEach(child => { if (child) { child.parentNode = this; this.children.push(child); } }); }
  appendChild(child) { this.append(child); return child; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  focus() { if (this.ownerDocument) this.ownerDocument.activeElement = this; }
  async click() { for (const fn of this.listeners.click || []) await fn({target: this}); }
}

function setup() {
  const ids = ['food-groups-container', 'food-category-filters', 'performer-name', 'food-open-count', 'selected-food-box', 'food-filter-selection-note'];
  const els = Object.fromEntries(ids.map(id => [id, new Element()]));
  const document = {
    activeElement: null,
    getElementById: id => els[id] || null,
    createElement: tag => { const element = new Element(tag); element.ownerDocument = document; return element; },
    querySelector(selector) {
      if (selector !== 'input[name="food_item_id"]:checked') return null;
      const find = node => {
        if (node.tagName === 'input' && node.name === 'food_item_id' && node.checked) return node;
        for (const child of node.children) { const match = find(child); if (match) return match; }
        return null;
      };
      return find(els['food-groups-container']);
    },
  };
  els['performer-name'].value = '';
  const context = {
    document,
    state: {config: {
      food_groups: [{group_id: 'g1', name: 'Appetizers'}, {group_id: 'g2', name: 'Mains'}],
      food_items: [
        {item_id: 'i1', group_id: 'g1', name: 'Samosa', is_taken: false},
        {item_id: 'i2', group_id: 'g2', name: 'Rice', is_taken: false},
      ],
    }},
    $: id => els[id] || null,
  };
  Object.values(els).forEach(element => { element.ownerDocument = document; });
  context.window = context;
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '../../app/static/js/signup/lookup.js'), 'utf8');
  vm.runInContext(source.replace('// ---------------------------------------------------------------------------------------------- name lookup', 'window.__test = {renderFoodGroups};\n// ---------------------------------------------------------------------------------------------- name lookup'), context);
  return {context, els};
}

test('dish category chips filter headed groups and preserve selected radio across filters', async () => {
  const {context, els} = setup();
  context.__test.renderFoodGroups();
  const filters = els['food-category-filters'];
  assert.deepEqual(filters.children.map(button => button.textContent), ['All', 'Appetizers', 'Mains']);
  assert.deepEqual(filters.children.map(button => button.getAttribute('aria-pressed')), ['true', 'false', 'false']);
  assert.equal(els['food-groups-container'].children.length, 2);
  assert.equal(els['food-groups-container'].children[0].children[0].children[0].textContent, 'Appetizers');

  // Choose Samosa, then switch to Mains. The selected radio remains in the DOM
  // so signup validation and payload collection continue to find it.
  const samosaInput = els['food-groups-container'].children[0].children[1].children[0].children[0].children[0];
  samosaInput.checked = true;
  const mainsFilter = filters.children[2];
  mainsFilter.focus();
  await mainsFilter.click();
  const groups = els['food-groups-container'].children;
  assert.equal(groups[0].hidden, true);
  assert.equal(groups[1].hidden, false);
  assert.equal(context.document.querySelector('input[name="food_item_id"]:checked').value, 'i1');
  assert.equal(els['food-filter-selection-note'].hidden, false);
  assert.equal(els['food-filter-selection-note'].textContent, 'Selected: Samosa (Appetizers). It remains selected.');
  assert.deepEqual(els['food-category-filters'].children.map(button => button.getAttribute('aria-pressed')), ['false', 'false', 'true']);
  assert.equal(context.document.activeElement, els['food-category-filters'].children[2], 'focus should move to the replacement Mains filter button');
});

test('dish filter controls have a 44px minimum target and retain all-group fallback', () => {
  const {context, els} = setup();
  context.__test.renderFoodGroups();
  const css = fs.readFileSync(path.join(__dirname, '../../app/static/css/signup.css'), 'utf8');
  assert.match(css, /\.su-food-filter[^\{]*\{[^}]*min-height:\s*44px/s);
  assert.equal(els['food-groups-container'].children.length, 2);
  assert.ok(els['food-category-filters'].children.some(button => button.textContent === 'All'));
});
