const { test } = require('node:test');
const assert = require('node:assert/strict');
const qr = require('../../app/static/js/live/qr.js');

test('qr: finder patterns, sizes and svg output', () => {
  const e = qr.encode('https://event.test/signup');
  assert.equal(e.size, 17 + 4 * e.version);
  for (const [r, c] of [[0, 0], [0, e.size - 7], [e.size - 7, 0]]) {
    for (let i = 0; i < 7; i++) assert.ok(e.modules[r][c + i] && e.modules[r + 6][c + i] && e.modules[r + i][c] && e.modules[r + i][c + 6]);
    assert.equal(e.modules[r + 3][c + 3], true);
    assert.equal(e.modules[r + 1][c + 1], false);
  }
  const svg = qr.toSvg('https://event.test/signup', { label: 'QR "x"' });
  assert.match(svg, /^<svg[^>]*role="img"[^>]*aria-label="QR &quot;x&quot;"/);
});
test('qr: too-long text throws, multi-byte fits by byte length', () => {
  assert.throws(() => qr.encode('x'.repeat(200)));
  assert.doesNotThrow(() => qr.encode('é'.repeat(50)));
});
