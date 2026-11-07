const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function consoleContext() {
  const source = fs.readFileSync(path.join(__dirname, '../../app/static/js/admin.js'),'utf8');
  const block = source.slice(source.indexOf('let offlineSaveFailure = false;'), source.indexOf("document.addEventListener('DOMContentLoaded'"));
  const updates = source.slice(source.indexOf('async function updateStatus('),source.indexOf('function updatePlayerBarNotes('));
  const nodes = {'network-dot':{}, 'network-status-text':{}, 'network-status-indicator':{}};
  const calls = [], messages = [];
  let failStorage = true, failFetch = false, failAppend = false;
  const context = {
    document:{getElementById:id=>nodes[id]}, navigator:{onLine:true},
    getOfflineActions:()=>[], coordinatedOfflineQueueAvailable:()=>true,
    appendOfflineAction:async()=>{if (failAppend) throw Error('storage full')},
    fetch:async(url,opts)=>{calls.push({url,opts}); if (failFetch) throw Error('network'); return {ok:true,json:async()=>({stage_notes:'Hello'})}},
    localStorage:{setItem(){if (failStorage) throw Error('storage full')}},
    showToast:(message,type)=>messages.push({message,type}), getAuthHeaders:()=>({}),
    queue:[{entry_id:'PK-001',performance_status:'Upcoming',stage_notes:''}], currentCuedItem:null,
    updateQueueStatsSummary(){}, applyFilter(){}, renderQueueList(){}, updatePlayerBarState(){}, updatePlayerBarNotes(){},
  };
  vm.createContext(context);vm.runInContext(block+'\n'+updates,context);
  return {context, nodes, calls, messages, setStorage:value=>{failStorage=value}, setFetch:value=>{failFetch=value}, setAppend:value=>{failAppend=value}};
}

test('online changes reach the server even when the local snapshot cannot be written', async()=>{
  const {context,nodes,calls,setStorage} = consoleContext();
  await context.updateStatus('PK-001','Done');
  await context.updateStageNotes('PK-001','Hello');
  assert.deepEqual(calls.map(x=>x.url), ['/api/status/PK-001','/api/performance-notes/PK-001']);
  assert.equal(nodes['network-status-text'].textContent,'Offline copy unavailable');
  setStorage(false);
  assert.equal(context.persistQueueSnapshot(),true);
  assert.equal(nodes['network-status-text'].textContent,'Online');
});

test('unsaved action warning remains through unrelated success and clears after matching server update', async()=>{
  const {context,nodes,setStorage,setFetch,setAppend} = consoleContext();
  setStorage(false);setFetch(true);setAppend(true);
  await context.updateStatus('PK-001','Done');
  assert.match(nodes['network-status-text'].textContent,/not queued/);
  setFetch(false);
  await context.updateStageNotes('PK-001','Hello');
  assert.match(nodes['network-status-text'].textContent,/not queued/);
  await context.updateStatus('PK-001','Done');
  assert.equal(nodes['network-status-text'].textContent,'Online');
});
