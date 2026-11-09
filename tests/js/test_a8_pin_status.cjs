const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../../app/static');

test('guest-admin.js includes pin-status check or warning for default PIN', () => {
  const code = fs.readFileSync(path.join(root, 'js/guest-admin.js'), 'utf8');
  assert.match(code, /pin-status/);
});

test('admin-settings.html includes edit verification switch in rules tab', () => {
  const html = fs.readFileSync(path.join(root, 'admin-settings.html'), 'utf8');
  assert.match(html, /id="setting-edit-verification"/);
});
