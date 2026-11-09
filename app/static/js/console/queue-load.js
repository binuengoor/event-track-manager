import { S } from "./state.js";
import { cueTrack } from "./deck.js";
import { describeLoginFailure } from "./login.js";
import { updateNetworkStatusDisplay } from "./offline-sync.js";
import { updatePlayerBarState } from "./player-bar.js";
import { applyFilter, renderQueueList, updateQueueStatsSummary } from "./queue-render.js";
import { adoptServerAnnouncement, screens } from "./stage-sync.js";
import { setDirtyState, updateSyncStatusBadge } from "./sync-order.js";
import { getAuthHeaders, showToast } from "./util.js";
import { autoVaultSync, updateVaultStatusDisplay } from "./vault-ui.js";
import { hooks } from "./state.js";

let vaultSyncStarted = false;

export async function fetchEventInfo() {
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
        if (S.autoSyncInterval) clearInterval(S.autoSyncInterval);
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

export function setupAuth() {
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

      S.userAdminPin = pin;
      S.signedIn = true;
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

export function showAuthModal() {
  document.getElementById('auth-modal').classList.remove('hidden');
  document.getElementById('pin-input').focus();
}

export function hideAuthModal() {
  document.getElementById('auth-modal').classList.add('hidden');
  document.getElementById('pin-error').classList.add('hidden');
}

export async function testAuthAndLoad() {
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
      S.signedIn = true;
      hideAuthModal();
      await loadQueue();
    }
  } catch (e) {
    console.error('Initial load failed:', e);
    const savedQueue = localStorage.getItem('paattukoottam_cached_queue');
    if (savedQueue && S.userAdminPin) {
      hideAuthModal();
      try {
        S.queue = JSON.parse(savedQueue);
        S.filteredQueue = [...S.queue];
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

export async function loadQueue(silent = false) {
  const container = document.getElementById('queue-container');
  const statsSummary = document.getElementById('stats-summary');
  const countPill = document.getElementById('queue-count-pill');
  const syncText = document.getElementById('sync-status-text');
  const refreshIcon = document.getElementById('refresh-icon');

  if (!silent) {
    if (syncText) syncText.textContent = 'Syncing...';
    if (refreshIcon) refreshIcon.classList.add('c-spin');
  }

  try {
    const res = await fetch('/api/stage-queue', { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to fetch stage queue');
    S.queue = await res.json();
    localStorage.setItem('paattukoottam_cached_queue', JSON.stringify(S.queue));

    updateQueueStatsSummary();

    // Fetch live status for dirty state, active performer, and sync timestamp
    let liveData = null;
    try {
      const liveRes = await fetch('/api/live-status');
      if (liveRes.ok) {
        liveData = await liveRes.json();
        S.lastSyncedAt = liveData.last_synced_at;
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
    if (S.currentCuedItem) {
      const matchItem = S.queue.find(q => q.entry_id === S.currentCuedItem.entry_id);
      if (matchItem) {
        S.currentCuedItem = matchItem;
        updatePlayerBarState();
      }
    } else if (S.queue.length > 0) {
      const serverActiveId = liveData ? liveData.active_entry_id : null;
      const candidateId = serverActiveId || localStorage.getItem('paattukoottam_cued_entry_id');

      if (candidateId) {
        const matchItem = S.queue.find(q => q.entry_id === candidateId);
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
      showToast(`Loaded ${S.queue.length} performances from Event Database`);
    }
  } catch (err) {
    if (syncText) syncText.textContent = navigator.onLine ? 'Sync Error' : 'Offline';
    const savedQueue = localStorage.getItem('paattukoottam_cached_queue');
    if (savedQueue && (!S.queue || S.queue.length === 0)) {
      try {
        S.queue = JSON.parse(savedQueue);
        S.filteredQueue = [...S.queue];
        renderQueueList();
        updateVaultStatusDisplay();
      } catch (e) {}
    }
    if (!silent) {
      showToast(navigator.onLine ? `Sync failed: ${err.message}` : 'Running in Offline Mode using local cache', navigator.onLine ? 'error' : 'warning');
    }
  } finally {
    if (refreshIcon) refreshIcon.classList.remove('c-spin');
  }
}

hooks.loadQueue = loadQueue;
