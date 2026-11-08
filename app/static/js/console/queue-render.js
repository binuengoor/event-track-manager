import { S, hooks, isAudioPlaying, reorderLock } from "./state.js";
import { getOfflineActions } from "./offline-actions.js";
import { updateStageNotes, updateStatus } from "./act-actions.js";
import { cueNextTrack, cueTrack, onDeckTarget, renderOnDeck, selectRow } from "./deck.js";
import { confirmIfPlaying } from "./disruption.js";
import { bindHoldButton, createHoldConfirm } from "./hold-confirm.js";
import { persistQueueSnapshot } from "./offline-sync.js";
import { moveItem } from "./reorder.js";
import { relayLiveSoon } from "./stage-sync.js";
import { idlePusher, setDirtyState } from "./sync-order.js";
import { escapeHtml, getAuthHeaders, showToast } from "./util.js";
import { handleSingleTrackCache } from "./vault-ui.js";

let draggedItemIndex = null;

export function renderTypePill(perfType) {
  const raw = (perfType || 'Solo').trim();
  return `<span class="c-type">${escapeHtml(raw)}</span>`;
}

export function updateQueueStatsSummary() {
  const statsSummary = document.getElementById('stats-summary');
  const countPill = document.getElementById('queue-count-pill');
  if (!statsSummary || !countPill || !S.queue) return;

  const total = S.queue.length;
  const performed = S.queue.filter(q => q.performance_status === 'Performed' || q.track_status === 'Performed').length;
  const skipped = S.queue.filter(q => (q.performance_status === 'On Hold' || q.track_status === 'Skipped') && q.performance_status !== 'Performed' && q.track_status !== 'Performed').length;
  const uploaded = S.queue.filter(q => (q.performance_status !== 'Performed' && q.track_status !== 'Performed') && (q.performance_status !== 'On Hold' && q.track_status !== 'Skipped') && (q.track_status === 'Uploaded' || Boolean(q.track_version))).length;
  const pending = S.queue.filter(q => (q.performance_status !== 'Performed' && q.track_status !== 'Performed') && (q.performance_status !== 'On Hold' && q.track_status !== 'Skipped') && q.track_status !== 'Uploaded' && !q.track_version && q.track_status !== 'Acoustic' && (q.performance_type || '').toLowerCase() !== 'acoustic').length;

  const totalEl = document.getElementById('queue-total-count');
  if (totalEl) totalEl.textContent = String(total);
  statsSummary.textContent = `${total} sequenced • ${uploaded} ready • ${skipped} on hold • ${pending} pending • ${performed} done`;
  countPill.textContent = `${performed}/${total} completed`;
}

export function setupSearch() {
  const searchInput = document.getElementById('queue-search-input');
  const clearBtn = document.getElementById('search-clear-btn');

  searchInput.addEventListener('input', (e) => {
    S.searchQuery = e.target.value.trim().toLowerCase();
    if (S.searchQuery) {
      clearBtn.classList.remove('hidden');
    } else {
      clearBtn.classList.add('hidden');
    }
    applyFilter();
  });

  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    S.searchQuery = '';
    clearBtn.classList.add('hidden');
    applyFilter();
    searchInput.focus();
  });
}

export function applyFilter() {
  const matchCount = document.getElementById('search-match-count');
  if (!S.searchQuery) {
    S.filteredQueue = [...S.queue];
    matchCount.classList.add('hidden');
  } else {
    S.filteredQueue = S.queue.filter(item => {
      const pName = (item.performer_name || '').toLowerCase();
      const partName = (item.partner_name || '').toLowerCase();
      const sTitle = (item.song_title || '').toLowerCase();
      const mName = (item.movie_name || '').toLowerCase();
      const pType = (item.performance_type || '').toLowerCase();
      const seq = String(item.sequence_order || '');
      const entryId = (item.entry_id || '').toLowerCase();

      return pName.includes(S.searchQuery) ||
             partName.includes(S.searchQuery) ||
             sTitle.includes(S.searchQuery) ||
             mName.includes(S.searchQuery) ||
             pType.includes(S.searchQuery) ||
             seq.includes(S.searchQuery) ||
             entryId.includes(S.searchQuery);
    });

    matchCount.textContent = `${S.filteredQueue.length} of ${S.queue.length} matches`;
    matchCount.classList.remove('hidden');
  }

  renderQueueList();
}

