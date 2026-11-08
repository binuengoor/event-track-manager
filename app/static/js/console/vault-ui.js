import { S, hooks, trackGains } from "./state.js";
import { escapeHtml, getAuthHeaders, showToast } from "./util.js";
import { VAULT_STORE_NAME, getAllCachedMeta, getCachedTrack, getVaultDb, getVaultTrackIds, saveCachedTrack } from "./vault-store.js";
import { fetchManifest, pillText, planVaultSync, runVaultSync } from "./vault-sync.js";

let vaultSyncRunning = false;
let vaultFailures = new Map();


export function updateRowCachePills() {
  document.querySelectorAll('[id^="queue-row-"]').forEach(row => {
    const entryId = row.dataset.entryId;
    if (!entryId) return;
    const isCached = S.cachedVaultEntryIds.has(entryId);

    // 1. Update the Cached status pill next to the track name & tags
    const cachedTag = row.querySelector('.vault-cached-tag');
    if (cachedTag) {
      if (isCached) {
        cachedTag.classList.remove('hidden');
      } else {
        cachedTag.classList.add('hidden');
      }
    }

    // 2. Update the Cache / Re-cache button in the action buttons area
    const cacheBtn = row.querySelector('.btn-cache-single');
    if (cacheBtn) {
      if (isCached) {
        cacheBtn.className = 'btn-cache-single c-act';
        cacheBtn.title = 'Track stored in browser Vault (Offline Safe). Click to re-cache fresh copy.';
        cacheBtn.innerHTML = '<i data-lucide="refresh-cw"></i><span>Re-cache</span>';
      } else {
        cacheBtn.className = 'btn-cache-single c-act c-act--info';
        cacheBtn.title = 'Pre-cache this audio track into local browser Vault without cueing';
        cacheBtn.innerHTML = '<i data-lucide="hard-drive-download"></i><span>Cache</span>';
      }
    }
  });
  if (window.lucide) lucide.createIcons();
}

export async function handleSingleTrackCache(entryId, btn) {
  const item = S.queue.find(q => q.entry_id === entryId);
  if (!item) return;

  btn.classList.add('is-busy');
  btn.innerHTML = `<i data-lucide="loader-2"></i><span>Caching...</span>`;
  if (window.lucide) lucide.createIcons();

  try {
    const res = await fetch(`/api/stream/${entryId}?t=${Date.now()}`);
    if (!res.ok) throw new Error('Download failed from server');
    const blob = await res.blob();
    await saveCachedTrack(entryId, blob, {
      song_title: item.song_title,
      performer_name: item.performer_name,
      sequence_order: item.sequence_order,
      track_version: item.track_version,
      last_updated: item.last_updated
    });
    S.cachedVaultEntryIds.add(entryId);
    await updateVaultStatusDisplay();
    showToast(`✓ Cached "${item.song_title}" into local Vault!`);
  } catch (err) {
    showToast(`Could not cache track: ${err.message}`, 'error');
  } finally {
    btn.classList.remove('is-busy');
    updateRowCachePills();
  }
}

export async function getVaultStats() {
  const db = await getVaultDb();
  if (!db) return { count: 0, totalBytes: 0 };
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(VAULT_STORE_NAME, 'readonly');
      const store = tx.objectStore(VAULT_STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const items = req.result || [];
        let totalBytes = 0;
        items.forEach(it => {
          totalBytes += (it.blob ? it.blob.size : (it.size_bytes || 0));
        });
        resolve({ count: items.length, totalBytes });
      };
      req.onerror = () => resolve({ count: 0, totalBytes: 0 });
    } catch (e) {
      resolve({ count: 0, totalBytes: 0 });
    }
  });
}

export async function updateVaultStatusDisplay() {
  S.cachedVaultEntryIds = await getVaultTrackIds();
  const vaultText = document.getElementById('vault-status-text');
  if (vaultText) {
    const meta = await getAllCachedMeta();
    let ready;
    let total;
    let bytes;
    if (S.vaultManifest) {
      const plan = planVaultSync(S.vaultManifest.tracks, meta);
      ready = plan.ready.length;
      total = plan.total;
      bytes = meta.reduce((n, r) => n + (r.size_bytes || 0), 0);
    } else {
      const readyTracks = S.queue.filter(it => (it.track_status || '').toLowerCase() === 'uploaded');
      total = readyTracks.length;
      ready = readyTracks.filter(it => S.cachedVaultEntryIds.has(it.entry_id)).length;
      bytes = meta.reduce((n, r) => n + (r.size_bytes || 0), 0);
    }
    vaultText.textContent = pillText({ ready, total, bytes });
    const pill = document.getElementById('vault-status-indicator');
    if (pill && pill.setAttribute) pill.setAttribute('data-state', total > 0 && ready >= total ? 'ok' : 'warn');
  }
  updateRowCachePills();
  renderVaultSheet();
}

