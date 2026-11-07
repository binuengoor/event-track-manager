import { createStageMonitorSync, openStageMonitor } from "./console/stage-monitor-sync.js";
import { getOfflineActions, saveOfflineActions, replayOfflineActions, drainOfflineActions, appendSynchronized, drainSynchronized, appendOfflineAction, drainOfflineQueue, coordinatedOfflineQueueAvailable } from "./console/offline-actions.js";
import { VAULT_STORE_NAME, getVaultDb, getCachedTrack, saveCachedTrack, getVaultTrackIds, getAllCachedMeta } from "./console/vault-store.js";
import { createTransport } from "./console/transport.js";
import { selectAct, resolveCueNext, findNextEligible, isDoneItem } from "./console/deck-policy.js";
import { createHoldConfirm, bindHoldButton } from "./console/hold-confirm.js";
import { createFader, createGainStage, FADE_MS } from "./console/fade.js";
import { createReorderLock, createIdlePusher, moveItem } from "./console/reorder.js";
import { describeLoginFailure } from "./console/login.js";
import { createScreens } from "./console/screens.js";
import { createWakeLock } from "./console/wake-lock.js";
import { sinkSupported, applySink, listOutputs, rememberedSink, rememberSink } from "./console/output-device.js";
import { pillText, fetchManifest, runVaultSync, planVaultSync } from "./console/vault-sync.js";

// EMA Paattukoottam Stage Playback Console
let queue = [];
let filteredQueue = [];
let currentCuedItem = null;
let currentCuedObjectUrl = null;
let wavesurfer = null;
let isPlaying = false;
let isMuted = false;
let userAdminPin = localStorage.getItem('paattukoottam_pin') || '';
let searchQuery = '';
let draggedItemIndex = null;
let autoSyncInterval = null;
let isSequenceDirty = false;
let lastSyncedAt = null;
const transport = createTransport();
let onDeckId = null;
let gainStage = null;
let vaultManifest = null;
let vaultSyncRunning = false;
let vaultSyncStarted = false;
let vaultFailures = new Map();
const reorderLock = createReorderLock();

// =============================================================================
// POP-OUT STAGE CONFIDENCE MONITOR (BroadcastChannel Sync)
// =============================================================================
const stageMonitor = createStageMonitorSync(() => ({
  item: currentCuedItem,
  wavesurfer,
  isPlaying: typeof isAudioPlaying === 'function' ? isAudioPlaying() : false
}));
const broadcastStageMonitor = stageMonitor.broadcast;

// Screens: announcement, fade to black and lyrics go to the stage monitor; LIVE_STATE and
// ANNOUNCEMENT go to /live over etm-live. Both channels are optional.
function openChannel(name) {
  try { return (typeof BroadcastChannel !== 'undefined') ? new BroadcastChannel(name) : null; } catch (e) { return null; }
}
const monitorChannel = openChannel('stage_monitor_channel');
const liveChannel = openChannel('etm-live');
const screensState = { announcement: '', fadeBlack: false, lyrics: '' };
const screens = createScreens({ monitorChannel, liveChannel, getHeaders: () => getAuthHeaders() });
let relayTimer = null;
function relayLiveSoon() {
  clearTimeout(relayTimer);
  relayTimer = setTimeout(() => { screens.relayLiveState(); }, 400);
}
if (monitorChannel) {
  // A monitor opened late asks for state; replay the screen settings it cannot get from the cue.
  monitorChannel.addEventListener('message', event => {
    if (!event.data || event.data.type !== 'REQUEST_STATE') return;
    monitorChannel.postMessage({ type: 'ANNOUNCEMENT', text: screensState.announcement });
    monitorChannel.postMessage({ type: 'FADE_BLACK', on: screensState.fadeBlack });
    if (screensState.lyrics) monitorChannel.postMessage({ type: 'LYRICS', text: screensState.lyrics });
  });
}

function syncConsolePreviewVideo(play) {
  const previewVid = document.getElementById('console-preview-video');
  if (!previewVid) return;
  previewVid.muted = true;
  if (play) {
    if (wavesurfer && typeof wavesurfer.getCurrentTime === 'function') {
      previewVid.currentTime = wavesurfer.getCurrentTime();
    }
    previewVid.play().catch(() => {});
  } else {
    previewVid.pause();
    if (wavesurfer && typeof wavesurfer.getCurrentTime === 'function') {
      previewVid.currentTime = wavesurfer.getCurrentTime();
    }
  }
}

// =============================================================================
// INDEXEDDB AUDIO VAULT FOR 100% OFFLINE STAGE PLAYBACK
// =============================================================================
let cachedVaultEntryIds = new Set();

function updateRowCachePills() {
  document.querySelectorAll('[id^="queue-row-"]').forEach(row => {
    const entryId = row.dataset.entryId;
    if (!entryId) return;
    const isCached = cachedVaultEntryIds.has(entryId);

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
        cacheBtn.className = 'btn-cache-single px-2.5 py-1.5 rounded-xl font-medium text-xs border transition flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-emerald-300 border-slate-800 hover:border-emerald-500/40';
        cacheBtn.title = 'Track stored in browser Vault (Offline Safe). Click to re-cache fresh copy.';
        cacheBtn.innerHTML = '<i data-lucide="refresh-cw" class="w-3.5 h-3.5 text-slate-400"></i><span>Re-cache</span>';
      } else {
        cacheBtn.className = 'btn-cache-single px-2.5 py-1.5 rounded-xl font-medium text-xs border transition flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-cyan-300 hover:text-cyan-200 border-slate-800 hover:border-cyan-500/40 shadow-sm';
        cacheBtn.title = 'Pre-cache this audio track into local browser Vault without cueing';
        cacheBtn.innerHTML = '<i data-lucide="hard-drive-download" class="w-3.5 h-3.5 text-cyan-400"></i><span>Cache</span>';
      }
    }
  });
  if (window.lucide) lucide.createIcons();
}

async function handleSingleTrackCache(entryId, btn) {
  const item = queue.find(q => q.entry_id === entryId);
  if (!item) return;

  btn.classList.add('opacity-60', 'pointer-events-none');
  btn.innerHTML = `<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i><span>Caching...</span>`;
  if (window.lucide) lucide.createIcons();

  try {
    const res = await fetch(`/api/stream/${entryId}?t=${Date.now()}`);
    if (!res.ok) throw new Error('Download failed from server');
    const blob = await res.blob();
    await saveCachedTrack(entryId, blob, {
      song_title: item.song_title,
      performer_name: item.performer_name,
      sequence_order: item.sequence_order,
      drive_file_id: item.drive_file_id,
      last_updated: item.last_updated
    });
    cachedVaultEntryIds.add(entryId);
    await updateVaultStatusDisplay();
    showToast(`✓ Cached "${item.song_title}" into local Vault!`);
  } catch (err) {
    showToast(`Could not cache track: ${err.message}`, 'error');
  } finally {
    btn.classList.remove('opacity-60', 'pointer-events-none');
    updateRowCachePills();
  }
}

