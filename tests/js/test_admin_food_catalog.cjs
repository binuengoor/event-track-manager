const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
  constructor() { this.innerHTML = ''; this.dataset = {}; this.listeners = {}; this.value = ''; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  async fire(type, event = {}) { for (const fn of this.listeners[type] || []) await fn(event); }
}

function setup({reorderOk = true} = {}) {
  const els = Object.fromEntries(['admin-food-groups-list', 'admin-food-items-list', 'filter-group-select'].map(id => [id, new Element()]));
  const calls = [], toasts = [];
  const document = {getElementById: id => els[id] || null};
  const fetch = async (url, options = {}) => {
    calls.push({url, options});
    return {ok: reorderOk, status: reorderOk ? 200 : 500, json: async () => ({})};
  };
  const context = {
    console, document, fetch, confirm: () => true,
    showToast: (...args) => toasts.push(args),
    escapeHtml: value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
    escapeQuotes: value => String(value ?? '').replace(/'/g, "\\'").replace(/"/g, '&quot;'),
    foodGroups: [
      {group_id: 1, name: 'Mains', item_count: 2, taken_count: 1, open_count: 1},
      {group_id: 2, name: 'Desserts', item_count: 1, taken_count: 0, open_count: 1},
    ],
    foodItems: [
      {item_id: 11, group_id: 1, group_name: 'Mains', name: 'Rice', is_taken: false},
      {item_id: 12, group_id: 1, group_name: 'Mains', name: 'Curry', is_taken: true, signer_name: 'Asha', signer_phone: '6105550000'},
      {item_id: 21, group_id: 2, group_name: 'Desserts', name: 'Payasam', is_taken: false},
    ],
  };
  context.window = context;
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '../../app/static/js/settings/food-catalog.js'), 'utf8');
  vm.runInContext(source, context);
  return {context, els, calls, toasts};
}

