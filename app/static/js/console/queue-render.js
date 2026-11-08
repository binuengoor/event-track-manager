import { S, hooks, reorderLock } from "./state.js";
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

export function updateQueueStatsSummary() {
  const statsSummary = document.getElementById('stats-summary');
  const countPill = document.getElementById('queue-count-pill');
  if (!statsSummary || !countPill || !S.queue) return;

  const total = S.queue.length;
  const performed = S.queue.filter(q => q.performance_status === 'Performed' || q.track_status === 'Performed').length;
  const skipped = S.queue.filter(q => (q.performance_status === 'On Hold' || q.track_status === 'Skipped') && q.performance_status !== 'Performed' && q.track_status !== 'Performed').length;
  const uploaded = S.queue.filter(q => (q.performance_status !== 'Performed' && q.track_status !== 'Performed') && (q.performance_status !== 'On Hold' && q.track_status !== 'Skipped') && (q.track_status === 'Uploaded' || Boolean(q.drive_file_id))).length;
  const pending = S.queue.filter(q => (q.performance_status !== 'Performed' && q.track_status !== 'Performed') && (q.performance_status !== 'On Hold' && q.track_status !== 'Skipped') && q.track_status !== 'Uploaded' && !q.drive_file_id && q.track_status !== 'Acoustic' && (q.performance_type || '').toLowerCase() !== 'acoustic').length;

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
    container.innerHTML = `<div class="p-8 text-center text-slate-500 text-sm">No performances match "${escapeHtml(S.searchQuery)}"</div>`;
    renderOnDeck();
    return;
  }

  container.innerHTML = '';
  S.filteredQueue.forEach((item, index) => {
    const isCued = S.currentCuedItem && S.currentCuedItem.entry_id === item.entry_id;
    const isDone = item.performance_status === 'Performed' || item.track_status === 'Performed';
    const isSkipped = !isDone && (item.performance_status === 'On Hold' || item.track_status === 'Skipped');
    const isAcoustic = !isDone && !isSkipped && (item.track_status === 'Acoustic' || (item.performance_type || '').toLowerCase().includes('acoustic'));
    const isUploaded = !isDone && !isSkipped && (item.track_status === 'Uploaded' || Boolean(item.drive_file_id));

    const row = document.createElement('div');
    row.id = `queue-row-${item.entry_id}`;
    row.dataset.entryId = item.entry_id;
    row.dataset.index = index;
    row.draggable = reorderLock.canDrag(S.searchQuery); // drag only when unlocked and not searching
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

    const isCached = S.cachedVaultEntryIds.has(item.entry_id);
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
        ${reorderLock.canDrag(S.searchQuery) ? `
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
          <i data-lucide="${isCued ? (isAcoustic ? 'guitar' : 'disc') : (isAcoustic ? 'guitar' : 'disc-3')}" class="w-3.5 h-3.5 ${isCued && S.isPlaying ? 'animate-spin' : ''}"></i>
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

hooks.updateQueueStatsSummary = updateQueueStatsSummary;
hooks.renderQueueList = renderQueueList;
hooks.applyFilter = applyFilter;