async function getVaultStats() {
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

async function updateVaultStatusDisplay() {
  cachedVaultEntryIds = await getVaultTrackIds();
  const vaultText = document.getElementById('vault-status-text');
  if (vaultText) {
    const meta = await getAllCachedMeta();
    let ready;
    let total;
    let bytes;
    if (vaultManifest) {
      const plan = planVaultSync(vaultManifest.tracks, meta);
      ready = plan.ready.length;
      total = plan.total;
      bytes = meta.reduce((n, r) => n + (r.size_bytes || 0), 0);
    } else {
      const readyTracks = queue.filter(it => (it.track_status || '').toLowerCase() === 'uploaded');
      total = readyTracks.length;
      ready = readyTracks.filter(it => cachedVaultEntryIds.has(it.entry_id)).length;
      bytes = meta.reduce((n, r) => n + (r.size_bytes || 0), 0);
    }
    vaultText.textContent = pillText({ ready, total, bytes });
  }
  updateRowCachePills();
  renderVaultSheet();
}

// Vault sheet: per-act list, failures first so they can be retried.
async function renderVaultSheet() {
  const sheet = document.getElementById('vault-sheet');
  if (!sheet || sheet.classList.contains('hidden')) return;
  const list = document.getElementById('vault-sheet-list');
  const summary = document.getElementById('vault-sheet-summary');
  const meta = new Map((await getAllCachedMeta()).map(r => [r.entry_id, r]));
  const entries = vaultManifest ? vaultManifest.tracks
    : queue.filter(it => (it.track_status || '').toLowerCase() === 'uploaded').map(it => ({ entry_id: it.entry_id, size: 0 }));
  const rows = entries.map(e => {
    const item = queue.find(q => q.entry_id === e.entry_id) || {};
    const rec = meta.get(e.entry_id);
    const failed = vaultFailures.get(e.entry_id);
    const state = failed ? 'failed' : (rec ? 'ready' : 'missing');
    return { e, item, rec, state, failed };
  }).sort((a, b) => ({ failed: 0, missing: 1, ready: 2 })[a.state] - ({ failed: 0, missing: 1, ready: 2 })[b.state]);
  const readyCount = rows.filter(r => r.state === 'ready').length;
  const bytes = [...meta.values()].reduce((n, r) => n + (r.size_bytes || 0), 0);
  if (summary) summary.textContent = `${readyCount} of ${rows.length} acts ready, ${Math.round(bytes / (1024 * 1024))} MB`;
  list.innerHTML = rows.length === 0 ? '<p class="p-4 text-slate-500">No ready acts yet.</p>' : rows.map(r => `
    <div class="flex items-center justify-between gap-3 px-4 py-2.5" data-vault-row="${escapeHtml(r.e.entry_id)}">
      <div class="min-w-0">
        <p class="font-semibold text-white truncate">${escapeHtml(r.item.song_title || r.e.file || r.e.entry_id)}</p>
        <p class="text-slate-400 truncate">${escapeHtml(r.item.performer_name || '')} &middot; ${escapeHtml(r.e.entry_id)}${r.e.kind === 'video' ? ' &middot; video' : ''}</p>
        ${r.failed ? `<p class="text-rose-300">${escapeHtml(r.failed)}</p>` : ''}
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <span class="text-slate-400 font-mono">${r.rec ? (r.rec.size_bytes / (1024 * 1024)).toFixed(1) + ' MB' : ''}</span>
        ${r.state === 'ready'
          ? '<span class="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">Ready</span>'
          : `<button type="button" class="vault-retry-btn px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700" data-entry-id="${escapeHtml(r.e.entry_id)}">${r.state === 'failed' ? 'Retry' : 'Cache'}</button>`}
      </div>
    </div>`).join('');
  list.querySelectorAll('.vault-retry-btn').forEach(btn => btn.addEventListener('click', () => autoVaultSync(btn.dataset.entryId)));
}

// Auto-cache from the manifest. onlyId limits the run to one act (retry). A missing
// manifest (404) leaves the manual "Cache all" flow in charge.
async function autoVaultSync(onlyId = null) {
  if (vaultSyncRunning || !userAdminPin || !navigator.onLine) return;
  vaultManifest = await fetchManifest(fetch, getAuthHeaders) || vaultManifest;
  if (!vaultManifest) { await updateVaultStatusDisplay(); return; }
  vaultSyncRunning = true;
  const pill = document.getElementById('vault-status-indicator');
  try {
    const tracks = onlyId ? vaultManifest.tracks.filter(t => t.entry_id === onlyId) : vaultManifest.tracks;
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
        const item = queue.find(q => q.entry_id === entry.entry_id) || {};
        return saveCachedTrack(entry.entry_id, blob, {
          song_title: item.song_title, performer_name: item.performer_name, sequence_order: item.sequence_order,
          drive_file_id: item.drive_file_id, last_updated: item.last_updated, kind: entry.kind, sha256,
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

async function cacheAllTracksOffline() {
  if (userAdminPin && navigator.onLine) {
    const manifest = await fetchManifest(fetch, getAuthHeaders);
    if (manifest) {
      vaultManifest = manifest;
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

  const readyTracks = queue.filter(it => (it.track_status || '').toLowerCase() === 'uploaded');
  if (readyTracks.length === 0) {
    showToast('No uploaded tracks to cache in stage queue.', 'info');
    return;
  }

  if (btn) btn.disabled = true;
  if (icon) icon.classList.add('animate-spin');
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
          drive_file_id: item.drive_file_id,
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
  if (icon) icon.classList.remove('animate-spin');
  if (text) text.textContent = 'Cache all';

  if (failedCount === 0) {
    showToast(`✓ All ${cachedCount} tracks stored in Vault! Ready for 100% offline playback.`);
  } else {
    showToast(`Cached ${cachedCount} tracks (${failedCount} failed). Check network.`, 'warning');
  }

  if (currentCuedItem) {
    const cached = await getCachedTrack(currentCuedItem.entry_id);
    const cuedVaultStatus = document.getElementById('cued-vault-status');
    if (cached && cuedVaultStatus) {
      cuedVaultStatus.className = 'mt-0.5 inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400';
      cuedVaultStatus.innerHTML = '<i data-lucide="shield-check" class="w-3 h-3 text-emerald-400"></i><span>⚡ Cached in Vault (Offline Safe)</span>';
      if (window.lucide) lucide.createIcons();
    }
  }
}

async function clearVaultStorage() {
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

    cachedVaultEntryIds.clear();
    await updateVaultStatusDisplay();

    // Reset cued item vault badge if one is currently cued
    if (currentCuedItem) {
      const cuedVaultStatus = document.getElementById('cued-vault-status');
      if (cuedVaultStatus) {
        cuedVaultStatus.className = 'mt-0.5 inline-flex items-center gap-1 text-[10px] font-medium text-slate-400';
        cuedVaultStatus.innerHTML = '<i data-lucide="info" class="w-3 h-3 text-slate-400"></i><span>Streaming from Server (Not Cached)</span>';
        if (window.lucide) lucide.createIcons();
      }
    }

    showToast('✓ Local Vault cache cleared successfully!');
  } catch (err) {
    console.error('Failed to clear vault storage:', err);
    showToast(`Could not clear Vault cache: ${err.message}`, 'error');
  }
}

// =============================================================================
// OFFLINE ACTIONS & NETWORK RECOVERY SYNC
// =============================================================================
let offlineSaveFailure = false;
let snapshotUnavailable = false;
const unsavedOfflineActions = new Map();
let nextActionSequence = 0;
const consoleIntentSession = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let offlineAckChannel = null;
try {
  if (typeof BroadcastChannel !== 'undefined') {
    offlineAckChannel = new BroadcastChannel('event-track-manager-offline-ack');
    offlineAckChannel.onmessage = event => {
      const acknowledged = event.data;
      if (acknowledged?.intent?.session === consoleIntentSession) {
        actionReachedServer(acknowledged.type, acknowledged.entryId, acknowledged.intent);
      }
    };
  }
} catch (error) {
  console.warn('Offline acknowledgments across tabs are unavailable:', error);
}
function actionKey(type, entryId) {
  // Cue and uncue both update the one active act. Status and notes are per act.
  if (type === 'set_active' || type === 'uncue') return 'active-act';
  return `${type}:${entryId || ''}`;
}
function beginAction(payload = {}) {
  return { sequence: ++nextActionSequence, value: JSON.stringify(payload) };
}
function actionReachedServer(type, entryId, action) {
  const key = actionKey(type, entryId);
  const unsaved = unsavedOfflineActions.get(key);
  if (unsaved && action && action.sequence >= unsaved.sequence) {
    unsavedOfflineActions.delete(key);
  }
  offlineSaveFailure = unsavedOfflineActions.size > 0;
  updateNetworkStatusDisplay();
}
function persistQueueSnapshot() {
  try {
    localStorage.setItem('paattukoottam_cached_queue', JSON.stringify(queue));
    snapshotUnavailable = false;
    updateNetworkStatusDisplay();
    return true;
  } catch (error) {
    snapshotUnavailable = true;
    updateNetworkStatusDisplay();
    showToast(`Offline copy could not be saved: ${error.message}`, 'error');
    return false;
  }
}
async function enqueueOfflineAction(type, entryId, payload = {}, action = beginAction(payload)) {
  try {
    await appendOfflineAction({type, entryId, payload, timestamp: Date.now(),
      intent: {session: consoleIntentSession, sequence: action.sequence, value: action.value}});
    updateNetworkStatusDisplay();
    return true;
  } catch (error) {
    const key = actionKey(type, entryId);
    const previous = unsavedOfflineActions.get(key);
    if (!previous || action.sequence > previous.sequence) unsavedOfflineActions.set(key, action);
    offlineSaveFailure = true;
    updateNetworkStatusDisplay();
    showToast(`Change is local only and was not saved for sync: ${error.message}`, 'error');
    return false;
  }
}

async function syncOfflineActions() {
  if (!navigator.onLine) return;
  const actions = getOfflineActions();
  if (!actions || actions.length === 0) {
    updateNetworkStatusDisplay();
    return;
  }

  showToast(`⚡ Syncing ${actions.length} offline actions to server...`);
  let syncedCount;
  try {
    syncedCount = await drainOfflineQueue(getAuthHeaders, fetch, undefined, queued => {
      if (queued.intent?.session === consoleIntentSession) {
        actionReachedServer(queued.type, queued.entryId, queued.intent);
      } else if (queued.intent?.session && offlineAckChannel) {
        try {
          offlineAckChannel.postMessage({type: queued.type, entryId: queued.entryId, intent: queued.intent});
        } catch (error) {
          console.warn('Could not notify another console tab:', error);
        }
      }
    });
  } catch (error) {
    showToast(`Could not sync offline actions: ${error.message}`, 'error');
    return;
  }
  updateNetworkStatusDisplay();
  if (syncedCount > 0) {
    showToast(`✓ Successfully synced ${syncedCount} offline actions to server!`);
    await loadQueue();
  }
}

function updateNetworkStatusDisplay() {
  const dot = document.getElementById('network-dot');
  const text = document.getElementById('network-status-text');
  const indicator = document.getElementById('network-status-indicator');
  if (!text || !dot) return;

  const isOnline = navigator.onLine;
  const offlineCount = getOfflineActions().length;

  if (offlineSaveFailure) {
    dot.className = 'w-2 h-2 rounded-full bg-rose-500';
    text.textContent = 'Unsaved local change — not queued for sync';
    if (indicator) indicator.className = 'flex items-center gap-1.5 text-xs text-rose-400 font-medium px-2.5 py-1 rounded-full bg-rose-500/10 border border-rose-500/20';
    return;
  }
  if (snapshotUnavailable) {
    dot.className = 'w-2 h-2 rounded-full bg-amber-500';
    text.textContent = 'Offline copy unavailable';
    if (indicator) indicator.className = 'flex items-center gap-1.5 text-xs text-amber-400 font-medium px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20';
    return;
  }
  if (isOnline) {
    dot.className = 'w-2 h-2 rounded-full bg-emerald-500';
    if (indicator) indicator.className = 'flex items-center gap-1.5 text-xs text-emerald-400 font-medium px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20';
    if (offlineCount > 0) {
      text.textContent = `Online (${offlineCount} syncing...)${coordinatedOfflineQueueAvailable() ? '' : ' · use one console tab'}`;
    } else {
      text.textContent = 'Online';
    }
  } else {
    dot.className = 'w-2 h-2 rounded-full bg-amber-500 animate-pulse';
    if (indicator) indicator.className = 'flex items-center gap-1.5 text-xs text-amber-400 font-medium px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20';
    text.textContent = `Offline Mode${offlineCount > 0 ? ` (${offlineCount} pending)` : ''}${coordinatedOfflineQueueAvailable() ? '' : ' · use one console tab'}`;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  setupAuth();
  initWaveSurfer();
  setupKeyboardHotkeys();
  setupActionButtons();
  setupDisruptionModal();
  setupSearch();
  setupConsoleUpgrades();
  fetchEventInfo();

  // Register Service Worker for offline app loading
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('Service Worker registration skipped:', err);
    });
  }

  // Network online/offline event listeners
  window.addEventListener('online', () => {
    updateNetworkStatusDisplay();
    showToast('✓ Internet restored. Connected to server.', 'success');
    syncOfflineActions();
    autoVaultSync();
  });
  window.addEventListener('offline', () => {
    updateNetworkStatusDisplay();
    showToast('⚠️ Wi-Fi / Internet disconnected. Console running in offline mode.', 'warning');
  });

  updateNetworkStatusDisplay();
  updateVaultStatusDisplay();

  if (userAdminPin) {
    await testAuthAndLoad();
  } else {
    showAuthModal();
  }

  // Periodic background sync every 45s (only if online and sequence is not dirty)
  autoSyncInterval = setInterval(() => {
    if (navigator.onLine && userAdminPin && !isSequenceDirty && !document.getElementById('auth-modal').classList.contains('hidden') === false) {
      loadQueue(true); // silent background sync
      syncOfflineActions();
    }
  }, 45000);

  // Update time-ago badge every 10 seconds
  setInterval(updateSyncStatusBadge, 10000);
});

async function fetchEventInfo() {
  try {
    const res = await fetch('/api/event-info');
    if (res.ok) {
      const data = await res.json();
      window.eventInfo = data;
      if (data.header_brand_title) {
        const titleEl = document.getElementById('admin-event-title');
        if (titleEl) titleEl.textContent = data.header_brand_title;
        document.title = `Stage Playback Console - ${data.header_brand_title}`;
      }
      if (data.header_brand_subtitle) {
        const subEl = document.getElementById('admin-event-subtitle');
        if (subEl) subEl.textContent = data.header_brand_subtitle;
      }

      const isConsoleEnabled = Boolean(data.console_enabled !== false);
      const inactiveCard = document.getElementById('console-inactive-card');
      const activeContent = document.getElementById('console-active-content');
      const authModal = document.getElementById('auth-modal');

      if (window.adaptNavigationForEventConfig) {
        window.adaptNavigationForEventConfig(data);
      }

      if (!isConsoleEnabled) {
        if (inactiveCard) inactiveCard.classList.remove('hidden');
        if (activeContent) activeContent.classList.add('hidden');
        if (authModal) authModal.classList.add('hidden');
        if (autoSyncInterval) clearInterval(autoSyncInterval);
        if (window.lucide) lucide.createIcons();
        return;
      } else {
        if (inactiveCard) inactiveCard.classList.add('hidden');
        if (activeContent) activeContent.classList.remove('hidden');
      }
    }
  } catch (e) {
    console.warn('Could not fetch event info:', e);
  }
}

function getAuthHeaders() {
  const headers = {};
  if (userAdminPin) {
    headers['X-Admin-PIN'] = userAdminPin;
  }
  return headers;
}

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  const msgEl = document.getElementById('toast-message');
  const iconEl = document.getElementById('toast-icon');

  msgEl.textContent = message;
  if (type === 'error') {
    iconEl.innerHTML = '<i data-lucide="alert-triangle" class="w-4 h-4 text-rose-400"></i>';
    toast.className = 'fixed top-4 right-4 z-50 transform transition-all duration-300 translate-y-0 opacity-100 bg-rose-950/90 border border-rose-500/40 text-rose-200 px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-2.5 text-xs';
  } else {
    iconEl.innerHTML = '<i data-lucide="check-circle" class="w-4 h-4 text-emerald-400"></i>';
    toast.className = 'fixed top-4 right-4 z-50 transform transition-all duration-300 translate-y-0 opacity-100 bg-slate-900 border border-slate-700 text-slate-100 px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-2.5 text-xs';
  }

  if (window.lucide) lucide.createIcons();

  setTimeout(() => {
    toast.className = 'fixed top-4 right-4 z-50 transform transition-all duration-300 translate-y-[-150%] opacity-0 bg-slate-900 border border-slate-700 text-white px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-2.5 text-xs pointer-events-none';
  }, 3500);
}

function renderTypePill(perfType) {
  const raw = (perfType || 'Solo').trim();
  const lower = raw.toLowerCase();
  let colorClasses = 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30';
  if (lower.includes('duet')) {
    colorClasses = 'bg-purple-500/15 text-purple-300 border-purple-500/30';
  } else if (lower.includes('group')) {
    colorClasses = 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
  } else if (lower.includes('acoustic') || lower.includes('live')) {
    colorClasses = 'bg-amber-500/15 text-amber-300 border-amber-500/30';
  }
  return `<span class="inline-flex items-center text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${colorClasses} tracking-wide shrink-0">${escapeHtml(raw)}</span>`;
}

function setupAuth() {
  const form = document.getElementById('pin-form');
  const input = document.getElementById('pin-input');
  const errorMsg = document.getElementById('pin-error');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pin = input.value.trim();
    if (!pin) return;

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin })
      });

      if (!res.ok) {
        const failure = await describeLoginFailure(res);
        errorMsg.textContent = failure.message;
        errorMsg.classList.remove('hidden');
        input.value = '';
        input.focus();
        return;
      }

      userAdminPin = pin;
      localStorage.setItem('paattukoottam_pin', pin);
      hideAuthModal();
      await loadQueue();
    } catch (err) {
      errorMsg.textContent = 'Could not sign in. Check the connection and try again.';
      errorMsg.classList.remove('hidden');
      input.value = '';
      input.focus();
    }
  });
}

