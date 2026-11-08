const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
  constructor() { this.listeners = {}; this.files = []; this.value = ''; this.innerHTML = ''; this.textContent = ''; this.disabled = false; this.attributes = {}; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  async fire(type, event = {}) { for (const fn of [...(this.listeners[type] || [])]) await fn(Object.assign({target: this}, event)); }
  click() { this.clickCount = (this.clickCount || 0) + 1; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
}

function setup({autoSettingsLoaded = true, unauthorizedFirstGallery = false, duplicateScript = false} = {}) {
  const ids = ['setting-event-poster-url', 'poster-upload-input', 'poster-upload-btn', 'poster-upload-status',
    'gallery-upload-input', 'gallery-upload-btn', 'gallery-upload-status', 'gallery-assets-list'];
  const els = Object.fromEntries(ids.map(id => [id, new Element()]));
  els['setting-event-poster-url'].value = 'https://example.com/custom-poster.jpg';
  const docListeners = {};
  const document = {
    getElementById: id => els[id] || null,
    addEventListener: (type, fn) => { (docListeners[type] ||= []).push(fn); },
    dispatchEvent: async event => { for (const fn of docListeners[event.type] || []) await fn(event); },
  };
  const gallery = [{name: 'sponsor.jpg', url: '/event-media/gallery/sponsor.jpg'}, {name: 'spot.mp4', url: '/event-media/gallery/spot.mp4'}];
  const calls = [];
  let galleryLoads = 0;
  const fetch = async (url, options = {}) => {
    calls.push({url, options});
    if (url === '/api/admin/gallery' && !options.method) {
      galleryLoads++;
      if (unauthorizedFirstGallery && galleryLoads === 1) return {ok: false, status: 401, json: async () => ({})};
      return {ok: true, json: async () => ({files: gallery.slice()})};
    }
    if (url === '/api/admin/gallery' && options.method === 'POST') return {ok: true, json: async () => ({})};
    if (url === '/api/admin/gallery' && options.method === 'DELETE') return {ok: true, json: async () => ({})};
    if (url === '/api/admin/gallery/order') return {ok: true, json: async () => ({})};
    if (url === '/api/admin/poster') return {ok: true, json: async () => ({url: '/event-media/poster.mp4'})};
    return {ok: false, status: 404, json: async () => ({})};
  };
  const context = {console, document, fetch, confirm: () => true, FormData: class { constructor() { this.items = []; } append(...args) { this.items.push(args); } }};
  context.window = context;
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '../../app/static/js/settings/media-assets.js'), 'utf8');
  vm.runInContext(source, context, {filename: 'media-assets.js'});
  if (duplicateScript) vm.runInContext(source, context, {filename: 'media-assets-duplicate.js'});
  const startup = autoSettingsLoaded ? document.dispatchEvent({type: 'etm:settings-loaded'}) : Promise.resolve();
  for (const fn of docListeners.DOMContentLoaded || []) fn();
  return {els, calls, gallery, document, startup};
}

test('media controls load the ordered gallery and expose upload and delete hooks', async () => {
  const h = setup();
  await h.startup;
  await new Promise(setImmediate);
  assert.ok(h.calls.some(c => c.url === '/api/admin/gallery'));
  assert.match(h.els['gallery-assets-list'].innerHTML, /sponsor\.jpg/);
  assert.match(h.els['gallery-assets-list'].innerHTML, /spot\.mp4/);
  assert.match(h.els['gallery-assets-list'].innerHTML, /data-gallery-action="delete"/);
  assert.match(h.els['gallery-assets-list'].innerHTML, /data-gallery-action="up"/);
});

test('poster upload uses multipart file and fills the existing poster URL setting', async () => {
  const h = setup();
  await h.startup;
  await new Promise(setImmediate);
  h.els['poster-upload-input'].files = [{name: 'poster.mp4', type: 'video/mp4'}];
  await h.els['poster-upload-input'].fire('change');
  const req = h.calls.find(c => c.url === '/api/admin/poster');
  assert.equal(req.options.method, 'POST');
  assert.deepEqual(req.options.body.items, [['file', h.els['poster-upload-input'].files[0]]]);
  assert.equal(h.els['setting-event-poster-url'].value, '/event-media/poster.mp4');
});