export function renderQueueList() {
  const container = document.getElementById('queue-container');
  if (S.filteredQueue.length === 0) {
    container.innerHTML = `<div class="c-list__empty">No performances match "${escapeHtml(S.searchQuery)}"</div>`;
    renderOnDeck();
    return;
  }

  container.innerHTML = '';
  const queuedIds = new Set(getOfflineActions().map(a => a && a.entryId).filter(Boolean));
  S.filteredQueue.forEach((item, index) => {
    const isCued = S.currentCuedItem && S.currentCuedItem.entry_id === item.entry_id;
    const isDone = item.performance_status === 'Performed' || item.track_status === 'Performed';
    const isSkipped = !isDone && (item.performance_status === 'On Hold' || item.track_status === 'Skipped');
    const isAcoustic = !isDone && !isSkipped && (item.track_status === 'Acoustic' || (item.performance_type || '').toLowerCase().includes('acoustic'));
    const isUploaded = !isDone && !isSkipped && (item.track_status === 'Uploaded' || Boolean(item.track_version));
    const deckTarget = onDeckTarget();
    const isDeck = !isCued && deckTarget && deckTarget.entry_id === item.entry_id;
    const isVideo = (item.media_type === 'video') || Boolean(item.track_file && item.track_file.endsWith('.mp4'));
    const live = isCued && isAudioPlaying();
    const playable = isUploaded || Boolean(item.track_version) || isAcoustic;

    const row = document.createElement('div');
    row.id = `queue-row-${item.entry_id}`;
    row.dataset.entryId = item.entry_id;
    row.dataset.index = index;
    row.draggable = reorderLock.canDrag(S.searchQuery); // drag only when unlocked and not searching
    const state = isCued ? (live ? 'is-cued is-playing' : 'is-cued')
      : isDeck ? 'is-deck ondeck-row'
      : isDone ? 'is-done'
      : isSkipped ? 'is-hold'
      : playable ? 'is-ready' : 'is-need';
    row.className = `c-row ${state}`;

    const seqNum = item.sequence_order !== null ? String(item.sequence_order).padStart(2, '0') : '??';

    // Performer display: duets read "A & B"; the full text is in the tooltip for long names.
    const performerText = item.partner_name ? `${item.performer_name} & ${item.partner_name}` : (item.performer_name || '');

    let tagText;
    if (isCued) tagText = live ? 'Playing' : 'Cued';
    else if (isDeck) tagText = 'On deck';
    else if (isDone) tagText = 'Done';
    else if (isSkipped) tagText = 'On hold';
    else if (isUploaded) tagText = 'Ready';
    else if (isAcoustic) tagText = 'Live';
    else tagText = 'Needs track';

    const durationInfo = item.duration ? `<span class="c-row__dur">${escapeHtml(item.duration)}</span>` : '';

    const extraTagsPills = (item.extra_tags || []).map(tag => `<span class="c-chipmini">${escapeHtml(tag)}</span>`).join('');

    const isCached = S.cachedVaultEntryIds.has(item.entry_id);
    const cachedBadgeHtml = (isUploaded || item.track_version)
      ? `<span class="vault-cached-tag c-cached ${isCached ? '' : 'hidden'}" title="Audio cached in local Vault for offline playback" role="img" aria-label="Cached in the vault"><i data-lucide="shield-check"></i></span>`
      : '';
    const queuedHtml = queuedIds.has(item.entry_id)
      ? '<span class="c-queued" title="Change waiting to sync"><i data-lucide="refresh-cw"></i>Queued</span>'
      : '';

    let cacheBtnHtml = '';
    if (isUploaded || item.track_version) {
      cacheBtnHtml = `
        <button type="button" class="btn-cache-single c-act ${isCached ? '' : 'c-act--info'}" data-entry-id="${item.entry_id}" title="${isCached ? 'Track already in browser Vault. Click to re-download fresh copy.' : 'Pre-cache this audio track into local browser Vault without cueing'}">
          <i data-lucide="${isCached ? 'refresh-cw' : 'hard-drive-download'}"></i>
          <span>${isCached ? 'Re-cache' : 'Cache'}</span>
        </button>`;
    }

    const hasNote = Boolean(item.stage_notes && item.stage_notes.trim());
    const noteHtml = hasNote
      ? `<button type="button" class="btn-edit-note c-act c-act--note" title="Edit stage note: ${escapeHtml(item.stage_notes.trim())}"><i data-lucide="file-text"></i><span class="note-val">${escapeHtml(item.stage_notes.trim())}</span></button>`
      : `<button type="button" class="btn-edit-note c-act" title="Add stage note for live program view"><i data-lucide="plus"></i><span>Note</span></button>`;

    row.innerHTML = `
      <div class="c-row__main">
        ${reorderLock.canDrag(S.searchQuery) ? `
        <span class="drag-handle c-row__grip" title="Drag to re-order sequence" aria-hidden="true">
          <svg width="14" height="18" viewBox="0 0 14 18" fill="currentColor"><circle cx="4" cy="3" r="1.5"/><circle cx="10" cy="3" r="1.5"/><circle cx="4" cy="9" r="1.5"/><circle cx="10" cy="9" r="1.5"/><circle cx="4" cy="15" r="1.5"/><circle cx="10" cy="15" r="1.5"/></svg>
        </span>` : ''}
        <span class="c-row__num">${seqNum}</span>
        <div class="c-row__text">
          <span class="c-row__song" title="${escapeHtml(item.song_title)}">${escapeHtml(item.song_title)}${durationInfo}</span>
          <span class="c-row__who" title="${escapeHtml(performerText)}">${escapeHtml(performerText)}</span>
        </div>
        ${isVideo ? renderTypePill('Video') : ''}
        ${cachedBadgeHtml}
        ${queuedHtml}
        <span class="c-row__tag">${tagText}</span>
      </div>
      <div class="c-row__actions">
        ${extraTagsPills}
        ${noteHtml}
        ${cacheBtnHtml}
        <button type="button" class="btn-cue-row c-act ${isCued ? 'c-act--on' : ''}" ${playable ? '' : 'disabled'} title="Load act into player view & stage display">
          <i data-lucide="${isAcoustic ? 'guitar' : 'disc-3'}"></i><span>${isCued ? 'Cued' : 'Cue'}</span>
        </button>
        ${!isDone ? `
        <button type="button" class="btn-hold-row c-act c-act--warn ${isSkipped ? 'c-act--on' : ''}" title="${isSkipped ? 'Return performer to queue' : 'Put performer on hold / skip'}">
          <i data-lucide="${isSkipped ? 'play' : 'pause-circle'}"></i><span>${isSkipped ? 'Re-Queue' : 'Hold'}</span>
        </button>` : ''}
        <button type="button" class="btn-done-row c-act c-act--ok" title="${isDone ? 'Undo completed status' : 'Mark as completed'}">
          <i data-lucide="${isDone ? 'rotate-ccw' : 'check'}"></i><span>${isDone ? 'Undo' : 'Done'}</span>
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
      if (isUploaded || item.track_version || isAcoustic) {
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
    if (reorderLock.canDrag(S.searchQuery)) {
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
        S.queue = moveItem(S.queue, draggedItemIndex, index);
        draggedItemIndex = null;

        S.filteredQueue = [...S.queue];
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

export async function saveReorderedSequence() {
  const payload = S.queue.map(it => ({
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
      body: JSON.stringify({ items: payload, save_files: false })
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

hooks.updateQueueStatsSummary = updateQueueStatsSummary;
hooks.renderQueueList = renderQueueList;
hooks.applyFilter = applyFilter;