function showAuthModal() {
  document.getElementById('auth-modal').classList.remove('hidden');
  document.getElementById('pin-input').focus();
}

function hideAuthModal() {
  document.getElementById('auth-modal').classList.add('hidden');
  document.getElementById('pin-error').classList.add('hidden');
}

async function testAuthAndLoad() {
  try {
    const res = await fetch('/api/stage-queue', { headers: getAuthHeaders() });
    if (res.status === 401 || res.status === 429) {
      showAuthModal();
      if (res.status === 429) {
        const failure = await describeLoginFailure(res);
        const errorMsg = document.getElementById('pin-error');
        errorMsg.textContent = failure.message;
        errorMsg.classList.remove('hidden');
      }
    } else {
      hideAuthModal();
      await loadQueue();
    }
  } catch (e) {
    console.error('Initial load failed:', e);
    const savedQueue = localStorage.getItem('paattukoottam_cached_queue');
    if (savedQueue && userAdminPin) {
      hideAuthModal();
      try {
        queue = JSON.parse(savedQueue);
        filteredQueue = [...queue];
        renderQueueList();
        updateVaultStatusDisplay();
        updateNetworkStatusDisplay();
        showToast('⚠️ Running in Offline Mode with local cache', 'warning');
      } catch (err) {}
    } else {
      showAuthModal();
    }
  }
}

function updateQueueStatsSummary() {
  const statsSummary = document.getElementById('stats-summary');
  const countPill = document.getElementById('queue-count-pill');
  if (!statsSummary || !countPill || !queue) return;

  const total = queue.length;
  const performed = queue.filter(q => q.performance_status === 'Performed' || q.track_status === 'Performed').length;
  const skipped = queue.filter(q => (q.performance_status === 'On Hold' || q.track_status === 'Skipped') && q.performance_status !== 'Performed' && q.track_status !== 'Performed').length;
  const uploaded = queue.filter(q => (q.performance_status !== 'Performed' && q.track_status !== 'Performed') && (q.performance_status !== 'On Hold' && q.track_status !== 'Skipped') && (q.track_status === 'Uploaded' || Boolean(q.drive_file_id))).length;
  const pending = queue.filter(q => (q.performance_status !== 'Performed' && q.track_status !== 'Performed') && (q.performance_status !== 'On Hold' && q.track_status !== 'Skipped') && q.track_status !== 'Uploaded' && !q.drive_file_id && q.track_status !== 'Acoustic' && (q.performance_type || '').toLowerCase() !== 'acoustic').length;

  statsSummary.textContent = `${total} sequenced • ${uploaded} ready • ${skipped} on hold • ${pending} pending • ${performed} done`;
  countPill.textContent = `${performed}/${total} completed`;
}

async function loadQueue(silent = false) {
  const container = document.getElementById('queue-container');
  const statsSummary = document.getElementById('stats-summary');
  const countPill = document.getElementById('queue-count-pill');
  const syncText = document.getElementById('sync-status-text');
  const refreshIcon = document.getElementById('refresh-icon');

  if (!silent) {
    if (syncText) syncText.textContent = 'Syncing...';
    if (refreshIcon) refreshIcon.classList.add('animate-spin');
  }

  try {
    const res = await fetch('/api/stage-queue', { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to fetch stage queue');
    queue = await res.json();
    localStorage.setItem('paattukoottam_cached_queue', JSON.stringify(queue));

    updateQueueStatsSummary();

    // Fetch live status for dirty state, active performer, and sync timestamp
    let liveData = null;
    try {
      const liveRes = await fetch('/api/live-status');
      if (liveRes.ok) {
        liveData = await liveRes.json();
        lastSyncedAt = liveData.last_synced_at;
        setDirtyState(Boolean(liveData.is_dirty));
        screens.relayStatus(liveData);
        if (typeof liveData.announcement === 'string') adoptServerAnnouncement(liveData.announcement);
      }
    } catch (e) {
      console.warn("Could not check dirty status:", e);
    }

    updateSyncStatusBadge();
    applyFilter();
    updateVaultStatusDisplay();
    if (!vaultSyncStarted) { vaultSyncStarted = true; autoVaultSync(); }

    // Auto-restore active / cued track on load if not already cued, or refresh current cued item
    if (currentCuedItem) {
      const matchItem = queue.find(q => q.entry_id === currentCuedItem.entry_id);
      if (matchItem) {
        currentCuedItem = matchItem;
        updatePlayerBarState();
      }
    } else if (queue.length > 0) {
      const serverActiveId = liveData ? liveData.active_entry_id : null;
      const candidateId = serverActiveId || localStorage.getItem('paattukoottam_cued_entry_id');

      if (candidateId) {
        const matchItem = queue.find(q => q.entry_id === candidateId);
        if (matchItem) {
          cueTrack(matchItem, false, true);
        }
      }

      // If server has an active entry, ensure Uncue button is enabled so operator can uncue
      if (serverActiveId) {
        const uncueBtn = document.getElementById('btn-uncue');
        if (uncueBtn) uncueBtn.disabled = false;
      }
    }

    if (!silent) {
      showToast(`Loaded ${queue.length} performances from Event Database`);
    }
  } catch (err) {
    if (syncText) syncText.textContent = navigator.onLine ? 'Sync Error' : 'Offline';
    const savedQueue = localStorage.getItem('paattukoottam_cached_queue');
    if (savedQueue && (!queue || queue.length === 0)) {
      try {
        queue = JSON.parse(savedQueue);
        filteredQueue = [...queue];
        renderQueueList();
        updateVaultStatusDisplay();
      } catch (e) {}
    }
    if (!silent) {
      showToast(navigator.onLine ? `Sync failed: ${err.message}` : 'Running in Offline Mode using local cache', navigator.onLine ? 'error' : 'warning');
    }
  } finally {
    if (refreshIcon) refreshIcon.classList.remove('animate-spin');
  }
}

function setupSearch() {
  const searchInput = document.getElementById('queue-search-input');
  const clearBtn = document.getElementById('search-clear-btn');

  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value.trim().toLowerCase();
    if (searchQuery) {
      clearBtn.classList.remove('hidden');
    } else {
      clearBtn.classList.add('hidden');
    }
    applyFilter();
  });

  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    searchQuery = '';
    clearBtn.classList.add('hidden');
    applyFilter();
    searchInput.focus();
  });
}

function applyFilter() {
  const matchCount = document.getElementById('search-match-count');
  if (!searchQuery) {
    filteredQueue = [...queue];
    matchCount.classList.add('hidden');
  } else {
    filteredQueue = queue.filter(item => {
      const pName = (item.performer_name || '').toLowerCase();
      const partName = (item.partner_name || '').toLowerCase();
      const sTitle = (item.song_title || '').toLowerCase();
      const mName = (item.movie_name || '').toLowerCase();
      const pType = (item.performance_type || '').toLowerCase();
      const seq = String(item.sequence_order || '');
      const entryId = (item.entry_id || '').toLowerCase();

      return pName.includes(searchQuery) ||
             partName.includes(searchQuery) ||
             sTitle.includes(searchQuery) ||
             mName.includes(searchQuery) ||
             pType.includes(searchQuery) ||
             seq.includes(searchQuery) ||
             entryId.includes(searchQuery);
    });

    matchCount.textContent = `${filteredQueue.length} of ${queue.length} matches`;
    matchCount.classList.remove('hidden');
  }

  renderQueueList();
}

