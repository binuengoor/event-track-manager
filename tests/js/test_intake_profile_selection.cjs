const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function setup(fetch) {
  const nodes = new Map();
  function node(id) {
    if (!nodes.has(id)) {
      const classes = new Set();
      nodes.set(id, { textContent: '', innerHTML: '', classList: {
        add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x),
      }});
    }
    return nodes.get(id);
  }
  const context = vm.createContext({
    document: { addEventListener() {}, getElementById: node }, window: {},
    localStorage: { setItem() {} }, console: { warn() {} }, fetch, URLSearchParams,
    encodeURIComponent,
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../app/static/js/intake.js'), 'utf8'), context);
  vm.runInContext('showToast = (message) => { window.lastError = message; }', context);
  return { context, node };
}

test('ambiguous profile clears old selection and keeps actions hidden', async () => {
  const { context, node } = setup(async () => ({ok: false, json: async () => ({detail: 'That display name matches more than one person.'})}));
  vm.runInContext("selectedPerformer = 'Mira N.'; selectedEntry = { entry_id: 'old' }; performerFoodSignup = { signup_id: 'old' }; window.performerProfileData = {performances: [{entry_id: 'old'}]}", context);
  await vm.runInContext("handlePerformerSelected('Mira N.')", context);
  assert.equal(vm.runInContext('selectedEntry', context), null);
  assert.equal(vm.runInContext('performerFoodSignup', context), null);
  assert.equal(context.window.performerProfileData, null);
  assert.match(context.window.lastError, /more than one/);
  for (const id of ['song-selection-section', 'upload-methods-section', 'food-cta-section', 'add-performance-btn', 'edit-performer-name-btn']) {
    assert.ok(node(id).classList.contains('hidden'), id);
  }
});

test('selection uses profile acts, not other public rows with the same display name', async () => {
  const { context, node } = setup(async () => ({ok: true, json: async () => ({food_enabled: false, performances: [], stage_performances_enabled: true})}));
  vm.runInContext("selectedPerformer = 'Mira N.'; performances = [{performer_name: 'Mira N.', entry_id: 'other'}]", context);
  await vm.runInContext("handlePerformerSelected('Mira N.')", context);
  assert.match(node('song-options-container').innerHTML, /No registered songs/);
  assert.equal(vm.runInContext('selectedEntry', context), null);
});

test('older response cannot replace the latest selection', async () => {
  let resolveOld;
  const oldResponse = new Promise(resolve => { resolveOld = resolve; });
  const { context } = setup(url => url.includes('Old') ? oldResponse : Promise.resolve({
    ok: true, json: async () => ({food_enabled: false, performances: [], stage_performances_enabled: true, performer_name: 'New'}),
  }));
  vm.runInContext("selectedPerformer = 'Old'", context);
  const oldLookup = vm.runInContext("handlePerformerSelected('Old')", context);
  vm.runInContext("selectedPerformer = 'New'", context);
  await vm.runInContext("handlePerformerSelected('New')", context);
  resolveOld({ok: true, json: async () => ({food_enabled: false, performances: [], performer_name: 'Old'})});
  await oldLookup;
  assert.equal(context.window.performerProfileData.performer_name, 'New');
});
