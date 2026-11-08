// Every console module that admin.js (or admin.html) loads must be in the service worker shell.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../../app/static');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const sw = read('sw.js');
const shell = [...sw.match(/SHELL_URLS = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);

function consoleImports(src) {
  return [...src.matchAll(/from\s+["']\.\/(?:console\/)?([\w.-]+\.js)["']/g)].map(m => `/static/js/console/${m[1]}`);
}

// admin.js is a thin entry point; walk every console module reachable from it.
function reachableFromAdmin() {
  const seen = new Set();
  const todo = [...[...read('js/admin.js').matchAll(/from\s+["']\.\/console\/([\w.-]+\.js)["']/g)].map(m => `/static/js/console/${m[1]}`)];
  while (todo.length) {
    const url = todo.pop();
    if (seen.has(url)) continue;
    seen.add(url);
    for (const dep of consoleImports(read(url.replace('/static/', '')))) todo.push(dep);
  }
  return [...seen];
}

test('every console module reachable from admin.js is in the SW shell', () => {
  const imported = reachableFromAdmin();
  assert.ok(imported.length >= 13, 'expected the console imports to be found');
  for (const url of imported) assert.ok(shell.includes(url), `${url} missing from SHELL_URLS`);
});

test('every console module script referenced by admin.html is in the SW shell', () => {
  const html = read('admin.html');
  for (const m of html.matchAll(/(?:src|href)="(\/static\/js\/[^"?]+)/g)) {
    if (m[1].startsWith('/static/js/console/')) assert.ok(shell.includes(m[1]), `${m[1]} missing`);
  }
});

test('the ten new console modules are cached', () => {
  for (const n of ['transport', 'deck-policy', 'hold-confirm', 'fade', 'reorder', 'vault-sync', 'screens', 'login', 'wake-lock', 'output-device']) {
    assert.ok(shell.includes(`/static/js/console/${n}.js`), n);
  }
});

test('every SW shell URL points at a file that exists; live files are listed', () => {
  for (const url of shell) {
    if (!url.startsWith('/static/')) continue;
    const file = path.join(root, url.replace('/static/', '').split('?')[0]);
    assert.ok(fs.existsSync(file), `${url} does not exist`);
  }
  for (const f of ['/static/js/live/live-logic.js', '/static/js/live/wake-lock-lite.js']) assert.ok(shell.includes(f), f);
});

test('cache version was bumped past v14', () => {
  const v = Number(sw.match(/paattukoottam-console-v(\d+)/)[1]);
  assert.ok(v >= 15);
});

test('/live and API requests are never intercepted', () => {
  assert.match(sw, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(sw, /request\.mode === 'navigate' && url\.pathname !== '\/console'\) return/);
});
