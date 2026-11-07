// Deck rules: while sound is live, picking an act never touches the deck or audio.
import { isLive } from './transport.js';

export function isDoneItem(item) {
  return Boolean(item) && (item.performance_status === 'Performed' || item.track_status === 'Performed');
}
export function isHeldItem(item) {
  return Boolean(item) && (item.performance_status === 'On Hold' || item.track_status === 'Skipped');
}
export function isEligibleForStage(item) {
  if (!item) return false;
  const ptype = (item.performance_type || '').toLowerCase();
  if (ptype.includes('acoustic') || ptype.includes('live') || ptype.includes('group')) return true;
  return item.track_status === 'Uploaded' || Boolean(item.drive_file_id);
}

// Next eligible act after the cued one (wrapping once), skipping done/held.
export function findNextEligible(queue, currentId) {
  if (!Array.isArray(queue) || queue.length === 0) return null;
  const idx = currentId ? queue.findIndex(q => q.entry_id === currentId) : -1;
  const ok = it => !isDoneItem(it) && !isHeldItem(it) && isEligibleForStage(it) && it.entry_id !== currentId;
  for (let i = idx + 1; i < queue.length; i++) if (ok(queue[i])) return queue[i];
  for (let i = 0; i < idx; i++) if (ok(queue[i])) return queue[i];
  return null;
}

// Row click / row Cue button. Returns what happened: 'ondeck' | 'loaded' | 'ignored'.
export function selectAct({transport, item, currentId, loadAct, setOnDeck}) {
  if (!item) return 'ignored';
  if (isLive(transport.state)) {
    if (item.entry_id === currentId) return 'ignored';
    setOnDeck(item);
    return 'ondeck';
  }
  loadAct(item);
  return 'loaded';
}

// "Cue next": loads the on-deck act (or the computed next). Caller wraps in the disruption modal.
export function resolveCueNext({queue, currentId, onDeckId}) {
  if (onDeckId) {
    const picked = queue.find(q => q.entry_id === onDeckId);
    if (picked && !isDoneItem(picked) && picked.entry_id !== currentId) return picked;
  }
  return findNextEligible(queue, currentId);
}
