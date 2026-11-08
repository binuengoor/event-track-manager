import { S, hooks } from "./state.js";
import { appendOfflineAction, coordinatedOfflineQueueAvailable, drainOfflineQueue, getOfflineActions } from "./offline-actions.js";
import { getAuthHeaders, showToast } from "./util.js";

let offlineSaveFailure = false;
let snapshotUnavailable = false;
export const unsavedOfflineActions = new Map();
let nextActionSequence = 0;
export const consoleIntentSession = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
export function actionKey(type, entryId) {
  // Cue and uncue both update the one active act. Status and notes are per act.
  if (type === 'set_active' || type === 'uncue') return 'active-act';
  return `${type}:${entryId || ''}`;
}
export function beginAction(payload = {}) {
  return { sequence: ++nextActionSequence, value: JSON.stringify(payload) };
}
export function actionReachedServer(type, entryId, action) {
  const key = actionKey(type, entryId);
  const unsaved = unsavedOfflineActions.get(key);
  if (unsaved && action && action.sequence >= unsaved.sequence) {
    unsavedOfflineActions.delete(key);
  }
  offlineSaveFailure = unsavedOfflineActions.size > 0;
  updateNetworkStatusDisplay();
}
export function persistQueueSnapshot() {
  try {
    localStorage.setItem('paattukoottam_cached_queue', JSON.stringify(S.queue));
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
export async function enqueueOfflineAction(type, entryId, payload = {}, action = beginAction(payload)) {
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

export async function syncOfflineActions() {
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
    await hooks.loadQueue();
  }
}

export function updateNetworkStatusDisplay() {
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