function renderQueueList() {
  const container = document.getElementById('queue-container');
  if (filteredQueue.length === 0) {
    container.innerHTML = `<div class="p-8 text-center text-slate-500 text-sm">No performances match "${escapeHtml(searchQuery)}"</div>`;
    renderOnDeck();
    return;
  }

  container.innerHTML = '';
  filteredQueue.forEach((item, index) => {
    const isCued = currentCuedItem && currentCuedItem.entry_id === item.entry_id;
    const isDone = item.performance_status === 'Performed' || item.track_status === 'Performed';
    const isSkipped = !isDone && (item.performance_status === 'On Hold' || item.track_status === 'Skipped');
    const isAcoustic = !isDone && !isSkipped && (item.track_status === 'Acoustic' || (item.performance_type || '').toLowerCase().includes('acoustic'));
    const isUploaded = !isDone && !isSkipped && (item.track_status === 'Uploaded' || Boolean(item.drive_file_id));

    const row = document.createElement('div');
    row.id = `queue-row-${item.entry_id}`;
    row.dataset.entryId = item.entry_id;
    row.dataset.index = index;
    row.draggable = reorderLock.canDrag(searchQuery); // drag only when unlocked and not searching
    row.className = `p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition border-l-4 ${
      isCued
        ? 'cued-active bg-orange-500/10 border-orange-500'
        : (onDeckTarget() && onDeckTarget().entry_id === item.entry_id)
        ? 'ondeck-row bg-amber-500/5 border-amber-400'
        : isDone
        ? 'opacity-60 bg-slate-950/40 border-slate-700'
        : isSkipped
        ? 'bg-amber-950/20 border-amber-500/60'
        : 'bg-slate-900/30 border-transparent hover:bg-slate-800/40'
    }`;

    const seqNum = item.sequence_order !== null ? String(item.sequence_order).padStart(2, '0') : '??';
    
    // Performer display & duet formatting
    let performerDisplay = escapeHtml(item.performer_name);
    if (item.partner_name) {
      performerDisplay = `Duet: <span class="text-white font-bold">${escapeHtml(item.performer_name)}</span> & <span class="text-orange-300 font-bold">${escapeHtml(item.partner_name)}</span>`;
    }

    let statusPill = '';
    if (isDone) {
      statusPill = `<span class="px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-800 text-slate-400 border border-slate-700 flex items-center gap-1"><i data-lucide="check" class="w-3 h-3"></i> Performed</span>`;
    } else if (isSkipped) {
      statusPill = `<span class="px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/20 text-amber-300 border border-amber-500/50 flex items-center gap-1"><i data-lucide="pause-circle" class="w-3 h-3"></i> On Hold</span>`;
    } else if (isUploaded) {
      statusPill = `<span class="px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1"><i data-lucide="music" class="w-3 h-3"></i> Ready</span>`;
    } else if (isAcoustic) {
      statusPill = `<span class="px-2 py-0.5 rounded-full text-[11px] font-medium bg-sky-500/20 text-sky-300 border border-sky-500/40 flex items-center gap-1"><i data-lucide="guitar" class="w-3 h-3"></i> Acoustic</span>`;
    } else {
      statusPill = `<span class="px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-800 text-amber-300 border border-amber-500/30 flex items-center gap-1"><i data-lucide="clock" class="w-3 h-3"></i> Pending</span>`;
    }

    const durationInfo = item.duration ? `<span class="text-[11px] font-mono text-slate-400 ml-1">(${item.duration})</span>` : '';

    const extraTagsPills = (item.extra_tags || []).map(tag => {
      return `<span class="inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-full border border-sky-500/30 bg-sky-500/10 text-sky-300 tracking-wide shrink-0">${escapeHtml(tag)}</span>`;
    }).join(' ');

    const isCached = cachedVaultEntryIds.has(item.entry_id);
    const cachedBadgeHtml = (isUploaded || item.drive_file_id)
      ? `<span class="vault-cached-tag ${isCached ? '' : 'hidden'} inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/15 text-emerald-300 tracking-wide shrink-0" title="Audio cached in local Vault for offline playback"><i data-lucide="shield-check" class="w-3 h-3 text-emerald-400"></i><span>Cached</span></span>`
      : '';

    let cacheBtnHtml = '';
    if (isUploaded || item.drive_file_id) {
      cacheBtnHtml = `
        <button class="btn-cache-single px-2.5 py-1.5 rounded-xl font-medium text-xs border transition flex items-center gap-1.5 ${
          isCached
            ? 'bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-emerald-300 border-slate-800 hover:border-emerald-500/40'
            : 'bg-slate-900 hover:bg-slate-800 text-cyan-300 hover:text-cyan-200 border-slate-800 hover:border-cyan-500/40 shadow-sm'
        }" data-entry-id="${item.entry_id}" title="${isCached ? 'Track already in browser Vault. Click to re-download fresh copy.' : 'Pre-cache this audio track into local browser Vault without cueing'}">
          <i data-lucide="${isCached ? 'refresh-cw' : 'hard-drive-download'}" class="w-3.5 h-3.5 ${isCached ? 'text-slate-400' : 'text-cyan-400'}"></i>
          <span>${isCached ? 'Re-cache' : 'Cache'}</span>
        </button>
      `;
    }

    row.innerHTML = `
      <div class="flex items-center gap-3">
        <!-- Drag Handle (hidden during search) -->
        ${reorderLock.canDrag(searchQuery) ? `
        <div class="drag-handle cursor-grab active:cursor-grabbing p-1 text-slate-600 hover:text-slate-300 transition shrink-0" title="Drag to re-order sequence">
          <i data-lucide="grip-vertical" class="w-4 h-4"></i>
        </div>
        ` : ''}

        <!-- Sequence Badge -->
        <div class="w-9 h-9 rounded-xl ${isCued ? 'bg-orange-500 text-white' : 'bg-slate-800 text-slate-300'} flex items-center justify-center font-mono font-bold text-xs shrink-0 border border-slate-700 shadow">
          #${seqNum}
        </div>

        <!-- Performer & Song Info -->
        <div class="overflow-hidden">
          <div class="flex items-center gap-2 flex-wrap">
            <h3 class="font-bold text-sm text-white ${isDone ? 'line-through text-slate-400' : ''}">
              ${performerDisplay}
            </h3>
            ${renderTypePill(item.performance_type)}
            ${extraTagsPills}
            ${cachedBadgeHtml}
          </div>
          <p class="text-xs text-orange-400 font-medium mt-0.5 ${isDone ? 'line-through text-slate-500' : ''}">
            "${escapeHtml(item.song_title)}" ${durationInfo}
          </p>
          <div class="row-notes-container mt-1.5 flex items-center gap-1.5 flex-wrap">
            ${item.stage_notes && item.stage_notes.trim() ? `
              <span class="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-300 font-medium cursor-pointer hover:bg-amber-500/25 transition btn-edit-note" title="Click to edit stage note">
                <i data-lucide="file-text" class="w-3 h-3 text-amber-400"></i>
                <span class="note-val">${escapeHtml(item.stage_notes.trim())}</span>
              </span>
            ` : `
              <button class="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md text-slate-400 hover:text-amber-300 hover:bg-slate-800/60 transition border border-dashed border-slate-700 hover:border-amber-500/40 btn-edit-note" title="Add stage note for live program view">
                <i data-lucide="plus" class="w-2.5 h-2.5"></i>
                <span>Note</span>
              </button>
            `}
          </div>
        </div>
      </div>


      <!-- Action Buttons -->
      <div class="flex items-center gap-2 self-end sm:self-center shrink-0 flex-wrap justify-end">
        ${statusPill}
        ${cacheBtnHtml}

        <!-- Cue Track -->
        <button class="btn-cue-row px-2.5 py-1.5 rounded-xl font-semibold text-xs transition flex items-center gap-1 ${
          isUploaded || item.drive_file_id || isAcoustic
            ? (isCued ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/30' : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700')
            : 'bg-slate-800/50 text-slate-600 cursor-not-allowed border border-slate-800'
        }" ${isUploaded || item.drive_file_id || isAcoustic ? '' : 'disabled'} title="Load act into player view & stage display">
          <i data-lucide="${isCued ? (isAcoustic ? 'guitar' : 'disc') : (isAcoustic ? 'guitar' : 'disc-3')}" class="w-3.5 h-3.5 ${isCued && isPlaying ? 'animate-spin' : ''}"></i>
          <span>${isCued ? 'Cued' : 'Cue'}</span>
        </button>

        <!-- Skip / Hold -->
        ${!isDone ? `
        <button class="btn-hold-row px-2.5 py-1.5 rounded-xl font-medium text-xs border transition flex items-center gap-1 ${
          isSkipped
            ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border-amber-500/40'
            : 'bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-amber-300 border-slate-800'
        }" title="${isSkipped ? 'Return performer to queue' : 'Put performer on hold / skip'}">
          <i data-lucide="${isSkipped ? 'play' : 'pause-circle'}" class="w-3.5 h-3.5"></i>
          <span>${isSkipped ? 'Re-Queue' : 'Hold'}</span>
        </button>
        ` : ''}

        <!-- Done / Undo Toggle -->
        <button class="btn-done-row px-2.5 py-1.5 rounded-xl font-medium text-xs border transition flex items-center gap-1 ${
          isDone
            ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
            : 'bg-slate-900 hover:bg-emerald-950/60 text-emerald-400 hover:text-emerald-300 border-slate-800 hover:border-emerald-500/40'
        }" title="${isDone ? 'Undo completed status' : 'Mark as completed'}">
          <i data-lucide="${isDone ? 'rotate-ccw' : 'check'}" class="w-3.5 h-3.5"></i>
          <span>${isDone ? 'Undo' : 'Done'}</span>
        </button>
      </div>
    `;

    // Row event listeners
    const singleCacheBtn = row.querySelector('.btn-cache-single');
    if (singleCacheBtn) {
      singleCacheBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await handleSingleTrackCache(item.entry_id, singleCacheBtn);
      });
    }

    const noteEditBtn = row.querySelector('.btn-edit-note');
    if (noteEditBtn) {
      noteEditBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const currentNote = (item.stage_notes || '').trim();
        const newNote = prompt(`Additional info / stage note for "${item.performer_name} - ${item.song_title}":\n(Will be shown live on stage screen. Leave blank to clear.)`, currentNote);
        if (newNote !== null) {
          updateStageNotes(item.entry_id, newNote);
        }
      });
    }

    const cueBtn = row.querySelector('.btn-cue-row');
    if (cueBtn) {
      cueBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        selectRow(item);
      });
    }

    row.addEventListener('click', (e) => {
      if (e.target.closest('button') || e.target.closest('a') || e.target.closest('input') || e.target.closest('.btn-edit-note')) return;
      if (isUploaded || item.drive_file_id || isAcoustic) {
        selectRow(item);
      }
    });


    const holdBtn = row.querySelector('.btn-hold-row');
    if (holdBtn) {
      holdBtn.addEventListener('click', () => {
        const action = () => {
          const nextStatus = isSkipped ? 'Upcoming' : 'On Hold';
          updateStatus(item.entry_id, nextStatus).then(() => {
            if (nextStatus === 'Upcoming') {
              cueTrack(item, false);
            } else if (isCued) {
              cueNextTrack(false);
            }
          });
        };
        if (isCued) {
          confirmIfPlaying('Putting current playing track on hold', action);
        } else {
          action();
        }
      });
    }

    const doneBtn = row.querySelector('.btn-done-row');
    const runRowDone = () => {
      const action = () => {
        const nextStatus = isDone ? 'Upcoming' : 'Performed';
        updateStatus(item.entry_id, nextStatus).then(() => {
          if (nextStatus === 'Performed' && isCued) {
            cueNextTrack(false);
          }
        });
      };
      if (isCued) {
        confirmIfPlaying('Marking current playing track as completed', action);
      } else {
        action();
      }
    };
    if (isDone) {
      doneBtn.addEventListener('click', runRowDone); // Undo stays a click
    } else {
      doneBtn.classList.add('hold-fill');
      doneBtn.title = 'Hold for 1 second to mark as completed';
      bindHoldButton(doneBtn, createHoldConfirm({
        onProgress: p => doneBtn.style.setProperty('--hold', p),
        onConfirm: runRowDone,
      }));
    }

    // Drag-and-drop sequencing listeners
    if (reorderLock.canDrag(searchQuery)) {
      row.addEventListener('dragstart', (e) => {
        draggedItemIndex = index;
        row.classList.add('drag-ghost');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', index);
      });

      row.addEventListener('dragend', () => {
        row.classList.remove('drag-ghost');
        document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
      });

      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        row.classList.add('drag-over');
      });

      row.addEventListener('dragleave', () => {
        row.classList.remove('drag-over');
      });

      row.addEventListener('drop', async (e) => {
        e.preventDefault();
        row.classList.remove('drag-over');
        if (draggedItemIndex === null || draggedItemIndex === index) return;

        // Move item in queue array
        queue = moveItem(queue, draggedItemIndex, index);
        draggedItemIndex = null;

        filteredQueue = [...queue];
        renderQueueList();

        // Save reordered sequence
        await saveReorderedSequence();
      });
    }

    container.appendChild(row);
  });

  renderOnDeck();
  if (window.lucide) lucide.createIcons();
}

async function saveReorderedSequence() {
  const payload = queue.map(it => ({
    entry_id: it.entry_id,
    sequence_order: it.sequence_order
  }));

  try {
    const res = await fetch('/api/reorder-queue', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders()
      },
      body: JSON.stringify({ items: payload, push_to_sheet: false })
    });

    if (!res.ok) throw new Error('Failed to update stage queue');
    const data = await res.json();
    setDirtyState(true);
    idlePusher.touch();
    persistQueueSnapshot();
    relayLiveSoon();
    showToast('Order saved. Track files are renamed in a few seconds, or press Save Order to do it now.', 'info');
  } catch (err) {
    showToast(`Sequence staging failed: ${err.message}`, 'error');
  }
}

function initWaveSurfer() {
  const container = document.getElementById('player-waveform');
  if (!container || typeof WaveSurfer === 'undefined') return;

  try {
    wavesurfer = WaveSurfer.create({
      container: container,
      waveColor: '#475569',
      progressColor: '#f97316',
      cursorColor: '#fb923c',
      cursorWidth: 2,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      height: 44,
      normalize: true
    });

    let lastBroadcastSyncTime = 0;

    ensureGainStage();

    wavesurfer.on('play', () => {
      if (gainStage) gainStage.resume();
      transport.send('PLAY');
      isPlaying = true;
      updatePlayPauseButton();
      broadcastStageMonitor('PLAY');
      syncConsolePreviewVideo(true);
    });

    wavesurfer.on('pause', () => {
      if (fader.active) { fader.cancel(); setOutputLevel(1); } // pausing mid-fade keeps the act audible next time
      transport.send('PAUSE');
      isPlaying = false;
      updatePlayPauseButton();
      broadcastStageMonitor('PAUSE');
      syncConsolePreviewVideo(false);
    });

    wavesurfer.on('seeking', () => {
      broadcastStageMonitor('SEEK');
      const cur = wavesurfer.getCurrentTime();
      const previewVid = document.getElementById('console-preview-video');
      if (previewVid) previewVid.currentTime = cur;
    });

    wavesurfer.on('timeupdate', (currentTime) => {
      document.getElementById('player-current-time').textContent = formatTime(currentTime);
      const previewVid = document.getElementById('console-preview-video');
      if (previewVid && !previewVid.paused && Math.abs(previewVid.currentTime - currentTime) > 0.3) {
        previewVid.currentTime = currentTime;
      }
      const now = Date.now();
      if (now - lastBroadcastSyncTime > 2000) {
        lastBroadcastSyncTime = now;
        broadcastStageMonitor('SYNC');
      }
    });

    wavesurfer.on('ready', (duration) => {
      document.getElementById('player-duration').textContent = formatTime(duration);
      document.getElementById('waveform-placeholder').classList.add('hidden');
      updateTransportUi();
      broadcastStageMonitor('CUE');
    });

    wavesurfer.on('finish', () => {
      transport.send('FINISH');
      isPlaying = false;
      updatePlayPauseButton();
      broadcastStageMonitor('PAUSE');
      syncConsolePreviewVideo(false);
    });

  } catch (e) {
    console.warn('WaveSurfer initialization error:', e);
  }
}