// Vault sheet: per-act list, failures first so they can be retried.
export async function renderVaultSheet() {
  const sheet = document.getElementById('vault-sheet');
  if (!sheet || sheet.classList.contains('hidden')) return;
  const list = document.getElementById('vault-sheet-list');
  const summary = document.getElementById('vault-sheet-summary');
  const meta = new Map((await getAllCachedMeta()).map(r => [r.entry_id, r]));
  const entries = S.vaultManifest ? S.vaultManifest.tracks
    : S.queue.filter(it => (it.track_status || '').toLowerCase() === 'uploaded').map(it => ({ entry_id: it.entry_id, size: 0 }));
  const rows = entries.map(e => {
    const item = S.queue.find(q => q.entry_id === e.entry_id) || {};
    const rec = meta.get(e.entry_id);
    const failed = vaultFailures.get(e.entry_id);
    const state = failed ? 'failed' : (rec ? 'ready' : 'missing');
    return { e, item, rec, state, failed };
  }).sort((a, b) => ({ failed: 0, missing: 1, ready: 2 })[a.state] - ({ failed: 0, missing: 1, ready: 2 })[b.state]);
  const readyCount = rows.filter(r => r.state === 'ready').length;
  const bytes = [...meta.values()].reduce((n, r) => n + (r.size_bytes || 0), 0);
  if (summary) summary.textContent = `${readyCount} of ${rows.length} acts ready, ${Math.round(bytes / (1024 * 1024))} MB`;
  const meter = document.getElementById('vault-meter-fill');
  if (meter) meter.style.width = `${rows.length ? Math.round((readyCount / rows.length) * 100) : 0}%`;
  list.innerHTML = rows.length === 0 ? '<p class="c-vault__empty">No ready acts yet.</p>' : rows.map(r => {
    const seq = r.item.sequence_order != null ? String(r.item.sequence_order).padStart(2, '0') : '';
    const sub = `${escapeHtml(r.item.performer_name || '')} &middot; ${escapeHtml(r.e.entry_id)}${r.e.kind === 'video' ? ' &middot; video' : ''}`;
    const statusLabel = r.state === 'ready' ? 'Cached' : (r.state === 'failed' ? 'Not cached' : 'Needs cache');
    return `
    <div class="c-vrow c-vrow--${r.state}" data-vault-row="${escapeHtml(r.e.entry_id)}">
      <span class="c-vrow__num">${seq}</span>
      <div class="c-vrow__text">
        <p class="c-vrow__song" title="${escapeHtml(r.item.song_title || r.e.file || r.e.entry_id)}">${escapeHtml(r.item.song_title || r.e.file || r.e.entry_id)}</p>
        <p class="c-vrow__sub">${r.failed ? escapeHtml(r.failed) : sub}</p>
      </div>
      <span class="c-vrow__size">${r.rec ? (r.rec.size_bytes / (1024 * 1024)).toFixed(1) + ' MB' : ''}</span>
      ${r.state === 'ready' ? '' : `<button type="button" class="vault-retry-btn c-act" data-entry-id="${escapeHtml(r.e.entry_id)}">${r.state === 'failed' ? 'Retry' : 'Cache'}</button>`}
      <span class="c-vrow__state">${statusLabel}</span>
    </div>`;
  }).join('');
  list.querySelectorAll('.vault-retry-btn').forEach(btn => btn.addEventListener('click', () => autoVaultSync(btn.dataset.entryId)));
}

// Auto-cache from the manifest. onlyId limits the run to one act (retry). A missing
// manifest (404) leaves the manual "Cache all" flow in charge.
export async function autoVaultSync(onlyId = null) {
  if (vaultSyncRunning || !S.userAdminPin || !navigator.onLine) return;
  S.vaultManifest = await fetchManifest(fetch, getAuthHeaders) || S.vaultManifest;
  if (S.vaultManifest) trackGains.update(S.vaultManifest.tracks);
  if (!S.vaultManifest) { await updateVaultStatusDisplay(); return; }
  vaultSyncRunning = true;
  const pill = document.getElementById('vault-status-indicator');
  try {
    const tracks = onlyId ? S.vaultManifest.tracks.filter(t => t.entry_id === onlyId) : S.vaultManifest.tracks;
    if (onlyId) vaultFailures.delete(onlyId);
    const result = await runVaultSync({
      tracks,
      cachedMeta: await getAllCachedMeta(),
      downloadTrack: async entry => {
        const res = await fetch(`${entry.url || `/api/stream/${entry.entry_id}`}${(entry.url || '').includes('?') ? '&' : '?'}t=${Date.now()}`, { headers: getAuthHeaders() });
        if (!res.ok) throw new Error(`server answered ${res.status}`);
        return res.blob();
      },
      saveTrack: (entry, blob, sha256) => {
        const item = S.queue.find(q => q.entry_id === entry.entry_id) || {};
        return saveCachedTrack(entry.entry_id, blob, {
          song_title: item.song_title, performer_name: item.performer_name, sequence_order: item.sequence_order,
          track_version: item.track_version, last_updated: item.last_updated, kind: entry.kind, sha256,
        });
      },
      onProgress: p => { if (pill) pill.title = `Caching ${p.done}/${p.of}${p.failed ? `, ${p.failed} failed` : ''}`; },
    });
    result.failed.forEach(f => vaultFailures.set(f.entry_id, f.reason));
    if (result.failed.length) showToast(`${result.failed.length} act(s) could not be cached. Open the vault to retry.`, 'error');
  } catch (err) {
    console.warn('Vault sync failed:', err);
  } finally {
    vaultSyncRunning = false;
    if (pill) pill.title = 'Open the vault: audio and video stored in this browser for offline playback';
    await updateVaultStatusDisplay();
  }
}

