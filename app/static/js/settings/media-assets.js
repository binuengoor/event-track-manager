/* Event poster and sponsor-gallery uploads for the Event Details panel. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
  const isVideo = (url) => /\.(mp4|webm)(?:[?#].*)?$/i.test(String(url));
  let gallery = [];
  let galleryLoadPromise = null;

  async function request(url, options) {
    const response = await fetch(url, options);
    if (!response.ok) {
      let message = `Request failed (${response.status})`;
      try { const data = await response.json(); if (data.detail) message = data.detail; } catch (_) {}
      throw new Error(message);
    }
    return response;
  }

  function renderGallery() {
    const list = $('gallery-assets-list');
    if (!list) return;
    if (!gallery.length) { list.innerHTML = '<li class="as-help">No gallery media uploaded yet.</li>'; return; }
    list.innerHTML = gallery.map((file, index) => {
      const name = escapeHtml(file.name), url = escapeHtml(file.url);
      const preview = isVideo(file.url)
        ? `<video src="${url}" muted playsinline preload="metadata" aria-label="Preview ${name}"></video>`
        : `<img src="${url}" alt="Preview ${name}" loading="lazy">`;
      return `<li class="media-asset-row"><div class="media-asset-preview">${preview}<span>${name}</span></div>` +
        `<div class="media-asset-actions"><button type="button" data-gallery-action="up" data-gallery-name="${name}" aria-label="Move ${name} up" ${index === 0 ? 'disabled' : ''}>↑</button>` +
        `<button type="button" data-gallery-action="down" data-gallery-name="${name}" aria-label="Move ${name} down" ${index === gallery.length - 1 ? 'disabled' : ''}>↓</button>` +
        `<button type="button" data-gallery-action="delete" data-gallery-name="${name}" aria-label="Delete ${name}">Delete</button></div></li>`;
    }).join('');
  }

  function loadGallery() {
    if (galleryLoadPromise) return galleryLoadPromise;
    galleryLoadPromise = (async () => {
      const response = await request('/api/admin/gallery');
      const data = await response.json();
      gallery = Array.isArray(data.files) ? data.files : [];
      renderGallery();
    })().finally(() => { galleryLoadPromise = null; });
    return galleryLoadPromise;
  }

  function showStatus(id, message, error) {
    const status = $(id);
    if (!status) return;
    status.textContent = message;
    status.setAttribute('data-error', error ? 'true' : 'false');
  }

  function bindUpload(buttonId, inputId, endpoint, statusId, done) {
    const button = $(buttonId), input = $(inputId);
    if (!button || !input) return;
    button.addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      const files = Array.from(input.files || []);
      if (!files.length) return;
      showStatus(statusId, 'Uploading…', false);
      try {
        for (const file of files) {
          const body = new FormData();
          body.append('file', file);
          const response = await request(endpoint, {method: 'POST', body});
          if (done) await done(response);
        }
        input.value = '';
        showStatus(statusId, files.length === 1 ? 'Upload complete.' : `${files.length} uploads complete.`, false);
        if (endpoint === '/api/admin/gallery') await loadGallery();
      } catch (error) {
        if (endpoint === '/api/admin/gallery') { try { await loadGallery(); } catch (_) {} }
        showStatus(statusId, error.message || 'Upload failed.', true);
      }
    });
  }

  async function init() {
    if (window.etmMediaAssetsInitialized) return;
    window.etmMediaAssetsInitialized = true;
    const list = $('gallery-assets-list');
    if (list) {
      list.addEventListener('click', async (event) => {
        const button = event.target.closest && event.target.closest('[data-gallery-action]');
        if (!button || button.disabled) return;
        const name = button.dataset.galleryName;
        try {
          if (button.dataset.galleryAction === 'delete') {
            if (!window.confirm(`Delete ${name} from the gallery?`)) return;
            await request('/api/admin/gallery', {method: 'DELETE', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({filename: name})});
          } else {
            const reordered = gallery.slice();
            const index = reordered.findIndex(file => file.name === name);
            const next = index + (button.dataset.galleryAction === 'up' ? -1 : 1);
            if (index < 0 || next < 0 || next >= reordered.length) return;
            [reordered[index], reordered[next]] = [reordered[next], reordered[index]];
            await request('/api/admin/gallery/order', {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({filenames: reordered.map(file => file.name)})});
            gallery = reordered;
          }
          await loadGallery();
        } catch (error) { showStatus('gallery-upload-status', error.message || 'Gallery update failed.', true); }
      });
      document.addEventListener('etm:settings-loaded', () => {
        loadGallery().catch(error => showStatus('gallery-upload-status', error.message || 'Could not load gallery.', true));
      });
    }

    bindUpload('poster-upload-btn', 'poster-upload-input', '/api/admin/poster', 'poster-upload-status', async (response) => {
      const data = await response.json();
      if (data.url && $('setting-event-poster-url')) $('setting-event-poster-url').value = data.url;
    });
    bindUpload('gallery-upload-btn', 'gallery-upload-input', '/api/admin/gallery', 'gallery-upload-status');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
