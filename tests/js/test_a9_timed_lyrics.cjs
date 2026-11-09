const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../../app/static');

// Test stage-monitor timed lyrics helper logic
const {selectLyricsDisplay, parseLrcClient} = require('../../app/static/js/stage-lyrics.js');

test('parseLrcClient handles standard timestamps and ignores header tags', () => {
  const lrc = `[ti:Test Title]
[00:10.00]First line
[00:20.50]Second line`;
  const result = parseLrcClient(lrc);
  assert.equal(result.isTimed, true);
  assert.equal(result.lines.length, 2);
  assert.equal(result.lines[0].time, 10);
  assert.equal(result.lines[0].text, 'First line');
  assert.equal(result.lines[1].time, 20.5);
  assert.equal(result.lines[1].text, 'Second line');
});

test('parseLrcClient falls back gracefully on untimed plain text', () => {
  const plain = 'Simple plain lyrics line 1\nLine 2';
  const result = parseLrcClient(plain);
  assert.equal(result.isTimed, false);
  assert.equal(result.lines.length, 0);
  assert.equal(result.raw, plain);
});

test('selectLyricsDisplay picks current line bold with dim previous and next', () => {
  const lines = [
    {time: 10, text: 'First line'},
    {time: 20, text: 'Second line'},
    {time: 30, text: 'Third line'}
  ];

  // At t = 5 (before first line)
  const d0 = selectLyricsDisplay(lines, 5);
  assert.equal(d0.prev, '');
  assert.equal(d0.current, '');
  assert.equal(d0.next, 'First line');

  // At t = 15 (during first line)
  const d1 = selectLyricsDisplay(lines, 15);
  assert.equal(d1.prev, '');
  assert.equal(d1.current, 'First line');
  assert.equal(d1.next, 'Second line');

  // At t = 25 (during second line)
  const d2 = selectLyricsDisplay(lines, 25);
  assert.equal(d2.prev, 'First line');
  assert.equal(d2.current, 'Second line');
  assert.equal(d2.next, 'Third line');

  // At t = 35 (during third / last line)
  const d3 = selectLyricsDisplay(lines, 35);
  assert.equal(d3.prev, 'Second line');
  assert.equal(d3.current, 'Third line');
  assert.equal(d3.next, '');
});

test('stage-monitor.html has lyrics-panel with timed display elements', () => {
  const html = fs.readFileSync(path.join(root, 'stage-monitor.html'), 'utf8');
  assert.match(html, /id="lyrics-panel"/);
  assert.match(html, /id="lyrics-timed"/);
  assert.match(html, /id="lyrics-current"/);
});