test('admin dish slots render nested under their groups and retain edit/delete hooks', () => {
  const {context, els} = setup();
  context.renderFoodItemsList();
  const html = els['admin-food-items-list'].innerHTML;
  const mains = html.indexOf('data-food-items-group="1"');
  const desserts = html.indexOf('data-food-items-group="2"');
  assert.ok(mains >= 0 && desserts > mains, 'group sections should follow configured group order');
  const mainsHtml = html.slice(mains, desserts);
  assert.match(mainsHtml, /Mains/);
  assert.match(mainsHtml, /Rice/);
  assert.match(mainsHtml, /Curry/);
  assert.doesNotMatch(mainsHtml, /Payasam/);
  assert.match(html, /data-food-item-action="edit" data-item-id="11"/);
  assert.match(html, /data-food-item-action="delete" data-item-id="12" data-item-name="Curry" data-is-taken="true"/);
  assert.doesNotMatch(html, /\bonclick=["']/i);
});

test('group drag reorder posts existing ordered_ids contract and keeps keyboard controls', async () => {
  const {context, els, calls} = setup();
  context.renderFoodGroupsList();
  const groups = els['admin-food-groups-list'].innerHTML;
  assert.match(groups, /aria-label="Move Mains up"/);
  assert.match(groups, /aria-label="Move Mains down"/);
  assert.match(groups, /data-food-group-drag/);
  assert.match(groups, /data-food-group-action="move"/);
  assert.doesNotMatch(groups, /onclick=/);

  const list = els['admin-food-groups-list'];
  const transfer = {data: {}, setData(type, value) { this.data[type] = value; }, getData(type) { return this.data[type]; }};
  const handle = {dataset: {groupId: '1'}, closest: selector => selector === '[data-food-group-drag]' ? handle : null};
  const target = {dataset: {groupId: '2'}, closest: selector => selector === '[data-food-group-row]' ? target : null};
  await list.fire('dragstart', {target: handle, dataTransfer: transfer});
  await list.fire('dragover', {target, preventDefault() { this.prevented = true; }});
  await list.fire('drop', {target, dataTransfer: transfer, preventDefault() {}});

  assert.deepEqual(JSON.parse(calls[0].options.body), {ordered_ids: [2, 1]});
  assert.equal(calls[0].url, '/api/admin/food-groups/reorder');
  assert.equal(context.foodGroups[0].name, 'Desserts');
});

test('dynamic group and item names are escaped in text and data attributes', () => {
  const {context, els} = setup();
  const hostile = `Dinner ' onclick="alert(1)" <img src=x>`;
  context.foodGroups[0].name = hostile;
  context.foodItems[0].name = hostile;
  context.renderFoodGroupsList();
  context.renderFoodItemsList();
  const html = els['admin-food-groups-list'].innerHTML + els['admin-food-items-list'].innerHTML;
  assert.match(html, /Dinner &#39; onclick=&quot;alert\(1\)&quot; &lt;img src=x&gt;/);
  assert.doesNotMatch(html, /<img src=x>/);
  assert.doesNotMatch(html, /\bonclick=["']/i);
});

test('delegated group and item buttons still call the existing action hooks', async () => {
  const {context, els} = setup();
  const actions = [];
  context.moveGroup = (...args) => actions.push(['move', ...args]);
  context.renameGroup = (...args) => actions.push(['rename', ...args]);
  context.deleteGroup = (...args) => actions.push(['delete-group', ...args]);
  context.openAdminFoodModal = (...args) => actions.push(['edit-item', ...args]);
  context.deleteItem = (...args) => actions.push(['delete-item', ...args]);
  context.renderFoodGroupsList();
  context.renderFoodItemsList();

  const clickTarget = (selector, dataset) => ({closest: wanted => wanted === selector ? {dataset} : null});
  await els['admin-food-groups-list'].fire('click', {target: clickTarget('[data-food-group-action]', {foodGroupAction: 'move', groupIndex: '0', direction: '-1'})});
  await els['admin-food-groups-list'].fire('click', {target: clickTarget('[data-food-group-action]', {foodGroupAction: 'rename', groupId: '1', groupName: 'Mains'})});
  await els['admin-food-items-list'].fire('click', {target: clickTarget('[data-food-item-action]', {foodItemAction: 'edit', itemId: '11'})});
  await els['admin-food-items-list'].fire('click', {target: clickTarget('[data-food-item-action]', {foodItemAction: 'delete', itemId: '12', itemName: 'Curry', isTaken: 'true'})});
  assert.deepEqual(actions, [['move', 0, -1], ['rename', '1', 'Mains'], ['edit-item', '11'], ['delete-item', '12', 'Curry', true]]);
});

test('failed group drag reorder restores prior order and reports failure', async () => {
  const {context, els, calls, toasts} = setup({reorderOk: false});
  context.renderFoodGroupsList();
  const transfer = {data: {}, setData(type, value) { this.data[type] = value; }, getData(type) { return this.data[type]; }};
  const handle = {dataset: {groupId: '1'}, closest: selector => selector === '[data-food-group-drag]' ? handle : null};
  const target = {dataset: {groupId: '2'}, closest: selector => selector === '[data-food-group-row]' ? target : null};
  await els['admin-food-groups-list'].fire('dragstart', {target: handle, dataTransfer: transfer});
  await els['admin-food-groups-list'].fire('drop', {target, dataTransfer: transfer, preventDefault() {}});
  assert.equal(calls.length, 1);
  assert.equal(context.foodGroups[0].name, 'Mains');
  assert.ok(toasts.length, 'a failed API response should be reported');
});

test('items arriving before groups are rendered after groups load without losing filter', async () => {
  const {context, els} = setup();
  context.foodGroups = [];
  els['filter-group-select'].value = '2';
  context.fetch = async url => ({
    ok: true,
    json: async () => url === '/api/admin/food-items' ? context.foodItems : [
      {group_id: 1, name: 'Mains', item_count: 2, taken_count: 1, open_count: 1},
      {group_id: 2, name: 'Desserts', item_count: 1, taken_count: 0, open_count: 1},
    ],
  });
  await context.loadFoodItems();
  assert.equal(els['admin-food-items-list'].innerHTML, '');
  await context.loadFoodGroups();
  const html = els['admin-food-items-list'].innerHTML;
  assert.match(html, /data-food-items-group="2"/);
  assert.match(html, /Payasam/);
  assert.doesNotMatch(html, /data-food-items-group="1"|Rice|Curry/);
  assert.equal(els['filter-group-select'].value, '2');
});
