// Persist and replay console actions without changing the existing queue format.
const OFFLINE_QUEUE_KEY = 'paattukoottam_offline_actions';

export function getOfflineActions() {
  try {
    return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]');
  } catch (e) {
    return [];
  }
}

export function saveOfflineActions(actions) {
  try {
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(actions));
  } catch (e) {}
}

export async function replayOfflineActions(actions, getHeaders, fetchRequest = fetch) {
  const remaining = [];

  for (const act of actions) {
    try {
      let res;
      if (act.type === 'update_status') {
        res = await fetchRequest(`/api/status/${act.entryId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...getHeaders() },
          body: JSON.stringify(act.payload)
        });
      } else if (act.type === 'stage_notes') {
        res = await fetchRequest(`/api/performance-notes/${act.entryId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...getHeaders() },
          body: JSON.stringify(act.payload)
        });
      } else if (act.type === 'set_active') {
        res = await fetchRequest(`/api/set-active/${act.entryId}`, {
          method: 'POST',
          headers: getHeaders()
        });
      } else if (act.type === 'uncue') {
        res = await fetchRequest('/api/clear-active', {
          method: 'POST',
          headers: getHeaders()
        });
      } else if (act.type === 'reorder') {
        res = await fetchRequest('/api/reorder-queue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getHeaders() },
          body: JSON.stringify(act.payload)
        });
      }
      if (!res || !res.ok) {
        remaining.push(act);
      }
    } catch (err) {
      remaining.push(act);
    }
  }

  return remaining;
}

// Only one replay can run in this tab. Remove an action immediately after its
// successful response, re-reading storage so actions queued during fetch stay.
let replayInFlight = null;
export function drainOfflineActions(getHeaders, fetchRequest = fetch) {
  if (replayInFlight) return replayInFlight;
  replayInFlight = (async () => {
    let synced = 0;
    while (true) {
      const queue = getOfflineActions();
      if (!Array.isArray(queue) || queue.length === 0) return synced;
      const action = queue[0];
      const remaining = await replayOfflineActions([action], getHeaders, fetchRequest);
      if (remaining.length) return synced; // Later actions must not overtake this one.
      const latest = getOfflineActions();
      if (!Array.isArray(latest) || JSON.stringify(latest[0]) !== JSON.stringify(action)) return synced;
      try {
        localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(latest.slice(1)));
      } catch (error) {
        return synced; // Keep the queue intact if it could not be saved.
      }
      synced += 1;
    }
  })().finally(() => { replayInFlight = null; });
  return replayInFlight;
}