export async function cacheAllTracksOffline() {
  if (S.userAdminPin && navigator.onLine) {
    const manifest = await fetchManifest(fetch, getAuthHeaders);
    if (manifest) {
      S.vaultManifest = manifest;
      vaultFailures.clear();
      const text = document.getElementById('cache-all-text');
      if (text) text.textContent = 'Caching...';
      await autoVaultSync();
      if (text) text.textContent = 'Cache all';
      showToast('Vault is up to date with the server.');
      return;
    }
  }
  const btn = document.getElementById('cache-all-btn');
  const icon = document.getElementById('cache-all-icon');
  const text = document.getElementById('cache-all-text');

  const readyTracks = S.queue.filter(it => (it.track_status || '').toLowerCase() === 'uploaded');
  if (readyTracks.length === 0) {
    showToast('No uploaded tracks to cache in stage queue.', 'info');
    return;
  }

  if (btn) btn.disabled = true;
  if (icon) icon.classList.add('c-spin');
  if (text) text.textContent = `Caching 0/${readyTracks.length}...`;
  showToast(`Starting offline caching for ${readyTracks.length} tracks...`);

  let cachedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < readyTracks.length; i++) {
    const item = readyTracks[i];
    if (text) text.textContent = `Caching ${i + 1}/${readyTracks.length}...`;

    try {
      const res = await fetch(`/api/stream/${item.entry_id}?t=${Date.now()}`);
      if (res.ok) {
        const blob = await res.blob();
        await saveCachedTrack(item.entry_id, blob, {
          song_title: item.song_title,
          performer_name: item.performer_name,
          sequence_order: item.sequence_order,
          track_version: item.track_version,
          last_updated: item.last_updated
        });
        cachedCount++;
      } else {
        failedCount++;
      }
    } catch (e) {
      failedCount++;
    }
  }

  await updateVaultStatusDisplay();
  if (btn) btn.disabled = false;
  if (icon) icon.classList.remove('c-spin');
  if (text) text.textContent = 'Cache all';

  if (failedCount === 0) {
    showToast(`✓ All ${cachedCount} tracks stored in Vault! Ready for 100% offline playback.`);
  } else {
    showToast(`Cached ${cachedCount} tracks (${failedCount} failed). Check network.`, 'warning');
  }

  if (S.currentCuedItem) {
    const cached = await getCachedTrack(S.currentCuedItem.entry_id);
    const cuedVaultStatus = document.getElementById('cued-vault-status');
    if (cached && cuedVaultStatus) {
      cuedVaultStatus.className = 'c-vstat c-vstat--ok';
      cuedVaultStatus.innerHTML = '<i data-lucide="shield-check"></i><span>⚡ Cached in Vault (Offline Safe)</span>';
      if (window.lucide) lucide.createIcons();
    }
  }
}

export async function clearVaultStorage() {
  const confirmed = window.confirm('Are you sure you want to clear all locally cached audio tracks from this browser?');
  if (!confirmed) return;

  const db = await getVaultDb();
  if (!db) {
    showToast('Vault database not available.', 'error');
    return;
  }

  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(VAULT_STORE_NAME, 'readwrite');
      const store = tx.objectStore(VAULT_STORE_NAME);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });

    S.cachedVaultEntryIds.clear();
    await updateVaultStatusDisplay();

    // Reset cued item vault badge if one is currently cued
    if (S.currentCuedItem) {
      const cuedVaultStatus = document.getElementById('cued-vault-status');
      if (cuedVaultStatus) {
        cuedVaultStatus.className = 'c-vstat';
        cuedVaultStatus.innerHTML = '<i data-lucide="info"></i><span>Streaming from Server (Not Cached)</span>';
        if (window.lucide) lucide.createIcons();
      }
    }

    showToast('✓ Local Vault cache cleared successfully!');
  } catch (err) {
    console.error('Failed to clear vault storage:', err);
    showToast(`Could not clear Vault cache: ${err.message}`, 'error');
  }
}

export function openSheet(id) {
  const sheet = document.getElementById(id);
  if (!sheet) return;
  sheet.classList.remove('hidden');
  const first = sheet.querySelector('button, input, textarea');
  if (first) first.focus();
  if (id === 'vault-sheet') renderVaultSheet();
  if (window.lucide) lucide.createIcons();
}
export function closeSheet(id) {
  const sheet = document.getElementById(id);
  if (sheet) sheet.classList.add('hidden');
}