function isAudioPlaying() {
  if (wavesurfer) {
    try {
      if (typeof wavesurfer.isPlaying === 'function' && wavesurfer.isPlaying()) return true;
    } catch (e) {}
  }
  return Boolean(isPlaying) || transport.isLive();
}

function toggleMute() {
  if (!wavesurfer) return;
  try {
    const nextMute = !isMuted;
    wavesurfer.setMuted(nextMute);
    isMuted = nextMute;
    updateMuteButton();
    showToast(isMuted ? 'Audio muted' : 'Audio unmuted', isMuted ? 'info' : 'success');
  } catch (e) {
    console.warn('Mute error:', e);
  }
}

function handleMuteClick() {
  if (isMuted) {
    toggleMute();
  } else {
    confirmIfPlaying('Muting live stage audio', () => {
      toggleMute();
    });
  }
}

function updateMuteButton() {
  const icon = document.getElementById('mute-icon');
  const btn = document.getElementById('btn-mute');
  if (!icon || !btn) return;
  if (isMuted) {
    icon.setAttribute('data-lucide', 'volume-x');
    btn.className = 'p-2 text-rose-400 bg-rose-500/20 rounded-lg transition border border-rose-500/40';
    btn.title = 'Unmute Audio [M]';
  } else {
    icon.setAttribute('data-lucide', 'volume-2');
    btn.className = 'p-2 text-slate-400 hover:text-amber-400 rounded-lg hover:bg-slate-800 transition';
    btn.title = 'Mute Audio [M]';
  }
  if (window.lucide) lucide.createIcons();
}

let disruptionPendingCallback = null;

function confirmIfPlaying(actionDescription, onProceed) {
  if (!isAudioPlaying()) {
    onProceed();
    return;
  }

  const modal = document.getElementById('disruption-modal');
  const msgEl = document.getElementById('disruption-modal-msg');
  if (msgEl) {
    msgEl.innerHTML = `A track is currently playing live on stage.<br><span class="text-amber-300 font-semibold">${escapeHtml(actionDescription)}</span> will stop or silence the music.`;
  }

  disruptionPendingCallback = onProceed;
  if (modal) modal.classList.remove('hidden');
}

function setupDisruptionModal() {
  const modal = document.getElementById('disruption-modal');
  const cancelBtn = document.getElementById('disruption-cancel-btn');
  const confirmBtn = document.getElementById('disruption-confirm-btn');

  const fadeBtn = document.getElementById('disruption-fade-btn');
  if (fadeBtn) {
    fadeBtn.addEventListener('click', () => {
      if (modal) modal.classList.add('hidden');
      const cb = disruptionPendingCallback;
      disruptionPendingCallback = null;
      if (transport.state === 'PLAYING' || transport.state === 'FADING') {
        fadeOut(() => { if (typeof cb === 'function') cb(); });
      } else if (typeof cb === 'function') {
        cb();
      }
    });
  }

  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      if (modal) modal.classList.add('hidden');
      disruptionPendingCallback = null;
    });
  }

  if (confirmBtn) {
    confirmBtn.addEventListener('click', () => {
      if (modal) modal.classList.add('hidden');
      if (wavesurfer && isAudioPlaying()) {
        fader.cancel();
        setOutputLevel(1);
        try { wavesurfer.stop(); } catch (e) {}
        transport.send('STOP');
        isPlaying = false;
        updatePlayPauseButton();
      }
      if (typeof disruptionPendingCallback === 'function') {
        const cb = disruptionPendingCallback;
        disruptionPendingCallback = null;
        cb();
      }
    });
  }

  // Intercept navigation links
  document.querySelectorAll('header a[href]').forEach(link => {
    link.addEventListener('click', (e) => {
      if (isAudioPlaying()) {
        e.preventDefault();
        const targetHref = link.getAttribute('href');
        confirmIfPlaying('Leaving this console page', () => {
          window.location.href = targetHref;
        });
      }
    });
  });

  // Browser reload / tab close guard
  window.addEventListener('beforeunload', (e) => {
    if (isAudioPlaying()) {
      e.preventDefault();
      e.returnValue = 'Audio is currently playing live on stage. Are you sure you want to leave?';
      return e.returnValue;
    }
  });
}

function updatePlayerBarState() {
  if (!currentCuedItem) return;
  const markDoneBtn = document.getElementById('btn-mark-done');
  const holdBtn = document.getElementById('btn-hold-skip');
  const isCuedDone = currentCuedItem.performance_status === 'Performed' || currentCuedItem.track_status === 'Performed';
  const isCuedSkipped = currentCuedItem.performance_status === 'On Hold' || currentCuedItem.track_status === 'Skipped';

  if (markDoneBtn) {
    markDoneBtn.disabled = false;
    if (isCuedDone) {
      markDoneBtn.className = 'hold-fill px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs border border-slate-700 flex items-center gap-1.5 transition disabled:opacity-40 disabled:pointer-events-none';
      markDoneBtn.title = 'Undo completed status';
      markDoneBtn.innerHTML = '<i data-lucide="rotate-ccw" class="w-4 h-4"></i><span>Undo</span>';
    } else {
      markDoneBtn.className = 'hold-fill px-3.5 py-2 rounded-xl bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-400 font-semibold text-xs border border-emerald-500/40 flex items-center gap-1.5 transition disabled:opacity-40 disabled:pointer-events-none';
      markDoneBtn.title = 'Hold to mark as performed (hold Enter)';
      markDoneBtn.innerHTML = '<i data-lucide="check-check" class="w-4 h-4"></i><span>Done</span>';
    }
    markDoneBtn.style.setProperty('--hold', 0);
  }

  if (holdBtn) {
    holdBtn.disabled = false;
    if (isCuedSkipped) {
      holdBtn.className = 'px-3 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-semibold text-xs border border-amber-500/50 flex items-center gap-1.5 transition disabled:opacity-40 disabled:pointer-events-none';
      holdBtn.title = 'Return performer to queue';
      holdBtn.innerHTML = '<i data-lucide="play" class="w-4 h-4"></i><span>Re-Queue</span>';
    } else {
      holdBtn.className = 'px-3 py-2 rounded-xl bg-amber-950/60 hover:bg-amber-900/80 text-amber-400 font-semibold text-xs border border-amber-500/40 flex items-center gap-1.5 transition disabled:opacity-40 disabled:pointer-events-none';
      holdBtn.title = 'No-Show / Put On Hold';
      holdBtn.innerHTML = '<i data-lucide="pause-circle" class="w-4 h-4"></i><span>Hold</span>';
    }
  }

  if (window.lucide) lucide.createIcons();
}

function resetPlayerBar() {
  currentCuedItem = null;
  fader.cancel();
  setOutputLevel(1);
  transport.send('UNCUE');
  localStorage.removeItem('paattukoottam_cued_entry_id');

  if (currentCuedObjectUrl) {
    URL.revokeObjectURL(currentCuedObjectUrl);
    currentCuedObjectUrl = null;
  }

  const cuedVaultStatus = document.getElementById('cued-vault-status');
  if (cuedVaultStatus) cuedVaultStatus.classList.add('hidden');

  const playerTitle = document.getElementById('player-title');
  const playerPerformer = document.getElementById('player-performer');
  const playBtn = document.getElementById('btn-play-pause');
  const markDoneBtn = document.getElementById('btn-mark-done');
  const holdBtn = document.getElementById('btn-hold-skip');
  const uncueBtn = document.getElementById('btn-uncue');
  const downloadBtn = document.getElementById('btn-download-cued');
  const playerBadge = document.getElementById('player-badge');
  const placeholder = document.getElementById('waveform-placeholder');

  if (playerTitle) playerTitle.textContent = 'No Track Cued';
  if (playerPerformer) playerPerformer.textContent = 'Tap "Cue Track" on any song to inspect & play';
  if (playerBadge) playerBadge.className = 'w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-slate-400 shrink-0 border border-slate-700';

  const notesBar = document.getElementById('player-notes-bar');
  if (notesBar) notesBar.classList.add('hidden');

  if (playBtn) playBtn.disabled = true;
  if (markDoneBtn) {
    markDoneBtn.disabled = true;
    markDoneBtn.className = 'hold-fill px-3.5 py-2 rounded-xl bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-400 font-semibold text-xs border border-emerald-500/40 flex items-center gap-1.5 transition disabled:opacity-40 disabled:pointer-events-none';
    markDoneBtn.title = 'Hold to mark as performed (hold Enter)';
    markDoneBtn.innerHTML = '<i data-lucide="check-check" class="w-4 h-4"></i><span>Done</span>';
  }
  if (holdBtn) {
    holdBtn.disabled = true;
    holdBtn.className = 'px-3 py-2 rounded-xl bg-amber-950/60 hover:bg-amber-900/80 text-amber-400 font-semibold text-xs border border-amber-500/40 flex items-center gap-1.5 transition disabled:opacity-40 disabled:pointer-events-none';
    holdBtn.title = 'No-Show / Put On Hold';
    holdBtn.innerHTML = '<i data-lucide="pause-circle" class="w-4 h-4"></i><span>Hold</span>';
  }
  if (uncueBtn) uncueBtn.disabled = true;
  if (window.lucide) lucide.createIcons();
  if (downloadBtn) {
    downloadBtn.classList.add('opacity-40', 'pointer-events-none');
    downloadBtn.onclick = null;
  }

  if (wavesurfer) {
    try {
      wavesurfer.stop();
      wavesurfer.empty();
    } catch (e) {}
  }
  isPlaying = false;
  updatePlayPauseButton();

  document.getElementById('player-current-time').textContent = '0:00';
  document.getElementById('player-duration').textContent = '0:00';
  if (placeholder) {
    placeholder.textContent = 'Waveform visualizer ready';
    placeholder.classList.remove('hidden');
  }

  const previewContainer = document.getElementById('player-video-preview');
  if (previewContainer) previewContainer.classList.add('hidden');
  const previewVid = document.getElementById('console-preview-video');
  if (previewVid) {
    previewVid.pause();
    previewVid.src = '';
  }
  if (playerBadge) playerBadge.classList.remove('hidden');

  broadcastStageMonitor('UNCUE');
  updateTransportUi();
  relayLiveSoon();

  renderQueueList();
}

async function uncueTrack() {
  const itemToUncue = currentCuedItem;
  const songName = itemToUncue ? itemToUncue.song_title : 'Active Track';

  confirmIfPlaying(`Uncueing "${songName}"`, async () => {
    const action = beginAction();
    if (itemToUncue) {
      const target = queue.find(q => q.entry_id === itemToUncue.entry_id);
      if (target && target.performance_status === 'On Stage') {
        target.performance_status = 'Upcoming';
      }
    } else {
      queue.forEach(q => {
        if (q.performance_status === 'On Stage') q.performance_status = 'Upcoming';
      });
    }

    localStorage.removeItem('paattukoottam_cued_entry_id');
    resetPlayerBar();

    if (!navigator.onLine) {
      if (!await enqueueOfflineAction('uncue', null, {}, action)) return;
      showToast(`✓ Uncued "${songName}" locally. Live Program restored.`);
      return;
    }

    try {
      const res = await fetch('/api/clear-active', {
        method: 'POST',
        headers: getAuthHeaders()
      });
      if (!res.ok) throw new Error('Failed to uncue track on server');
      actionReachedServer('uncue', null, action);
      relayLiveSoon();
      showToast(`✓ Uncued "${songName}". Live Program restored to countdown.`);
    } catch (err) {
      if (!await enqueueOfflineAction('uncue', null, {}, action)) return;
      showToast(`Uncued locally (network error, will sync when online)`, 'warning');
    }
  });
}

