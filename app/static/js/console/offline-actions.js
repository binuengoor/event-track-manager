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
