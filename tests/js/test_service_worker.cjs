const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function worker({offline = true} = {}) {
  const handlers = {};
  const cache = new Map([['/console', {name: 'console'}], ['/static/admin.html', {name: 'admin'}]]);
  const context = {
    URL, console,
    self: { location: {origin: 'https://event.test'}, addEventListener: (name, fn) => {handlers[name] = fn;} },
    fetch: async () => {if (offline) throw new Error('offline'); return {ok: true, clone() {return this;}};},
    caches: { match: async (key) => cache.get(typeof key === 'string' ? key : key.url), open: async () => ({put: async () => {}}) },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../app/static/sw.js'), 'utf8'), context);
  return function dispatch(pathname, mode = 'navigate', method = 'GET') {
    let response;
    const url = pathname.startsWith('https:') ? pathname : `https://event.test${pathname}`;
    handlers.fetch({request: {url, mode, method}, respondWith(p) {response = p;}});
    return response;
  };
}

test('only console navigation uses console offline shell', async () => {
  const dispatch = worker();
  assert.equal((await dispatch('/console')).name, 'console');
  for (const page of ['/', '/signup', '/performer', '/dashboard', '/live', '/console/stage-monitor', '/admin']) {
    assert.equal(dispatch(page), undefined, page);
  }
});

test('only same-origin non-HTML static GETs get asset fallback', () => {
  const dispatch = worker();
  assert.ok(dispatch('/static/css/style.css', 'no-cors'));
  assert.equal(dispatch('/static/admin.html', 'no-cors'), undefined);
  assert.equal(dispatch('/static/data.json', 'no-cors'), undefined);
  assert.equal(dispatch('/api/event-info', 'no-cors'), undefined);
  assert.equal(dispatch('https://other.test/static/x.js', 'no-cors'), undefined);
  assert.equal(dispatch('/static/x.js', 'no-cors', 'POST'), undefined);
});
