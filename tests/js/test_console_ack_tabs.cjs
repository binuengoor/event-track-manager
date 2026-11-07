const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function makeTabs() {
  const source = fs.readFileSync(path.join(__dirname, '../../app/static/js/admin.js'),'utf8');
  const script = source.slice(source.indexOf('let offlineSaveFailure = false;'),source.indexOf("document.addEventListener('DOMContentLoaded'"));
  const channels = [];
  const pending = [];
  class Channel {
    constructor() {channels.push(this);}
    postMessage(data) {for (const other of channels) if (other !== this) other.onmessage?.({data});}
  }
  const create = () => {
    const nodes = {'network-dot':{}, 'network-status-text':{}, 'network-status-indicator':{}};
    let fail = false;
    const context = {BroadcastChannel:Channel, console, navigator:{onLine:true},
      document:{getElementById:id=>nodes[id]}, getOfflineActions:()=>pending,
      appendOfflineAction:async action=>{if (fail) throw Error('storage full'); pending.push(action);},
      drainOfflineQueue:async(headers,fetch,timeout,ack)=>{const action=pending.shift(); ack(action); return 1;},
      localStorage:{setItem(){}}, queue:[], coordinatedOfflineQueueAvailable:()=>true,
      showToast(){}, getAuthHeaders:()=>({}), fetch(){}, loadQueue:async()=>{}};
    vm.createContext(context); vm.runInContext(script,context);
    return {context,nodes,setFail:value=>{fail=value}};
  };
  return {create,pending};
}

test('another tab replay acknowledges originating intent without clearing newer failures', async()=>{
  const {create} = makeTabs(); const a=create(), b=create();
  a.setFail(true);
  await a.context.enqueueOfflineAction('uncue',null,{},a.context.beginAction());
  assert.match(a.nodes['network-status-text'].textContent,/not queued/);
  a.setFail(false);
  await a.context.enqueueOfflineAction('uncue',null,{},a.context.beginAction());
  b.context.syncOfflineActions();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(a.nodes['network-status-text'].textContent,'Online');

  a.setFail(true);
  await a.context.enqueueOfflineAction('uncue',null,{},a.context.beginAction());
  a.setFail(false);
  const queued = a.context.beginAction();
  await a.context.enqueueOfflineAction('uncue',null,{},queued);
  a.setFail(true);
  await a.context.enqueueOfflineAction('uncue',null,{},a.context.beginAction());
  await b.context.syncOfflineActions();
  assert.match(a.nodes['network-status-text'].textContent,/not queued/);
});
