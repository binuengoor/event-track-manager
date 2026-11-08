import { S, hooks } from "./state.js";
import { actionReachedServer, beginAction, enqueueOfflineAction, persistQueueSnapshot } from "./offline-sync.js";
import { updatePlayerBarNotes, updatePlayerBarState } from "./player-bar.js";
import { relayLiveSoon } from "./stage-sync.js";
import { getAuthHeaders, showToast } from "./util.js";

export async function updateStatus(entryId, newStatus) {
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
  const target = S.queue.find(q => q.entry_id === entryId);
  if (target) {
    target.performance_status = normalizedPerfStatus;
  }
  if (S.currentCuedItem && S.currentCuedItem.entry_id === entryId) {
    S.currentCuedItem.performance_status = normalizedPerfStatus;
    updatePlayerBarState();
  }
  hooks.updateQueueStatsSummary();
  hooks.applyFilter();
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

export async function updateStageNotes(entryId, notes) {
  const action = beginAction({ notes: notes });
  const target = S.queue.find(q => q.entry_id === entryId);
  if (target) target.stage_notes = notes || '';

  if (S.currentCuedItem && S.currentCuedItem.entry_id === entryId) {
    S.currentCuedItem.stage_notes = notes || '';
    updatePlayerBarNotes(notes || '');
  }

  hooks.renderQueueList();
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

