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
    if (hooks.renderQueueList) hooks.renderQueueList(); // shows the row's Queued badge
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

// Offline banner: one line per change waiting to send, in the order they were made.
export function describeQueuedAction(act) {
  const status = act && act.payload && act.payload.status;
  switch (act && act.type) {
    case 'update_status': return status === 'Performed' ? 'Marked done' : `Status set to ${status === 'On Stage' ? 'On stage' : (status || 'a new value')}`;
    case 'stage_notes': return 'Act note edited';
    case 'set_active': return 'Status set to On stage';
    case 'uncue': return 'Uncued';
    case 'reorder': return 'Running order changed';
    default: return 'Change saved';
  }
}
export function renderOfflineQueueBanner(actions) {
  const banner = document.getElementById('offline-queue-banner');
  if (!banner || !banner.classList) return;
  const list = Array.isArray(actions) ? actions : [];
  if (list.length === 0) { banner.classList.add('hidden'); banner.textContent = ''; return; }
  const entryNum = id => {
    const row = S.queue && S.queue.find(q => q.entry_id === id);
    return row && row.sequence_order != null ? String(row.sequence_order).padStart(2, '0') : '';
  };
  banner.textContent = '';
  const head = document.createElement('p');
  head.className = 'c-offline__head';
  const left = document.createElement('span');
  left.textContent = `Waiting to sync \u00b7 ${list.length}`;
  const right = document.createElement('span');
  right.className = 'c-offline__when';
  right.textContent = 'Sends when back online';
  head.append(left, right);
  banner.append(head);
  const ul = document.createElement('ul');
  ul.className = 'c-offline__list';
  list.slice(0, 6).forEach(act => {
    const li = document.createElement('li');
    const n = document.createElement('span');
    n.className = 'c-offline__num';
    n.textContent = entryNum(act.entryId);
    li.append(n, document.createTextNode(describeQueuedAction(act)));
    ul.append(li);
  });
  if (list.length > 6) {
    const li = document.createElement('li');
    li.textContent = `and ${list.length - 6} more`;
    ul.append(li);
  }
  banner.append(ul);
  banner.classList.remove('hidden');
}

export function updateNetworkStatusDisplay() {
  const dot = document.getElementById('network-dot');
  const text = document.getElementById('network-status-text');
  const indicator = document.getElementById('network-status-indicator');
  if (!text || !dot) return;

  const isOnline = navigator.onLine;
  const offlineActions = getOfflineActions();
  const offlineCount = offlineActions.length;
  renderOfflineQueueBanner(offlineActions);

  if (offlineSaveFailure) {
    dot.className = 'c-dot';
    text.textContent = 'Unsaved local change — not queued for sync';
    if (indicator) indicator.className = 'c-status c-status--bad';
    return;
  }
  if (snapshotUnavailable) {
    dot.className = 'c-dot';
    text.textContent = 'Offline copy unavailable';
    if (indicator) indicator.className = 'c-status c-status--warn';
    return;
  }
  if (isOnline) {
    dot.className = 'c-dot';
    if (indicator) indicator.className = 'c-status c-status--ok';
    if (offlineCount > 0) {
      text.textContent = `Online (${offlineCount} syncing...)${coordinatedOfflineQueueAvailable() ? '' : ' · use one console tab'}`;
    } else {
      text.textContent = 'Online';
    }
  } else {
    dot.className = 'c-dot c-dot--pulse';
    if (indicator) indicator.className = 'c-status c-status--warn';
    text.textContent = `Offline Mode${offlineCount > 0 ? ` (${offlineCount} pending)` : ''}${coordinatedOfflineQueueAvailable() ? '' : ' · use one console tab'}`;
  }
}