test('gallery upload, delete and reorder use the documented API contracts', async () => {
  const h = setup();
  await h.startup;
  await new Promise(setImmediate);
  h.els['gallery-upload-input'].files = [{name: 'new.png', type: 'image/png'}];
  await h.els['gallery-upload-input'].fire('change');
  const upload = h.calls.find(c => c.url === '/api/admin/gallery' && c.options.method === 'POST');
  assert.deepEqual(upload.options.body.items, [['file', h.els['gallery-upload-input'].files[0]]]);

  const list = h.els['gallery-assets-list'];
  const deleteButton = {dataset: {galleryAction: 'delete', galleryName: 'sponsor.jpg'}};
  await list.fire('click', {target: {closest: selector => selector === '[data-gallery-action]' ? deleteButton : null}});
  const deletion = h.calls.find(c => c.options.method === 'DELETE');
  assert.deepEqual(JSON.parse(deletion.options.body), {filename: 'sponsor.jpg'});

  const upButton = {dataset: {galleryAction: 'up', galleryName: 'spot.mp4'}};
  await list.fire('click', {target: {closest: selector => selector === '[data-gallery-action]' ? upButton : null}});
  const reorder = h.calls.find(c => c.url === '/api/admin/gallery/order');
  assert.equal(reorder.options.method, 'PUT');
  assert.deepEqual(JSON.parse(reorder.options.body), {filenames: ['spot.mp4', 'sponsor.jpg']});
});

test('gallery loading waits for authenticated settings and initializes once', async () => {
  const h = setup({autoSettingsLoaded: false, unauthorizedFirstGallery: true, duplicateScript: true});
  assert.equal(h.calls.filter(c => c.url === '/api/admin/gallery' && !c.options.method).length, 0);
  await h.document.dispatchEvent({type: 'etm:settings-loaded'});
  await new Promise(setImmediate);
  assert.equal(h.calls.filter(c => c.url === '/api/admin/gallery' && !c.options.method).length, 1);
  assert.match(h.els['gallery-upload-status'].textContent, /401/);
  await h.document.dispatchEvent({type: 'etm:settings-loaded'});
  await new Promise(setImmediate);
  assert.equal(h.calls.filter(c => c.url === '/api/admin/gallery' && !c.options.method).length, 2);
  assert.match(h.els['gallery-assets-list'].innerHTML, /sponsor\.jpg/);
});

test('home and Live markup provide video media targets for uploaded mp4 assets', () => {
  const root = path.join(__dirname, '../../app/static');
  const homeHtml = fs.readFileSync(path.join(root, 'landing.html'), 'utf8');
  const homeJs = fs.readFileSync(path.join(root, 'js/guest-home.js'), 'utf8');
  const liveHtml = fs.readFileSync(path.join(root, 'live.html'), 'utf8');
  const liveJs = fs.readFileSync(path.join(root, 'js/live/live-view.js'), 'utf8');
  assert.match(homeHtml, /id="event-poster-video"/);
  assert.match(homeJs, /createMediaElement/);
  assert.match(liveHtml, /id="carousel-video"/);
  assert.match(liveJs, /createMediaElement/);
});

test('event media controls keep phone tap targets at least 44px', () => {
  const root = path.join(__dirname, '../../app/static');
  const html = fs.readFileSync(path.join(root, 'admin-settings.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/admin-overview.css'), 'utf8');
  assert.match(html, /id="poster-upload-btn"/);
  assert.match(html, /id="gallery-upload-btn"/);
  const posterInput = html.match(/<input type="file" id="poster-upload-input"[^>]*>/)[0];
  assert.match(posterInput, /video\/mp4/);
  assert.doesNotMatch(posterInput, /video\/webm/);
  assert.match(css, /media-upload-btn[^}]*min-height:\s*44px/s);
});
