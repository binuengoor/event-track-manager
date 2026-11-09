// Static checks on the venue screen and stage monitor markup/scripts.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../../app/static');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const liveFiles = ['live.html', 'js/live/live-view.js'];
const liveSrc = liveFiles.map(read).join('\n');

test('live: no admin/console navigation or admin calls', () => {
  assert.doesNotMatch(liveSrc, /href="\/(admin|console)/);
  assert.doesNotMatch(liveSrc, /\/api\/sync/);
  assert.doesNotMatch(liveSrc, /nav\.js/);
});
test('live: no age badges, stage notes or phones are rendered', () => {
  assert.doesNotMatch(liveSrc, /age_group|renderCategoryBadge|junior/i);
  assert.doesNotMatch(liveSrc, /stage_notes|stage-notes/);
  assert.doesNotMatch(liveSrc, /phone/i);
});
test('live: sanitized acoustic flag is consumed by the venue screen', () => {
  assert.match(read('js/live/live-view.js'), /L\.isAcousticAct\(np\)/);
});
test('live: uses etm-live channel, wake lock, refresh without POST, signup QR with aria-label', () => {
  assert.match(liveSrc, /etm-live/);
  assert.match(read('js/live/wake-lock-lite.js'), /visibilitychange/);
  assert.match(liveSrc, /wake-lock-lite/);
  assert.doesNotMatch(read('js/live/live-view.js'), /method:\s*'POST'/);
  assert.match(read('live.html'), /id="signup-qr"[^>]*>/);
  assert.match(read('js/live/live-view.js'), /aria-label/);
  assert.match(read('css/live.css'), /#signup-qr \{ width: 56px/);  // >= 56 px (88 px before the show)
});
test('live: header keeps a nav element (page shell rewrites it) and ended state exists', () => {
  const html = read('live.html');
  assert.match(html, /<header[^>]*>[\s\S]*<nav[\s\S]*<\/nav>[\s\S]*<\/header>/);
  assert.match(html, /id="ended-card"/);
});
test('live and monitor: no font size below 24px', () => {
  for (const f of ['live.html', 'css/live.css', 'stage-monitor.html']) {
    const css = read(f);
    for (const m of css.matchAll(/font-size:\s*([^;}]+)[;}]/g)) {
      const v = m[1].trim();
      const px = v.match(/^(\d+(?:\.\d+)?)px$/);
      if (px) assert.ok(Number(px[1]) >= 24, `${f}: ${v}`);
      const clamp = v.match(/^clamp\((\d+)px/);
      if (clamp) assert.ok(Number(clamp[1]) >= 24, `${f}: ${v}`);
    }
    assert.doesNotMatch(css, /text-(xs|sm|\[1\d px\])|text-\[(\d|1\d)px\]/);
  }
});
test('monitor: handles ANNOUNCEMENT, FADE_BLACK, LYRICS, never sends the dev notes, has disconnected notice', () => {
  const js = read('js/stage-monitor.js');
  for (const t of ['ANNOUNCEMENT', 'FADE_BLACK', 'LYRICS', 'REQUEST_STATE']) assert.match(js, new RegExp(t));
  assert.match(js, /EtmWakeLock/);
  const html = read('stage-monitor.html');
  assert.match(html, /Waiting for the console/);
  assert.match(html, /<video[^>]*muted/);
  assert.doesNotMatch(html + js, /stage_notes|act note|developer/i);
  assert.match(html, /\/static\/js\/stage-monitor\.js/);
});
