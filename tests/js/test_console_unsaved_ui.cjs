const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('failed offline persistence keeps a visible unsaved warning', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../../app/static/js/admin.js'),'utf8');
  const start = source.indexOf('let offlineSaveFailure = false;');
  const end = source.indexOf("document.addEventListener('DOMContentLoaded'", start);
  const nodes = {'network-dot':{}, 'network-status-text':{}, 'network-status-indicator':{}};
  const messages = [];
  const context = {document:{getElementById:id=>nodes[id]}, navigator:{onLine:false},
    getOfflineActions:()=>[], coordinatedOfflineQueueAvailable:()=>false,
    appendOfflineAction:async()=>{throw Error('storage full')},
    showToast:(message,type)=>messages.push({message,type}),
    localStorage:{setItem(){throw Error('storage full')}}, queue:[]};
  vm.createContext(context);
  vm.runInContext(source.slice(start,end), context);
  assert.equal(await context.enqueueOfflineAction('uncue',null), false);
  assert.match(nodes['network-status-text'].textContent, /not queued for sync/);
  assert.match(messages[0].message, /not saved for sync/);
  assert.equal(messages[0].type,'error');
  assert.equal(context.persistQueueSnapshot(),false);
  assert.match(nodes['network-status-text'].textContent, /not queued for sync/);
});
