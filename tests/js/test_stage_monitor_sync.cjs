const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function load() {
  const source = fs.readFileSync(path.join(__dirname, '../../app/static/js/console/stage-monitor-sync.js'),'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

test('stage monitor broadcasts current audio, video and acoustic state', async()=>{
  let channel;
  global.BroadcastChannel = class {constructor(name){this.name=name;this.messages=[];channel=this;} postMessage(msg){this.messages.push(msg);}};
  const {createStageMonitorSync} = await load();
  let item = null;
  const state = () => ({item, wavesurfer:{getCurrentTime:()=>32}, isPlaying:true});
  const sync = createStageMonitorSync(state);
  assert.equal(channel.name,'stage_monitor_channel');
  sync.broadcast();
  assert.deepEqual(channel.messages.pop(),{type:'UNCUE'});
  item = {entry_id:'PK-001', performer_name:'Singer',song_title:'Song',track_status:'Uploaded',media_type:'audio'};
  sync.broadcast('PLAY');
  assert.deepEqual(channel.messages.pop(),{type:'PLAY',entryId:'PK-001',performerName:'Singer',partnerName:'',songTitle:'Song',mediaType:'audio',streamUrl:'/api/stream/PK-001',currentTime:32,isPlaying:true});
  item.media_type = 'video';
  channel.onmessage({data:{type:'REQUEST_STATE'}});
  assert.equal(channel.messages.pop().mediaType,'video');
  item.track_status = 'Acoustic';
  sync.broadcast();
  assert.equal(channel.messages.pop().mediaType,'acoustic');
  delete global.BroadcastChannel;
});

test('stage monitor degrades without channel and opens the expected window',async()=>{
  delete global.BroadcastChannel;
  let args;
  global.window={open(...x){args=x;}};
  const {createStageMonitorSync,openStageMonitor} = await load();
  createStageMonitorSync(()=>{throw Error('must not read state without channel');}).broadcast();
  openStageMonitor();
  assert.deepEqual(args,['/console/stage-monitor','StageMonitor','width=1280,height=720,menubar=no,toolbar=no,location=no']);
});

test('console imports monitor module and offline shell precaches it',()=>{
  const root = path.join(__dirname,'../../app/static');
  assert.match(fs.readFileSync(path.join(root,'js/console/stage-sync.js'),'utf8'),/from ["']\.\/stage-monitor-sync\.js["']/);
  assert.match(fs.readFileSync(path.join(root,'sw.js'),'utf8'),/["']\/static\/js\/console\/stage-monitor-sync\.js["']/);
});

test('uncue carries the next act when the console knows one', async () => {
  const {createStageMonitorSync} = await load();
  const posted = [];
  global.BroadcastChannel = class { postMessage(m) { posted.push(m); } };
  const sync = createStageMonitorSync(() => ({item: null, next: {performer_name: 'Maya Nair', song_title: 'Kannalane'}}));
  sync.broadcast('UNCUE');
  delete global.BroadcastChannel;
  assert.deepEqual(posted, [{type: 'UNCUE', nextPerformer: 'Maya Nair', nextSong: 'Kannalane'}]);
});