function cueTrack(item, autoPlay = false, isRestoration = false) {
  if (currentCuedItem && currentCuedItem.entry_id === item.entry_id) {
    if (autoPlay && wavesurfer) wavesurfer.play();
    return;
  }

  const applyCue = async () => {
    if (onDeckId === item.entry_id) onDeckId = null;
    transport.send('CUE');
    currentCuedItem = item;
    localStorage.setItem('paattukoottam_cued_entry_id', item.entry_id);

    const playerTitle = document.getElementById('player-title');
    const playerPerformer = document.getElementById('player-performer');
    const playBtn = document.getElementById('btn-play-pause');
    const markDoneBtn = document.getElementById('btn-mark-done');
    const holdBtn = document.getElementById('btn-hold-skip');
    const uncueBtn = document.getElementById('btn-uncue');
    const downloadBtn = document.getElementById('btn-download-cued');
    const playerBadge = document.getElementById('player-badge');
    const cuedVaultStatus = document.getElementById('cued-vault-status');

    if (playerTitle) playerTitle.textContent = item.song_title;
    let singerText = item.performer_name;
    if (item.partner_name) singerText = `Duet: ${item.performer_name} & ${item.partner_name}`;
    if (playerPerformer) playerPerformer.textContent = `#${String(item.sequence_order || 0).padStart(2, '0')} • ${singerText}`;

    updatePlayerBarNotes(item.stage_notes || '');

    const isAcoustic = item.track_status === 'Acoustic';
    const isVideo = (item.media_type === 'video') || (item.drive_file_name && item.drive_file_name.endsWith('.mp4'));

    const previewContainer = document.getElementById('player-video-preview');
    const previewVid = document.getElementById('console-preview-video');

    if (isVideo) {
      if (playerBadge) playerBadge.classList.add('hidden');
      if (previewContainer) previewContainer.classList.remove('hidden');
      if (previewVid) {
        previewVid.muted = true;
        previewVid.src = `/api/stream/${item.entry_id}`;
        previewVid.load();
      }
    } else {
      if (previewContainer) previewContainer.classList.add('hidden');
      if (previewVid) {
        previewVid.pause();
        previewVid.src = '';
      }
      if (playerBadge) {
        playerBadge.classList.remove('hidden');
        if (isAcoustic) {
          playerBadge.className = 'w-10 h-10 rounded-xl bg-sky-500/20 text-sky-400 flex items-center justify-center shrink-0 border border-sky-500/40';
          playerBadge.innerHTML = '<i data-lucide="guitar" class="w-5 h-5"></i>';
        } else {
          playerBadge.className = 'w-10 h-10 rounded-xl bg-orange-500/20 text-orange-400 flex items-center justify-center shrink-0 border border-orange-500/40';
          playerBadge.innerHTML = '<i data-lucide="music-2" class="w-5 h-5"></i>';
        }
      }
    }

    if (playBtn) playBtn.disabled = isAcoustic;
    updatePlayerBarState();
    if (uncueBtn) uncueBtn.disabled = false;

    // Configure 1-Click Track Download for Local Playback
    if (downloadBtn) {
      if (isAcoustic) {
        downloadBtn.classList.add('opacity-40', 'pointer-events-none');
        downloadBtn.onclick = null;
      } else {
        downloadBtn.onclick = async (e) => {
          e.preventDefault();
          if (!currentCuedItem) return;

          // Check if already in local Vault
          const cached = await getCachedTrack(currentCuedItem.entry_id);
          if (cached && cached.blob) {
            const url = window.URL.createObjectURL(cached.blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${currentCuedItem.entry_id}_${currentCuedItem.performer_name}_${currentCuedItem.song_title}.mp3`.replace(/\s+/g, '_');
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
            showToast('✓ Track exported from local Vault!');
            return;
          }

          downloadBtn.classList.add('opacity-50', 'pointer-events-none');
          showToast('Downloading track...');
          try {
            const res = await fetch(`/api/download-track/${currentCuedItem.entry_id}`, {
              headers: getAuthHeaders()
            });
            if (!res.ok) throw new Error('Download failed from server');
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const disp = res.headers.get('Content-Disposition');
            let filename = `${currentCuedItem.entry_id}_track.mp3`;
            if (disp && disp.includes('filename=')) {
              filename = disp.split('filename=')[1].replace(/["']/g, '').trim();
            }
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
            showToast('✓ Track downloaded for local playback!');
          } catch (err) {
            showToast(`Download error: ${err.message}`, 'error');
          } finally {
            downloadBtn.classList.remove('opacity-50', 'pointer-events-none');
          }
        };
        downloadBtn.classList.remove('opacity-40', 'pointer-events-none');
      }
    }

    const placeholder = document.getElementById('waveform-placeholder');
    if (isAcoustic) {
      if (cuedVaultStatus) cuedVaultStatus.classList.add('hidden');
      if (placeholder) {
        placeholder.textContent = '🎸 Acoustic Act — Live Instruments / No Backing Track File Needed';
        placeholder.classList.remove('hidden');
      }
      if (wavesurfer) {
        try {
          wavesurfer.stop();
          wavesurfer.empty();
        } catch (e) {}
      }
      document.getElementById('player-current-time').textContent = 'Live';
      document.getElementById('player-duration').textContent = 'Stage';
    } else {
      if (placeholder) {
        placeholder.textContent = 'Loading audio waveform...';
        placeholder.classList.remove('hidden');
      }

      if (cuedVaultStatus) {
        cuedVaultStatus.className = 'mt-0.5 inline-flex items-center gap-1 text-[10px] font-semibold text-amber-400';
        cuedVaultStatus.innerHTML = '<span class="animate-spin text-xs">⚡</span><span>Checking Vault...</span>';
        cuedVaultStatus.classList.remove('hidden');
      }

      let audioSourceUrl = `/api/stream/${item.entry_id}`;
      let isVaultCached = false;

      // 1. Check IndexedDB Audio Vault
      const cached = await getCachedTrack(item.entry_id);
      const isStale = cached && (
        (item.drive_file_id && cached.drive_file_id && cached.drive_file_id !== item.drive_file_id) ||
        (item.last_updated && cached.last_updated && cached.last_updated !== item.last_updated) ||
        (item.song_title && cached.song_title && cached.song_title !== item.song_title)
      );

      if (cached && cached.blob && !isStale) {
        isVaultCached = true;
        if (currentCuedObjectUrl) {
          URL.revokeObjectURL(currentCuedObjectUrl);
        }
        currentCuedObjectUrl = URL.createObjectURL(cached.blob);
        audioSourceUrl = currentCuedObjectUrl;

        if (cuedVaultStatus) {
          cuedVaultStatus.className = 'mt-0.5 inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400';
          cuedVaultStatus.innerHTML = '<i data-lucide="shield-check" class="w-3 h-3 text-emerald-400"></i><span>⚡ Cached in Vault (Offline Safe)</span>';
          if (window.lucide) lucide.createIcons();
        }
      } else if (navigator.onLine) {
        // 2. Online & not yet cached or stale: Fetch fresh and store in Vault!
        if (cuedVaultStatus) {
          cuedVaultStatus.className = 'mt-0.5 inline-flex items-center gap-1 text-[10px] font-semibold text-cyan-400 animate-pulse';
          cuedVaultStatus.innerHTML = isStale
            ? '<i data-lucide="refresh-cw" class="w-3 h-3 text-cyan-400 animate-spin"></i><span>Updating stale Vault cache...</span>'
            : '<i data-lucide="hard-drive-download" class="w-3 h-3 text-cyan-400"></i><span>Caching track to Vault...</span>';
          if (window.lucide) lucide.createIcons();
        }

        try {
          const res = await fetch(`/api/stream/${item.entry_id}?t=${Date.now()}`);
          if (res.ok) {
            const blob = await res.blob();
            await saveCachedTrack(item.entry_id, blob, {
              song_title: item.song_title,
              performer_name: item.performer_name,
              drive_file_id: item.drive_file_id,
              last_updated: item.last_updated
            });
            isVaultCached = true;
            if (currentCuedObjectUrl) {
              URL.revokeObjectURL(currentCuedObjectUrl);
            }
            currentCuedObjectUrl = URL.createObjectURL(blob);
            audioSourceUrl = currentCuedObjectUrl;
            updateVaultStatusDisplay();

            if (cuedVaultStatus) {
              cuedVaultStatus.className = 'mt-0.5 inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400';
              cuedVaultStatus.innerHTML = '<i data-lucide="shield-check" class="w-3 h-3 text-emerald-400"></i><span>⚡ Cached in Vault (Offline Safe)</span>';
              if (window.lucide) lucide.createIcons();
            }
          }
        } catch (fetchErr) {
          console.warn('Could not cache to Vault on cue:', fetchErr);
        }
      } else {
        // 3. Offline and not cached
        if (cuedVaultStatus) {
          cuedVaultStatus.className = 'mt-0.5 inline-flex items-center gap-1 text-[10px] font-semibold text-rose-400';
          cuedVaultStatus.innerHTML = '<i data-lucide="alert-triangle" class="w-3 h-3 text-rose-400"></i><span>⚠️ Not cached in Vault. Connect to Wi-Fi.</span>';
          if (window.lucide) lucide.createIcons();
        }
        showToast('⚠️ Track was not cached locally and console is offline. Connect to Wi-Fi to load.', 'error');
      }

      if (wavesurfer && (isVaultCached || navigator.onLine)) {
        try {
          wavesurfer.load(audioSourceUrl);
          if (autoPlay) {
            wavesurfer.once('ready', () => {
              wavesurfer.play();
            });
          }
        } catch (err) {
          console.warn('WaveSurfer load error:', err);
        }
      }
    }

    isPlaying = false;
    updatePlayPauseButton();
    updateTransportUi();
    renderQueueList();
    broadcastStageMonitor('CUE');

    // Notify Live View of currently cued / active performer (skip during page reload restoration)
    if (!isRestoration) {
      const action = beginAction();
      if (navigator.onLine) {
        try {
          const response = await fetch(`/api/set-active/${item.entry_id}`, {
            method: 'POST', headers: getAuthHeaders()
          });
          if (!response.ok) throw new Error('Failed to set active act');
          actionReachedServer('set_active', item.entry_id, action);
          relayLiveSoon();
        } catch (error) {
          await enqueueOfflineAction('set_active', item.entry_id, {}, action);
        }
      } else {
        await enqueueOfflineAction('set_active', item.entry_id, {}, action);
      }
    }
  };

  if (isRestoration) {
    applyCue();
  } else {
    confirmIfPlaying(`Cueing new track "${item.song_title}"`, applyCue);
  }
}

function updatePlayPauseButton() {
  const playIcon = document.getElementById('play-icon');
  if (!playIcon) return;
  if (isPlaying) {
    playIcon.setAttribute('data-lucide', 'pause');
  } else {
    playIcon.setAttribute('data-lucide', 'play');
  }
  if (window.lucide) lucide.createIcons();
}

function togglePlayPause() {
  if (!currentCuedItem || !wavesurfer) return;
  if (gainStage) gainStage.resume();
  wavesurfer.playPause();
}

function cueNextTrack(autoPlay = false) {
  const next = resolveCueNext({ queue, currentId: currentCuedItem ? currentCuedItem.entry_id : null, onDeckId });
  if (next) cueTrack(next, autoPlay);
}

// Row click or row Cue: never touches the deck or audio while sound is live.
function selectRow(item) {
  const result = selectAct({
    transport, item, currentId: currentCuedItem ? currentCuedItem.entry_id : null,
    loadAct: it => cueTrack(it, false),
    setOnDeck: it => { onDeckId = it.entry_id; renderQueueList(); showToast(`On deck: ${it.song_title}`, 'info'); },
  });
  return result;
}

function onDeckTarget() {
  if (!currentCuedItem && !onDeckId) return null;
  return resolveCueNext({ queue, currentId: currentCuedItem ? currentCuedItem.entry_id : null, onDeckId });
}

function renderOnDeck() {
  const strip = document.getElementById('on-deck-strip');
  if (!strip) return;
  const target = onDeckTarget();
  if (!target) { strip.classList.add('hidden'); return; }
  strip.classList.remove('hidden');
  const who = target.partner_name ? `${target.performer_name} & ${target.partner_name}` : target.performer_name;
  document.getElementById('on-deck-text').textContent = ` ${String(target.sequence_order || 0).padStart(2, '0')} \u00b7 ${target.song_title} \u00b7 ${who}`;
  const note = (target.stage_notes || '').trim();
  document.getElementById('on-deck-note').textContent = note ? ` \u00b7 Note: ${note}` : '';
}

function handleCueNext() {
  confirmIfPlaying('Cueing the on-deck act', () => cueNextTrack(false));
}

// Fade through the gain stage, then stop. afterDone runs once the fade has finished.
let fadeAfterDone = null;
function setOutputLevel(v) {
  if (gainStage) gainStage.setGain(v);
  else if (wavesurfer && typeof wavesurfer.setVolume === 'function') { try { wavesurfer.setVolume(v); } catch (e) {} }
}
const fader = createFader({
  duration: FADE_MS,
  setLevel: v => setOutputLevel(v),
  onDone: () => {
    transport.send('FADE_DONE');
    try { wavesurfer.stop(); } catch (e) {}
    setOutputLevel(1);
    isPlaying = false;
    updatePlayPauseButton();
    updateTransportUi();
    const cb = fadeAfterDone;
    fadeAfterDone = null;
    if (typeof cb === 'function') cb();
  },
});
function fadeOut(afterDone = null) {
  if (transport.state !== 'PLAYING' || !wavesurfer) return false;
  fadeAfterDone = afterDone;
  transport.send('FADE_START');
  fader.start(1);
  updateTransportUi();
  return true;
}

function ensureGainStage() {
  if (gainStage || !wavesurfer || typeof wavesurfer.getMediaElement !== 'function') return;
  gainStage = createGainStage(wavesurfer.getMediaElement());
  setupOutputDevice();
}

async function setupOutputDevice() {
  const wrap = document.getElementById('output-device-wrap');
  const select = document.getElementById('output-device-select');
  const element = wavesurfer && wavesurfer.getMediaElement ? wavesurfer.getMediaElement() : null;
  if (!wrap || !select || !sinkSupported(element, gainStage)) return;
  const outputs = await listOutputs();
  if (outputs.length === 0) return;
  select.innerHTML = '<option value="">System default</option>' + outputs.map(o => `<option value="${escapeHtml(o.id)}">${escapeHtml(o.label)}</option>`).join('');
  const saved = rememberedSink();
  if (saved && outputs.some(o => o.id === saved)) {
    select.value = saved;
    applySink(saved, element, gainStage).catch(() => {});
  }
  wrap.classList.remove('hidden');
  wrap.classList.add('flex');
  select.addEventListener('change', async () => {
    try {
      await applySink(select.value, element, gainStage);
      rememberSink(select.value);
      showToast('Output device changed');
    } catch (err) {
      showToast(`Could not use that output: ${err.message}`, 'error');
    }
  });
}

function updateTransportUi() {
  const fadeBtn = document.getElementById('btn-fade');
  if (fadeBtn) {
    fadeBtn.disabled = transport.state !== 'PLAYING';
    const label = fadeBtn.querySelector('span');
    if (label) label.firstChild.textContent = transport.state === 'FADING' ? 'Fading... ' : 'Fade out ';
  }
  const playBtn = document.getElementById('btn-play-pause');
  if (playBtn && currentCuedItem && currentCuedItem.track_status !== 'Acoustic') playBtn.disabled = transport.state === 'FADING';
}

async function updateStatus(entryId, newStatus) {
  let normalizedPerfStatus = 'Upcoming';
  if (newStatus === 'Performed' || newStatus === 'Done') {
    normalizedPerfStatus = 'Performed';
  } else if (newStatus === 'Skipped' || newStatus === 'On Hold') {
    normalizedPerfStatus = 'On Hold';
  } else if (newStatus === 'On Stage' || newStatus === 'Live') {
    normalizedPerfStatus = 'On Stage';
  } else {
    normalizedPerfStatus = 'Upcoming';
  }

  const action = beginAction({ status: normalizedPerfStatus });
  const target = queue.find(q => q.entry_id === entryId);
  if (target) {
    target.performance_status = normalizedPerfStatus;
  }
  if (currentCuedItem && currentCuedItem.entry_id === entryId) {
    currentCuedItem.performance_status = normalizedPerfStatus;
    updatePlayerBarState();
  }
  updateQueueStatsSummary();
  applyFilter();
  persistQueueSnapshot();

  if (!navigator.onLine) {
    if (!await enqueueOfflineAction('update_status', entryId, { status: normalizedPerfStatus }, action)) return;
    showToast(`✓ Marked ${normalizedPerfStatus} locally (will sync when online)`, 'info');
    return;
  }

  try {
    const res = await fetch(`/api/status/${entryId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders()
      },
      body: JSON.stringify({ status: normalizedPerfStatus })
    });

    if (!res.ok) throw new Error('Status update failed');
    actionReachedServer('update_status', entryId, action);
    try { relayLiveSoon(); } catch (relayError) { /* relay is best effort and must never turn a saved change into an offline one */ }
    showToast(`✓ Updated ${target ? target.performer_name : entryId} status to ${normalizedPerfStatus}`);
  } catch (err) {
    if (!await enqueueOfflineAction('update_status', entryId, { status: normalizedPerfStatus }, action)) return;
    showToast(`Saved locally (network error, will sync when online)`, 'warning');
  }
}

async function updateStageNotes(entryId, notes) {
  const action = beginAction({ notes: notes });
  const target = queue.find(q => q.entry_id === entryId);
  if (target) target.stage_notes = notes || '';

  if (currentCuedItem && currentCuedItem.entry_id === entryId) {
    currentCuedItem.stage_notes = notes || '';
    updatePlayerBarNotes(notes || '');
  }

  renderQueueList();
  persistQueueSnapshot();

  if (!navigator.onLine) {
    if (!await enqueueOfflineAction('stage_notes', entryId, { notes: notes }, action)) return;
    showToast('✓ Stage note updated locally (will sync when online)', 'info');
    return;
  }

  try {
    const res = await fetch(`/api/performance-notes/${entryId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders()
      },
      body: JSON.stringify({ notes: notes })
    });

    if (!res.ok) throw new Error('Failed to update stage note');
    const data = await res.json();
    actionReachedServer('stage_notes', entryId, action);
    showToast(data.stage_notes ? '✓ Stage note updated' : '✓ Stage note cleared');
  } catch (err) {
    if (!await enqueueOfflineAction('stage_notes', entryId, { notes: notes }, action)) return;
    showToast('Saved locally (network error, will sync when online)', 'warning');
  }
}

function updatePlayerBarNotes(notes) {
  const bar = document.getElementById('player-notes-bar');
  const text = document.getElementById('player-notes-text');
  if (!bar || !text) return;
  if (!currentCuedItem) {
    bar.classList.add('hidden');
    return;
  }
  bar.classList.remove('hidden');
  if (notes && notes.trim()) {
    text.textContent = `Note: ${notes.trim()}`;
    text.className = 'truncate font-medium text-amber-300 cursor-pointer hover:underline';
  } else {
    text.textContent = '+ Add stage note...';
    text.className = 'truncate italic text-slate-400 cursor-pointer hover:text-amber-300 hover:underline';
  }
}


function setupKeyboardHotkeys() {
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!document.getElementById('auth-modal').classList.contains('hidden')) return;

    if (e.code === 'Space') {
      e.preventDefault();
      togglePlayPause();
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault();
      if (wavesurfer) wavesurfer.seekTo(Math.max(0, (wavesurfer.getCurrentTime() - 5) / wavesurfer.getDuration()));
    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      if (wavesurfer) wavesurfer.seekTo(Math.min(1, (wavesurfer.getCurrentTime() + 5) / wavesurfer.getDuration()));
    } else if (e.code === 'KeyM') {
      e.preventDefault();
      handleMuteClick();
    } else if (e.code === 'ArrowDown') {
      e.preventDefault();
      handleCueNext();
    } else if (e.code === 'KeyF') {
      e.preventDefault();
      fadeOut();
    }
    // No bare Enter hotkey: Done is hold-to-confirm on its own button.
  });
}

function setupActionButtons() {
  document.getElementById('btn-play-pause').addEventListener('click', togglePlayPause);

  document.getElementById('btn-seek-back').addEventListener('click', () => {
    if (wavesurfer) wavesurfer.seekTo(Math.max(0, (wavesurfer.getCurrentTime() - 5) / wavesurfer.getDuration()));
  });

  document.getElementById('btn-seek-fwd').addEventListener('click', () => {
    if (wavesurfer) wavesurfer.seekTo(Math.min(1, (wavesurfer.getCurrentTime() + 5) / wavesurfer.getDuration()));
  });

  const muteBtn = document.getElementById('btn-mute');
  if (muteBtn) {
    muteBtn.addEventListener('click', handleMuteClick);
  }

  document.getElementById('btn-cue-next').addEventListener('click', handleCueNext);
  document.getElementById('btn-ondeck-cue').addEventListener('click', handleCueNext);
  document.getElementById('btn-fade').addEventListener('click', () => fadeOut());

  // Done is press-and-hold (about 1 s). Undo, shown once the act is done, stays a click.
  const markDoneBtn = document.getElementById('btn-mark-done');
  const cuedIsDone = () => isDoneItem(currentCuedItem);
  const runMarkDone = () => {
    if (!currentCuedItem) return;
    const isCuedDone = cuedIsDone();
    const promptMsg = isCuedDone ? 'Restoring track as upcoming' : 'Marking track as completed';
    confirmIfPlaying(promptMsg, async () => {
      const nextStatus = isCuedDone ? 'Upcoming' : 'Performed';
      await updateStatus(currentCuedItem.entry_id, nextStatus);
      if (nextStatus === 'Performed') {
        cueNextTrack(false);
      } else {
        updatePlayerBarState();
      }
    });
  };
  bindHoldButton(markDoneBtn, createHoldConfirm({
    onProgress: p => markDoneBtn.style.setProperty('--hold', p),
    onConfirm: () => { if (currentCuedItem && !cuedIsDone()) runMarkDone(); },
  }), { enabled: () => Boolean(currentCuedItem) && !cuedIsDone() });
  markDoneBtn.addEventListener('click', () => { if (currentCuedItem && cuedIsDone()) runMarkDone(); });

  document.getElementById('btn-hold-skip').addEventListener('click', async () => {
    if (currentCuedItem) {
      const isCuedSkipped = currentCuedItem.performance_status === 'On Hold' || currentCuedItem.track_status === 'Skipped';
      const promptMsg = isCuedSkipped ? 'Returning track to upcoming queue' : 'Putting current track on hold';
      confirmIfPlaying(promptMsg, async () => {
        const nextStatus = isCuedSkipped ? 'Upcoming' : 'On Hold';
        await updateStatus(currentCuedItem.entry_id, nextStatus);
        if (nextStatus === 'On Hold') {
          cueNextTrack(false);
        } else {
          updatePlayerBarState();
        }
      });
    }
  });

  const uncueBtn = document.getElementById('btn-uncue');
  if (uncueBtn) {
    uncueBtn.addEventListener('click', () => {
      uncueTrack();
    });
  }

  const promptPlayerBarNoteEdit = () => {
    if (!currentCuedItem) return;
    const currentNote = (currentCuedItem.stage_notes || '').trim();
    let singerText = currentCuedItem.performer_name;
    if (currentCuedItem.partner_name) singerText = `${currentCuedItem.performer_name} & ${currentCuedItem.partner_name}`;
    const newNote = prompt(`Stage note / additional info for "${singerText} - ${currentCuedItem.song_title}":\n(Will be shown live on stage screen. Leave blank to clear.)`, currentNote);
    if (newNote !== null) {
      updateStageNotes(currentCuedItem.entry_id, newNote);
    }
  };

  const notesText = document.getElementById('player-notes-text');
  if (notesText) notesText.addEventListener('click', promptPlayerBarNoteEdit);

  const notesEditBtn = document.getElementById('player-notes-edit-btn');
  if (notesEditBtn) notesEditBtn.addEventListener('click', promptPlayerBarNoteEdit);


  // Sync / Refresh button
  const refreshBtn = document.getElementById('refresh-queue-btn');
  refreshBtn.addEventListener('click', async () => {
    await handleSyncButtonClick();
  });

  // Banner sync button
  const bannerSyncBtn = document.getElementById('banner-sync-btn');
  if (bannerSyncBtn) {
    bannerSyncBtn.addEventListener('click', async () => {
      await handleSyncButtonClick();
    });
  }

  // Cache All Offline button
  const cacheAllBtn = document.getElementById('cache-all-btn');
  if (cacheAllBtn) {
    cacheAllBtn.addEventListener('click', async () => {
      await cacheAllTracksOffline();
    });
  }

  // Clear Local Vault Cache button
  const clearVaultBtn = document.getElementById('clear-vault-btn');
  if (clearVaultBtn) {
    clearVaultBtn.addEventListener('click', async () => {
      await clearVaultStorage();
    });
  }

  // Offline ZIP Download button
  const zipBtn = document.getElementById('download-zip-btn');
  if (zipBtn) {
    zipBtn.addEventListener('click', async () => {
      zipBtn.classList.add('opacity-50', 'pointer-events-none');
      const originalText = zipBtn.innerHTML;
      zipBtn.innerHTML = `<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i><span>Bundling...</span>`;
      if (window.lucide) lucide.createIcons();

      try {
        const res = await fetch(`/api/admin/export-tracks-zip`, {
          headers: getAuthHeaders()
        });
        if (!res.ok) throw new Error('ZIP bundling failed');

        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;

        const disp = res.headers.get('Content-Disposition');
        let filename = `Paattukoottam_Stage_Tracks_${Date.now()}.zip`;
        if (disp && disp.includes('filename=')) {
          filename = disp.split('filename=')[1].replace(/["']/g, '').trim();
        }

        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        showToast('✓ Offline ZIP downloaded successfully!');
      } catch (err) {
        showToast(`Could not export offline tracks: ${err.message}`, 'error');
      } finally {
        zipBtn.innerHTML = originalText;
        zipBtn.classList.remove('opacity-50', 'pointer-events-none');
        if (window.lucide) lucide.createIcons();
      }
    });
  }

  // Pop-out Stage Confidence Monitor buttons
  const openStageMonitorBtn = document.getElementById('open-stage-monitor-btn');
  if (openStageMonitorBtn) {
    openStageMonitorBtn.addEventListener('click', openStageMonitor);
  }
}

// =============================================================================
// REORDER LOCK, SCREENS, VAULT SHEET, WAKE LOCK
// =============================================================================
async function pushSequenceQuiet() {
  if (!isSequenceDirty || !navigator.onLine) return;
  try {
    const res = await fetch('/api/push-sequence', { method: 'POST', headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to save the order');
    const data = await res.json();
    lastSyncedAt = data.last_synced_at;
    setDirtyState(false);
    relayLiveSoon();
    showToast(`✓ Order saved for ${data.synced_count} acts. Track files renamed and export updated.`);
  } catch (err) {
    showToast(`Order is saved, but file renames did not run: ${err.message}. Press Save Order to retry.`, 'error');
  }
}
const idlePusher = createIdlePusher({ push: pushSequenceQuiet });

function updateReorderLockUi() {
  const btn = document.getElementById('reorder-lock-btn');
  if (!btn) return;
  const locked = reorderLock.locked;
  btn.setAttribute('aria-pressed', String(!locked));
  document.getElementById('reorder-lock-text').textContent = locked ? 'Order locked · Unlock' : 'Order unlocked · Lock';
  document.getElementById('reorder-lock-icon').setAttribute('data-lucide', locked ? 'lock' : 'lock-open');
  btn.title = locked ? 'Unlock to drag rows into a new running order' : 'Lock the running order (saves pending changes)';
  btn.className = `px-3 py-1.5 rounded-xl border flex items-center gap-1.5 transition ${locked
    ? 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
    : 'bg-amber-500/15 border-amber-500/50 text-amber-200 hover:bg-amber-500/25'}`;
  if (window.lucide) lucide.createIcons();
}

function adoptServerAnnouncement(text) {
  const input = document.getElementById('announcement-input');
  screensState.announcement = text;
  if (input && document.activeElement !== input && !input.dataset.dirty) input.value = text;
  const state = document.getElementById('announcement-state');
  if (state) state.textContent = text ? 'Currently showing.' : '';
}

function openSheet(id) {
  const sheet = document.getElementById(id);
  if (!sheet) return;
  sheet.classList.remove('hidden');
  const first = sheet.querySelector('button, input, textarea');
  if (first) first.focus();
  if (id === 'vault-sheet') renderVaultSheet();
  if (window.lucide) lucide.createIcons();
}
function closeSheet(id) {
  const sheet = document.getElementById(id);
  if (sheet) sheet.classList.add('hidden');
}

function setupConsoleUpgrades() {
  // Reorder lock
  const lockBtn = document.getElementById('reorder-lock-btn');
  if (lockBtn) {
    lockBtn.addEventListener('click', () => {
      reorderLock.toggle();
      if (reorderLock.locked) idlePusher.flush();
      updateReorderLockUi();
      renderQueueList();
    });
    updateReorderLockUi();
  }

  // Announcement (inline)
  const annInput = document.getElementById('announcement-input');
  const sendAnnouncement = async (text) => {
    const out = await screens.sendAnnouncement(text);
    screensState.announcement = out.text;
    if (annInput) { annInput.value = out.text; delete annInput.dataset.dirty; }
    const state = document.getElementById('announcement-state');
    if (state) state.textContent = out.text ? (out.persisted ? 'Sent to all screens.' : 'Sent to screens in this browser only (could not reach the server).') : 'Cleared.';
    if (!out.persisted) showToast('Announcement was not saved on the server.', 'warning');
  };
  if (annInput) annInput.addEventListener('input', () => { annInput.dataset.dirty = '1'; });
  const annSend = document.getElementById('announcement-send-btn');
  if (annSend) annSend.addEventListener('click', () => sendAnnouncement(annInput ? annInput.value : ''));
  const annClear = document.getElementById('announcement-clear-btn');
  if (annClear) annClear.addEventListener('click', () => sendAnnouncement(''));
  if (annInput) annInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); sendAnnouncement(annInput.value); } });

  // Screens sheet
  const screensBtn = document.getElementById('open-screens-btn');
  if (screensBtn) screensBtn.addEventListener('click', () => openSheet('screens-sheet'));
  const screensClose = document.getElementById('screens-sheet-close');
  if (screensClose) screensClose.addEventListener('click', () => closeSheet('screens-sheet'));
  const fadeBlack = document.getElementById('fade-black-toggle');
  if (fadeBlack) {
    fadeBlack.addEventListener('click', () => {
      screensState.fadeBlack = !screensState.fadeBlack;
      screens.setFadeBlack(screensState.fadeBlack);
      fadeBlack.textContent = screensState.fadeBlack ? 'On' : 'Off';
      fadeBlack.setAttribute('aria-checked', String(screensState.fadeBlack));
    });
  }
  const lyricsInput = document.getElementById('lyrics-input');
  const lyricsSend = document.getElementById('lyrics-send-btn');
  if (lyricsSend && lyricsInput) lyricsSend.addEventListener('click', () => { screensState.lyrics = lyricsInput.value; screens.sendLyrics(lyricsInput.value); });
  const lyricsClear = document.getElementById('lyrics-clear-btn');
  if (lyricsClear && lyricsInput) lyricsClear.addEventListener('click', () => { lyricsInput.value = ''; screensState.lyrics = ''; screens.sendLyrics(''); });

  // Vault sheet
  const vaultChip = document.getElementById('vault-status-indicator');
  if (vaultChip) vaultChip.addEventListener('click', () => openSheet('vault-sheet'));
  const vaultClose = document.getElementById('vault-sheet-close');
  if (vaultClose) vaultClose.addEventListener('click', () => closeSheet('vault-sheet'));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeSheet('vault-sheet'); closeSheet('screens-sheet'); }
  });

  // Screen wake lock; the first tap also unlocks audio output in browsers that start suspended.
  const wake = createWakeLock();
  wake.enable();
  document.addEventListener('pointerdown', () => { wake.enable(); if (gainStage) gainStage.resume(); }, { once: false });
}

async function handleSyncButtonClick() {
  idlePusher.cancel();
  const refreshBtn = document.getElementById('refresh-queue-btn');
  const icon = document.getElementById('refresh-icon');
  refreshBtn.classList.add('opacity-50', 'pointer-events-none');
  if (icon) icon.classList.add('animate-spin');

  try {
    if (isSequenceDirty) {
      // Operator has uncommitted sequence order changes: push them now!
      const pushRes = await fetch('/api/push-sequence', {
        method: 'POST',
        headers: getAuthHeaders()
      });
      if (!pushRes.ok) throw new Error('Failed to save the order');
      const pushData = await pushRes.json();
      lastSyncedAt = pushData.last_synced_at;
      setDirtyState(false);
      showToast(`✓ Order saved for ${pushData.synced_count} acts. Track files renamed and export updated.`);
    } else {
      // Normal refresh
      const syncRes = await fetch('/api/sync', { method: 'POST', headers: getAuthHeaders() });
      if (syncRes.ok) {
        const syncData = await syncRes.json();
        lastSyncedAt = syncData.last_synced_at;
      }
    }
  } catch (e) {
    console.warn("Sync error:", e);
    showToast(`Sync failed: ${e.message}`, 'error');
  }

  await loadQueue(false);
  autoVaultSync();
  refreshBtn.classList.remove('opacity-50', 'pointer-events-none');
  if (icon) icon.classList.remove('animate-spin');
}

function setDirtyState(dirty) {
  isSequenceDirty = dirty;
  const banner = document.getElementById('unsynced-sequence-banner');
  const refreshBtn = document.getElementById('refresh-queue-btn');
  const syncBadge = document.getElementById('sync-status-indicator');
  const syncText = document.getElementById('sync-status-text');

  if (banner) {
    if (dirty) {
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
  }

  if (refreshBtn) {
    if (dirty) {
      // Glowing Amber state to indicate pending push
      refreshBtn.className = "px-3 py-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 text-slate-950 font-black text-xs shadow-lg shadow-amber-500/40 flex items-center gap-1.5 transition active:scale-95 border border-amber-300 ring-2 ring-amber-400/80 animate-pulse";
      refreshBtn.title = "The new order is not saved to track file names yet. Click to save.";
      const span = refreshBtn.querySelector('span');
      if (span) span.textContent = "Save Order";
    } else {
      // Normal Orange state
      refreshBtn.className = "px-3 py-1.5 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-bold text-xs shadow-md shadow-orange-500/20 flex items-center gap-1.5 transition active:scale-95 border border-orange-400/40";
      refreshBtn.title = "Refresh the latest data and tracks";
      const span = refreshBtn.querySelector('span');
      if (span) span.textContent = "Refresh Data";
    }
  }

  updateSyncStatusBadge();
  if (window.lucide) lucide.createIcons();
}

function updateSyncStatusBadge() {
  const syncBadge = document.getElementById('sync-status-indicator');
  const syncText = document.getElementById('sync-status-text');
  if (!syncBadge || !syncText) return;

  if (isSequenceDirty) {
    syncBadge.className = 'flex items-center gap-1.5 text-xs text-amber-300 font-medium px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/30';
    syncBadge.title = 'Local sequence has unsaved edits';
    syncText.textContent = 'Unsynced Edits';
    const dot = syncBadge.querySelector('span:first-child');
    if (dot) dot.className = 'w-2 h-2 rounded-full bg-amber-400 animate-ping';
  } else {
    syncBadge.className = 'flex items-center gap-1.5 text-xs text-emerald-400 font-medium px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20';
    const ago = formatTimeAgo(lastSyncedAt);
    syncText.textContent = `● Exported: ${ago}`;
    if (lastSyncedAt) {
      syncBadge.title = `The event database is the source of truth. signups.xlsx was last written: ${new Date(lastSyncedAt).toLocaleString()}`;
    }
    const dot = syncBadge.querySelector('span:first-child');
    if (dot) dot.className = 'w-2 h-2 rounded-full bg-emerald-500 animate-pulse';
  }
}

function formatTimeAgo(isoString) {
  if (!isoString) return 'Just now';
  const date = new Date(isoString);
  const now = new Date();
  const diffSec = Math.floor((now - date) / 1000);
  if (diffSec < 15) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  return `${diffHr}h ago`;
}

function formatTime(seconds) {
  if (isNaN(seconds) || seconds === 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[m]);
}
