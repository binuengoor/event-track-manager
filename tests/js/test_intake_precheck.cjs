const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function load(script) {
  const context = vm.createContext({ Number, Math, String, escapeHtml: (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])) });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../app/static/js/intake', script), 'utf8'), context);
  return context;
}

function loadProfileAndUpload() {
  const context = load('profile.js');
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../app/static/js/intake/upload.js'), 'utf8'), context);
  return context;
}

test('upload precheck summarizes measured values and pending loudness', () => {
  const context = load('upload.js');
  const html = vm.runInContext("renderTrackChecks({duration_s: 182.4, loudness_lufs: null, gain_db: null, format_ok: true})", context);
  assert.match(html, /Pre-check passed/);
  assert.match(html, /3:02/);
  assert.match(html, /Not available yet; check again shortly/);
});

test('upload precheck explains unsupported format and reports measurements', () => {
  const context = load('upload.js');
  const html = vm.runInContext("renderTrackChecks({duration_s: 45, loudness_lufs: -12.5, gain_db: 1.5, format_ok: false})", context);
  assert.match(html, /Format needs attention/);
  assert.match(html, /45 sec/);
  assert.match(html, /-12.5 LUFS/);
  assert.match(html, /\+1.5 dB/);
});

test('unknown format is not reported as a passed pre-check', () => {
  const context = load('upload.js');
  const html = vm.runInContext("renderTrackChecks({duration_s: 30, loudness_lufs: null, gain_db: null})", context);
  assert.match(html, /Pre-check incomplete/);
  assert.match(html, /Format check unavailable/);
  assert.doesNotMatch(html, /Pre-check passed/);
});

test('profile act card keeps pre-check results with the selected act', () => {
  const context = loadProfileAndUpload();
  const html = vm.runInContext("renderActPrecheck({checks: {duration_s: 125, loudness_lufs: -14, gain_db: 0.5, format_ok: true}})", context);
  assert.match(html, /Track pre-check results/);
  assert.match(html, /2:05/);
  assert.match(html, /-14.0 LUFS/);
});

test('acoustic act does not show a backing-track pre-check card', () => {
  const context = loadProfileAndUpload();
  const html = vm.runInContext("renderActPrecheck({track_status: 'Acoustic', checks: {duration_s: 125, format_ok: true}})", context);
  assert.equal(html, '');
  assert.equal(vm.runInContext("isAcousticAct({track_status: 'Acoustic'})", context), true);
});

test('late check refresh cannot overwrite a newer upload card', async () => {
  const context = load('upload.js');
  let resolveFetch;
  context.fetch = () => new Promise(resolve => { resolveFetch = resolve; });
  const previous = { outerHTML: 'old-card' };
  const details = { querySelector: () => previous };
  context.document = { getElementById: () => details };
  const firstToken = context.beginTrackUpload();
  const firstRefresh = context.refreshTrackChecksOnce('E-1', 'Singer', firstToken, details);
  context.beginTrackUpload();
  resolveFetch({ok: true, json: async () => ({performances: [{entry_id: 'E-1', checks: {duration_s: 10, format_ok: true}}]})});
  await firstRefresh;
  assert.equal(previous.outerHTML, 'old-card');
});

test('My Entry identifies live band from explicit acoustic status or safe derived flag', () => {
  const context = load('profile.js');
  assert.equal(vm.runInContext("isAcousticAct({track_status: 'Acoustic'})", context), true);
  assert.equal(vm.runInContext("isAcousticAct({is_acoustic: true})", context), true);
  assert.equal(vm.runInContext("isAcousticAct({track_status: 'Uploaded', is_acoustic: false})", context), false);
});
