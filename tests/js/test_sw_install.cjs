const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup() {
  const handlers = {};
  const cacheMap = new Map([['paattukoottam-console-v4', new Map([['https://event.test/console', {tag:'old shell'}]])]]);
  let offline = false, failPath = '', skipped = false;
  const key = (request) => new URL(typeof request === 'string' ? request : request.url, 'https://event.test').href;
  const caches = {
    async open(name) {
      if (!cacheMap.has(name)) cacheMap.set(name, new Map());
      const cache = cacheMap.get(name);
      return {async put(request, response) { cache.set(key(request), response); }};
    },
    async match(request) {
      for (const cache of cacheMap.values()) if (cache.has(key(request))) return cache.get(key(request));
    },
    async keys() {return [...cacheMap.keys()];},
    async delete(name) {return cacheMap.delete(name);},
  };
  const self = {location: {origin:'https://event.test'},
    addEventListener(name, fn) {handlers[name] = fn;},
    async skipWaiting() {skipped = true;}, clients: {async claim(){}}};
  async function fetch(request) {
    if (offline) throw Error('offline');
    const target = key(request);
    return {ok: !target.endsWith(failPath) || !failPath, tag: target, clone(){return this;}};
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../app/static/sw.js'), 'utf8'), {URL, console, self, caches, fetch});
  return {handlers, cacheMap, setOffline: () => {offline = true;}, setFailure: (p) => {failPath = p;}, skipped: () => skipped};
}

function install(env) {
  let promise;
  env.handlers.install({waitUntil(p) {promise = p;}});
  return promise;
}

test('pre-cached console module loads offline even with a new timestamp query', async () => {
  const env = setup();
  await install(env);
  assert.equal(env.skipped(), true);
  env.setOffline();
  let response;
  env.handlers.fetch({request: {method:'GET', mode:'cors', url:'https://event.test/static/js/admin.js?v=123456'}, respondWith(p){response = p;}});
  assert.equal((await response).tag, 'https://event.test/static/js/admin.js');
  let imported;
  env.handlers.fetch({request: {method:'GET', mode:'cors', url:'https://event.test/static/js/console/vault-store.js'}, respondWith(p){imported = p;}});
  assert.equal((await imported).tag, 'https://event.test/static/js/console/vault-store.js');
});

test('failure to fetch a core shell file prevents replacement of working worker', async () => {
  const env = setup();
  env.setFailure('/static/js/console/vault-store.js');
  await assert.rejects(install(env), /Could not cache console shell/);
  assert.equal(env.skipped(), false);
  assert.equal(env.cacheMap.get('paattukoottam-console-v4').get('https://event.test/console').tag, 'old shell');
});
