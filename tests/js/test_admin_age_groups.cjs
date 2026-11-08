const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
  constructor() { this.listeners = {}; this.children = []; this.value = ''; this.checked = false; this.textContent = ''; this.innerHTML = ''; this.dataset = {}; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); return child; }
  async fire(type, event = {}) { for (const fn of [...(this.listeners[type] || [])]) await fn(Object.assign({target: this}, event)); }
}

const root = path.join(__dirname, '../../app/static');

test('Rules panel provides an add-description control for age groups', () => {
  const html = fs.readFileSync(path.join(root, 'admin-settings.html'), 'utf8');
  assert.match(html, /id="new-ag-description"/);
  assert.match(html, /Name, description and guardian rule/);
});

test('adding an age group retains name, description and guardian requirement', async () => {
  const els = {'add-ag-btn': new Element(), 'new-ag-name': new Element(), 'new-ag-description': new Element(), 'new-ag-guardian': new Element()};
  const document = {getElementById: id => els[id] || null, querySelectorAll: () => []};
  const context = {document, window: null, ageGroups: [], renderAgeGroupsTable() {}};
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/settings/action-handlers.js'), 'utf8'), context);
  context.setupActionHandlers();
  els['new-ag-name'].value = 'Little ones';
  els['new-ag-description'].value = 'A parent should help';
  els['new-ag-guardian'].checked = true;
  await els['add-ag-btn'].fire('click');
  assert.equal(JSON.stringify(context.ageGroups), JSON.stringify([{name: 'Little ones', description: 'A parent should help', requires_guardian: true}]));
});

test('age-group rows edit existing values safely and keep legacy descriptions blank', () => {
  const row = new Element();
  const document = {addEventListener() {}, getElementById: id => id === 'age-groups-table-container' ? row : null};
  const context = {document, window: null};
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/admin-settings.js'), 'utf8'), context);
  vm.runInContext(`ageGroups = [
    {name: '<script>alert(1)</script>', description: 'Under 13', requires_guardian: true},
    {name: 'Adult', requires_guardian: false}
  ]; renderAgeGroupsTable();`, context);
  assert.match(row.innerHTML, /data-age-group-field="name"/);
  assert.match(row.innerHTML, /data-age-group-field="description"/);
  assert.match(row.innerHTML, /data-age-group-field="requires_guardian"/);
  assert.match(row.innerHTML, /value="&lt;script&gt;alert\(1\)&lt;\/script&gt;"/);
  assert.doesNotMatch(row.innerHTML, /<script>alert\(1\)<\/script>/);
  assert.match(row.innerHTML, /data-age-group-field="name" value="Adult"/);
  assert.match(row.innerHTML, /data-age-group-field="description"[^>]*><\/textarea>/);
});

test('editing age-group fields updates the rules payload model', async () => {
  const row = new Element();
  const document = {addEventListener() {}, getElementById: id => id === 'age-groups-table-container' ? row : null};
  const context = {document, window: null};
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/admin-settings.js'), 'utf8'), context);
  vm.runInContext(`ageGroups = [{name: 'Junior', description: '', requires_guardian: true}]; renderAgeGroupsTable();`, context);
  await row.fire('input', {target: {dataset: {ageGroupIndex: '0', ageGroupField: 'name'}, value: 'Youth'}});
  await row.fire('input', {target: {dataset: {ageGroupIndex: '0', ageGroupField: 'description'}, value: 'Under 13'}});
  await row.fire('change', {target: {dataset: {ageGroupIndex: '0', ageGroupField: 'requires_guardian'}, checked: false}});
  assert.equal(vm.runInContext('ageGroups[0].name', context), 'Youth');
  assert.equal(vm.runInContext('ageGroups[0].description', context), 'Under 13');
  assert.equal(vm.runInContext('ageGroups[0].requires_guardian', context), false);
});

test('sign-up radios display configured descriptions and keep missing legacy descriptions empty', () => {
  const box = new Element();
  const elements = { 'age-group-options': box };
  const document = {createElement: () => new Element()};
  const context = {document, state: {choice: 'perform'}, $: id => elements[id], setErr() {}, updateGuardian() {}};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/signup/sections.js'), 'utf8'), context);
  context.updateGuardian = () => {};
  vm.runInContext(`renderAgeGroups([
    {name: 'Adult', description: 'For adult participants', requires_guardian: false},
    {name: 'Junior', description: 'Under 13', requires_guardian: true},
    {name: 'Legacy', requires_guardian: false}
  ])`, context);
  assert.equal(box.children.length, 3);
  assert.equal(box.children[0].children[2].textContent, 'For adult participants');
  assert.equal(box.children[1].children[2].textContent, 'Under 13');
  assert.equal(box.children[2].children.length, 2);
});

test('age-group editor controls have 44px phone targets', () => {
  const css = fs.readFileSync(path.join(root, 'css/admin-setup.css'), 'utf8');
  assert.match(css, /as-age-group-row[^}]*min-height:\s*44px/s);
});
