import { S, hooks, reorderLock } from "./state.js";
import { createIdlePusher } from "./reorder.js";
import { relayLiveSoon } from "./stage-sync.js";
import { formatTimeAgo, getAuthHeaders, showToast } from "./util.js";
import { autoVaultSync } from "./vault-ui.js";

// =============================================================================
// REORDER LOCK, SCREENS, VAULT SHEET, WAKE LOCK
// =============================================================================
export async function pushSequenceQuiet() {
  if (!S.isSequenceDirty || !navigator.onLine) return;
  try {
    const res = await fetch('/api/push-sequence', { method: 'POST', headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to save the order');
    const data = await res.json();
    S.lastSyncedAt = data.last_synced_at;
    setDirtyState(false);
    relayLiveSoon();
    showToast(`✓ Order saved for ${data.synced_count} acts. Track files renamed and export updated.`);
  } catch (err) {
    showToast(`Order is saved, but file renames did not run: ${err.message}. Press Save Order to retry.`, 'error');
  }
}
export const idlePusher = createIdlePusher({ push: pushSequenceQuiet });

export function updateReorderLockUi() {
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

export async function handleSyncButtonClick() {
  idlePusher.cancel();
  const refreshBtn = document.getElementById('refresh-queue-btn');
  const icon = document.getElementById('refresh-icon');
  refreshBtn.classList.add('opacity-50', 'pointer-events-none');
  if (icon) icon.classList.add('animate-spin');

  try {
    if (S.isSequenceDirty) {
      // Operator has uncommitted sequence order changes: push them now!
      const pushRes = await fetch('/api/push-sequence', {
        method: 'POST',
        headers: getAuthHeaders()
      });
      if (!pushRes.ok) throw new Error('Failed to save the order');
      const pushData = await pushRes.json();
      S.lastSyncedAt = pushData.last_synced_at;
      setDirtyState(false);
      showToast(`✓ Order saved for ${pushData.synced_count} acts. Track files renamed and export updated.`);
    } else {
      // Normal refresh
      const syncRes = await fetch('/api/sync', { method: 'POST', headers: getAuthHeaders() });
      if (syncRes.ok) {
        const syncData = await syncRes.json();
        S.lastSyncedAt = syncData.last_synced_at;
      }
    }
  } catch (e) {
    console.warn("Sync error:", e);
    showToast(`Sync failed: ${e.message}`, 'error');
  }

  await hooks.loadQueue(false);
  autoVaultSync();
  refreshBtn.classList.remove('opacity-50', 'pointer-events-none');
  if (icon) icon.classList.remove('animate-spin');
}

export function setDirtyState(dirty) {
  S.isSequenceDirty = dirty;
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

export function updateSyncStatusBadge() {
  const syncBadge = document.getElementById('sync-status-indicator');
  const syncText = document.getElementById('sync-status-text');
  if (!syncBadge || !syncText) return;

  if (S.isSequenceDirty) {
    syncBadge.className = 'flex items-center gap-1.5 text-xs text-amber-300 font-medium px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/30';
    syncBadge.title = 'Local sequence has unsaved edits';
    syncText.textContent = 'Unsynced Edits';
    const dot = syncBadge.querySelector('span:first-child');
    if (dot) dot.className = 'w-2 h-2 rounded-full bg-amber-400 animate-ping';
  } else {
    syncBadge.className = 'flex items-center gap-1.5 text-xs text-emerald-400 font-medium px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20';
    const ago = formatTimeAgo(S.lastSyncedAt);
    syncText.textContent = `● Exported: ${ago}`;
    if (S.lastSyncedAt) {
      syncBadge.title = `The event database is the source of truth. signups.xlsx was last written: ${new Date(S.lastSyncedAt).toLocaleString()}`;
    }
    const dot = syncBadge.querySelector('span:first-child');
    if (dot) dot.className = 'w-2 h-2 rounded-full bg-emerald-500 animate-pulse';
  }
}

