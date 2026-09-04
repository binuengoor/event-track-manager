// EMA Paattukoottam Stage Playback Console
let queue = [];
let filteredQueue = [];
let currentCuedItem = null;
let wavesurfer = null;
let isPlaying = false;
let userAdminPin = localStorage.getItem('paattukoottam_pin') || '';
let searchQuery = '';
let draggedItemIndex = null;
let autoSyncInterval = null;
let isSequenceDirty = false;
let lastSyncedAt = null;

document.addEventListener('DOMContentLoaded', async () => {
  setupAuth();
  initWaveSurfer();
  setupKeyboardHotkeys();
  setupActionButtons();
  setupSearch();
  fetchEventInfo();

  if (userAdminPin) {
    await testAuthAndLoad();
  } else {
    showAuthModal();
  }

  // Periodic background sync every 45s (only if sequence is not dirty, so operator's unsaved reorder isn't overwritten)
  autoSyncInterval = setInterval(() => {
    if (userAdminPin && !isSequenceDirty && !document.getElementById('auth-modal').classList.contains('hidden') === false) {
      loadQueue(true); // silent background sync
    }
  }, 45000);

  // Update time-ago badge every 10 seconds
  setInterval(updateSyncStatusBadge, 10000);
});

async function fetchEventInfo() {
  try {
    const res = await fetch('/api/event-info');
    if (res.ok) {
      const data = await res.json();
      const title = data.app_title || data.event_name;
      if (title) {
        const titleEl = document.getElementById('admin-event-title');
        if (titleEl) titleEl.textContent = title;
        document.title = `${title} - Stage Console`;
      }
    }
  } catch (e) {
    console.warn('Could not fetch event info:', e);
  }
}

function getAuthHeaders() {
  const headers = {};
  if (userAdminPin) {
    headers['X-Admin-PIN'] = userAdminPin;
  }
  return headers;
}

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  const msgEl = document.getElementById('toast-message');
  const iconEl = document.getElementById('toast-icon');

  msgEl.textContent = message;
  if (type === 'error') {
    iconEl.innerHTML = '<i data-lucide="alert-triangle" class="w-4 h-4 text-rose-400"></i>';
    toast.className = 'fixed top-4 right-4 z-50 transform transition-all duration-300 translate-y-0 opacity-100 bg-rose-950/90 border border-rose-500/40 text-rose-200 px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-2.5 text-xs';
  } else {
    iconEl.innerHTML = '<i data-lucide="check-circle" class="w-4 h-4 text-emerald-400"></i>';
    toast.className = 'fixed top-4 right-4 z-50 transform transition-all duration-300 translate-y-0 opacity-100 bg-slate-900 border border-slate-700 text-slate-100 px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-2.5 text-xs';
  }

  if (window.lucide) lucide.createIcons();

  setTimeout(() => {
    toast.className = 'fixed top-4 right-4 z-50 transform transition-all duration-300 translate-y-[-150%] opacity-0 bg-slate-900 border border-slate-700 text-white px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-2.5 text-xs pointer-events-none';
  }, 3500);
}

function renderTypePill(perfType) {
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

function setupAuth() {
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

      if (!res.ok) throw new Error('Incorrect PIN');

      userAdminPin = pin;
      localStorage.setItem('paattukoottam_pin', pin);
      hideAuthModal();
      await loadQueue();
    } catch (err) {
      errorMsg.textContent = 'Invalid PIN. Please try again.';
      errorMsg.classList.remove('hidden');
      input.value = '';
      input.focus();
    }
  });
}

function showAuthModal() {
  document.getElementById('auth-modal').classList.remove('hidden');
  document.getElementById('pin-input').focus();
}

function hideAuthModal() {
  document.getElementById('auth-modal').classList.add('hidden');
  document.getElementById('pin-error').classList.add('hidden');
}

async function testAuthAndLoad() {
  try {
    const res = await fetch('/api/stage-queue', { headers: getAuthHeaders() });
    if (res.status === 401) {
      showAuthModal();
    } else {
      hideAuthModal();
      await loadQueue();
    }
  } catch (e) {
    console.error('Initial load failed:', e);
    showAuthModal();
  }
}

async function loadQueue(silent = false) {
  const container = document.getElementById('queue-container');
  const statsSummary = document.getElementById('stats-summary');
  const countPill = document.getElementById('queue-count-pill');
  const syncText = document.getElementById('sync-status-text');
  const refreshIcon = document.getElementById('refresh-icon');

  if (!silent) {
    syncText.textContent = 'Syncing...';
    if (refreshIcon) refreshIcon.classList.add('animate-spin');
  }

  try {
    const res = await fetch('/api/stage-queue', { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to fetch stage queue');
    queue = await res.json();

    const total = queue.length;
    const uploaded = queue.filter(q => q.track_status === 'Uploaded').length;
    const performed = queue.filter(q => q.track_status === 'Performed').length;
    const skipped = queue.filter(q => q.track_status === 'Skipped').length;
    const pending = queue.filter(q => q.track_status === 'Pending').length;

    statsSummary.textContent = `${total} sequenced • ${uploaded} ready • ${skipped} on hold • ${pending} pending • ${performed} done`;
    countPill.textContent = `${performed}/${total} completed`;

    // Fetch live status for dirty state and last sync timestamp
    try {
      const liveRes = await fetch('/api/live-status');
      if (liveRes.ok) {
        const liveData = await liveRes.json();
        lastSyncedAt = liveData.last_synced_at;
        setDirtyState(Boolean(liveData.is_dirty));
      }
    } catch (e) {
      console.warn("Could not check dirty status:", e);
    }

    updateSyncStatusBadge();
    applyFilter();

    if (!silent) {
      showToast(`Synced ${total} performances from Google Sheet`);
    }
  } catch (err) {
    syncText.textContent = 'Sync Error';
    if (!silent) {
      showToast(`Sync failed: ${err.message}`, 'error');
    }
  } finally {
    if (refreshIcon) refreshIcon.classList.remove('animate-spin');
  }
}

function setupSearch() {
  const searchInput = document.getElementById('queue-search-input');
  const clearBtn = document.getElementById('search-clear-btn');

  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value.trim().toLowerCase();
    if (searchQuery) {
      clearBtn.classList.remove('hidden');
    } else {
      clearBtn.classList.add('hidden');
    }
    applyFilter();
  });

  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    searchQuery = '';
    clearBtn.classList.add('hidden');
    applyFilter();
    searchInput.focus();
  });
}

function applyFilter() {
  const matchCount = document.getElementById('search-match-count');
  if (!searchQuery) {
    filteredQueue = [...queue];
    matchCount.classList.add('hidden');
  } else {
    filteredQueue = queue.filter(item => {
      const pName = (item.performer_name || '').toLowerCase();
      const partName = (item.partner_name || '').toLowerCase();
      const sTitle = (item.song_title || '').toLowerCase();
      const mName = (item.movie_name || '').toLowerCase();
      const pType = (item.performance_type || '').toLowerCase();
      const seq = String(item.sequence_order || '');
      const entryId = (item.entry_id || '').toLowerCase();

      return pName.includes(searchQuery) ||
             partName.includes(searchQuery) ||
             sTitle.includes(searchQuery) ||
             mName.includes(searchQuery) ||
             pType.includes(searchQuery) ||
             seq.includes(searchQuery) ||
             entryId.includes(searchQuery);
    });

    matchCount.textContent = `${filteredQueue.length} of ${queue.length} matches`;
    matchCount.classList.remove('hidden');
  }

  renderQueueList();
}

function renderQueueList() {
  const container = document.getElementById('queue-container');
  if (filteredQueue.length === 0) {
    container.innerHTML = `<div class="p-8 text-center text-slate-500 text-sm">No performances match "${escapeHtml(searchQuery)}"</div>`;
    return;
  }

  container.innerHTML = '';
  filteredQueue.forEach((item, index) => {
    const isCued = currentCuedItem && currentCuedItem.entry_id === item.entry_id;
    const isDone = item.track_status === 'Performed';
    const isSkipped = item.track_status === 'Skipped';
    const isAcoustic = item.track_status === 'Acoustic';
    const isUploaded = item.track_status === 'Uploaded';

    const row = document.createElement('div');
    row.id = `queue-row-${item.entry_id}`;
    row.dataset.entryId = item.entry_id;
    row.dataset.index = index;
    row.draggable = !searchQuery; // only allow drag-reorder when not in search filter
    row.className = `p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition border-l-4 ${
      isCued
        ? 'cued-active bg-orange-500/10 border-orange-500'
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

    row.innerHTML = `
      <div class="flex items-center gap-3">
        <!-- Drag Handle (hidden during search) -->
        ${!searchQuery ? `
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
          </div>
          <p class="text-xs text-orange-400 font-medium mt-0.5 ${isDone ? 'line-through text-slate-500' : ''}">
            "${escapeHtml(item.song_title)}" ${durationInfo}
          </p>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="flex items-center gap-2 self-end sm:self-center shrink-0 flex-wrap justify-end">
        ${statusPill}

        <!-- Cue Track -->
        <button class="btn-cue-row px-2.5 py-1.5 rounded-xl font-semibold text-xs transition flex items-center gap-1 ${
          isUploaded || item.drive_file_id
            ? (isCued ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/30' : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700')
            : 'bg-slate-800/50 text-slate-600 cursor-not-allowed border border-slate-800'
        }" ${isUploaded || item.drive_file_id ? '' : 'disabled'} title="Load track into player view without autoplay">
          <i data-lucide="${isCued ? 'disc' : 'disc-3'}" class="w-3.5 h-3.5 ${isCued && isPlaying ? 'animate-spin' : ''}"></i>
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
    row.querySelector('.btn-cue-row').addEventListener('click', () => {
      cueTrack(item, false);
    });

    const holdBtn = row.querySelector('.btn-hold-row');
    if (holdBtn) {
      holdBtn.addEventListener('click', async () => {
        const nextStatus = isSkipped ? 'Uploaded' : 'Skipped';
        await updateStatus(item.entry_id, nextStatus);
        if (nextStatus === 'Uploaded') {
          cueTrack(item, false);
        } else if (isCued) {
          cueNextTrack(false);
        }
      });
    }

    row.querySelector('.btn-done-row').addEventListener('click', async () => {
      const nextStatus = isDone ? (item.drive_file_id ? 'Uploaded' : 'Pending') : 'Performed';
      await updateStatus(item.entry_id, nextStatus);
      if (nextStatus === 'Performed' && isCued) {
        cueNextTrack(false);
      }
    });

    // Drag-and-drop sequencing listeners
    if (!searchQuery) {
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
        const [movedItem] = queue.splice(draggedItemIndex, 1);
        queue.splice(index, 0, movedItem);

        // Recalculate sequence numbers
        queue.forEach((it, i) => {
          it.sequence_order = i + 1;
        });

        filteredQueue = [...queue];
        renderQueueList();

        // Save reordered sequence to Google Sheet
        await saveReorderedSequence();
      });
    }

    container.appendChild(row);
  });

  if (window.lucide) lucide.createIcons();
}

async function saveReorderedSequence() {
  const payload = queue.map(it => ({
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
    showToast('Sequence staged locally. Click "Sync to Sheet" to push to Google Sheet & Drive.', 'info');
  } catch (err) {
    showToast(`Sequence staging failed: ${err.message}`, 'error');
  }
}

function initWaveSurfer() {
  const container = document.getElementById('player-waveform');
  if (!container || typeof WaveSurfer === 'undefined') return;

  try {
    wavesurfer = WaveSurfer.create({
      container: container,
      waveColor: '#475569',
      progressColor: '#f97316',
      cursorColor: '#fb923c',
      cursorWidth: 2,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      height: 44,
      normalize: true
    });

    wavesurfer.on('play', () => {
      isPlaying = true;
      updatePlayPauseButton();
    });

    wavesurfer.on('pause', () => {
      isPlaying = false;
      updatePlayPauseButton();
    });

    wavesurfer.on('timeupdate', (currentTime) => {
      document.getElementById('player-current-time').textContent = formatTime(currentTime);
    });

    wavesurfer.on('ready', (duration) => {
      document.getElementById('player-duration').textContent = formatTime(duration);
      document.getElementById('waveform-placeholder').classList.add('hidden');
    });

    wavesurfer.on('finish', () => {
      isPlaying = false;
      updatePlayPauseButton();
    });

  } catch (e) {
    console.warn('WaveSurfer initialization error:', e);
  }
}

function cueTrack(item, autoPlay = false) {
  currentCuedItem = item;

  const playerTitle = document.getElementById('player-title');
  const playerPerformer = document.getElementById('player-performer');
  const playBtn = document.getElementById('btn-play-pause');
  const markDoneBtn = document.getElementById('btn-mark-done');
  const holdBtn = document.getElementById('btn-hold-skip');
  const downloadBtn = document.getElementById('btn-download-cued');
  const playerBadge = document.getElementById('player-badge');

  playerTitle.textContent = item.song_title;
  let singerText = item.performer_name;
  if (item.partner_name) singerText = `Duet: ${item.performer_name} & ${item.partner_name}`;
  playerPerformer.textContent = `#${String(item.sequence_order || 0).padStart(2, '0')} • ${singerText}`;

  playerBadge.className = 'w-10 h-10 rounded-xl bg-orange-500/20 text-orange-400 flex items-center justify-center shrink-0 border border-orange-500/40';

  playBtn.disabled = false;
  markDoneBtn.disabled = false;
  holdBtn.disabled = false;

  // Configure 1-Click Track Download for Local Playback
  if (downloadBtn) {
    downloadBtn.onclick = async (e) => {
      e.preventDefault();
      if (!currentCuedItem) return;
      downloadBtn.classList.add('opacity-50', 'pointer-events-none');
      showToast('Downloading track...');
      try {
        const pin = localStorage.getItem('paattukoottam_pin') || '2026';
        const res = await fetch(`/api/download-track/${currentCuedItem.entry_id}?pin=${encodeURIComponent(pin)}`, {
          headers: getAuthHeaders()
        });
        if (!res.ok) throw new Error('Download failed from server');
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const disp = res.headers.get('Content-Disposition');
        let filename = `${currentCuedItem.entry_id}_track.mp3`;
        if (disp && disp.includes('filename=')) {
          filename = disp.split('filename=')[1].replace(/["']/g, '').trim();
        }
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        showToast('✓ Track downloaded for local playback!');
      } catch (err) {
        showToast(`Download error: ${err.message}`, 'error');
      } finally {
        downloadBtn.classList.remove('opacity-50', 'pointer-events-none');
      }
    };
    downloadBtn.classList.remove('opacity-40', 'pointer-events-none');
  }

  const placeholder = document.getElementById('waveform-placeholder');
  placeholder.textContent = 'Loading audio waveform...';
  placeholder.classList.remove('hidden');

  if (wavesurfer) {
    wavesurfer.load(`/api/stream/${item.entry_id}`);
    if (autoPlay) {
      wavesurfer.once('ready', () => {
        wavesurfer.play();
      });
    }
  }

  isPlaying = false;
  updatePlayPauseButton();
  renderQueueList();

  // Notify Live View of currently cued / active performer
  fetch(`/api/set-active/${item.entry_id}`, {
    method: 'POST',
    headers: getAuthHeaders()
  }).catch(() => {});
}

function updatePlayPauseButton() {
  const playIcon = document.getElementById('play-icon');
  if (!playIcon) return;
  if (isPlaying) {
    playIcon.setAttribute('data-lucide', 'pause');
  } else {
    playIcon.setAttribute('data-lucide', 'play');
  }
  if (window.lucide) lucide.createIcons();
}

function togglePlayPause() {
  if (!currentCuedItem || !wavesurfer) return;
  wavesurfer.playPause();
}

function isEligibleForStage(item) {
  const ptype = (item.performance_type || '').toLowerCase();
  if (ptype.includes('acoustic') || ptype.includes('live')) return true;
  if (ptype.includes('group')) return true;
  if (item.track_status === 'Uploaded' || item.drive_file_id) return true;
  return false;
}

function cueNextTrack(autoPlay = false) {
  if (queue.length === 0) return;

  let currentIndex = -1;
  if (currentCuedItem) {
    currentIndex = queue.findIndex(q => q.entry_id === currentCuedItem.entry_id);
  }

  for (let i = currentIndex + 1; i < queue.length; i++) {
    const item = queue[i];
    const isDone = item.performance_status === 'Performed' || item.track_status === 'Performed';
    const isSkipped = item.performance_status === 'On Hold' || item.track_status === 'Skipped';
    if (!isDone && !isSkipped && isEligibleForStage(item)) {
      cueTrack(item, autoPlay);
      return;
    }
  }

  if (currentIndex > 0) {
    for (let i = 0; i < currentIndex; i++) {
      const item = queue[i];
      const isDone = item.performance_status === 'Performed' || item.track_status === 'Performed';
      const isSkipped = item.performance_status === 'On Hold' || item.track_status === 'Skipped';
      if (!isDone && !isSkipped && isEligibleForStage(item)) {
        cueTrack(item, autoPlay);
        return;
      }
    }
  }
}

async function updateStatus(entryId, newStatus) {
  try {
    const res = await fetch(`/api/status/${entryId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders()
      },
      body: JSON.stringify({ status: newStatus })
    });

    if (!res.ok) throw new Error('Status update failed');

    const target = queue.find(q => q.entry_id === entryId);
    if (target) target.track_status = newStatus;

    applyFilter();
    showToast(`✓ Updated ${target ? target.performer_name : entryId} status to ${newStatus}`);
  } catch (err) {
    showToast(`Status update error: ${err.message}`, 'error');
  }
}

function setupKeyboardHotkeys() {
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (!document.getElementById('auth-modal').classList.contains('hidden')) return;

    if (e.code === 'Space') {
      e.preventDefault();
      togglePlayPause();
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault();
      if (wavesurfer) wavesurfer.seekTo(Math.max(0, (wavesurfer.getCurrentTime() - 5) / wavesurfer.getDuration()));
    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      if (wavesurfer) wavesurfer.seekTo(Math.min(1, (wavesurfer.getCurrentTime() + 5) / wavesurfer.getDuration()));
    } else if (e.code === 'ArrowDown') {
      e.preventDefault();
      cueNextTrack(false);
    } else if (e.code === 'Enter') {
      e.preventDefault();
      if (currentCuedItem) {
        updateStatus(currentCuedItem.entry_id, 'Performed');
        cueNextTrack(false);
      }
    }
  });
}

function setupActionButtons() {
  document.getElementById('btn-play-pause').addEventListener('click', togglePlayPause);

  document.getElementById('btn-seek-back').addEventListener('click', () => {
    if (wavesurfer) wavesurfer.seekTo(Math.max(0, (wavesurfer.getCurrentTime() - 5) / wavesurfer.getDuration()));
  });

  document.getElementById('btn-seek-fwd').addEventListener('click', () => {
    if (wavesurfer) wavesurfer.seekTo(Math.min(1, (wavesurfer.getCurrentTime() + 5) / wavesurfer.getDuration()));
  });

  document.getElementById('btn-cue-next').addEventListener('click', () => {
    cueNextTrack(false);
  });

  document.getElementById('btn-mark-done').addEventListener('click', async () => {
    if (currentCuedItem) {
      await updateStatus(currentCuedItem.entry_id, 'Performed');
      cueNextTrack(false);
    }
  });

  document.getElementById('btn-hold-skip').addEventListener('click', async () => {
    if (currentCuedItem) {
      await updateStatus(currentCuedItem.entry_id, 'Skipped');
      cueNextTrack(false);
    }
  });

  // Sync / Refresh button
  const refreshBtn = document.getElementById('refresh-queue-btn');
  refreshBtn.addEventListener('click', async () => {
    await handleSyncButtonClick();
  });

  // Banner sync button
  const bannerSyncBtn = document.getElementById('banner-sync-btn');
  if (bannerSyncBtn) {
    bannerSyncBtn.addEventListener('click', async () => {
      await handleSyncButtonClick();
    });
  }

  // Offline ZIP Download button
  const zipBtn = document.getElementById('download-zip-btn');
  zipBtn.addEventListener('click', async () => {
    zipBtn.classList.add('opacity-50', 'pointer-events-none');
    const originalText = zipBtn.innerHTML;
    zipBtn.innerHTML = `<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i><span>Bundling...</span>`;
    if (window.lucide) lucide.createIcons();

    try {
      const res = await fetch('/api/export-zip', { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('ZIP bundling failed');

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Paattukoottam_Stage_Tracks_${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      showToast('✓ Offline ZIP downloaded successfully!');
    } catch (err) {
      showToast(`Could not export offline tracks: ${err.message}`, 'error');
    } finally {
      zipBtn.innerHTML = originalText;
      zipBtn.classList.remove('opacity-50', 'pointer-events-none');
      if (window.lucide) lucide.createIcons();
    }
  });
}

async function handleSyncButtonClick() {
  const refreshBtn = document.getElementById('refresh-queue-btn');
  const icon = document.getElementById('refresh-icon');
  refreshBtn.classList.add('opacity-50', 'pointer-events-none');
  if (icon) icon.classList.add('animate-spin');

  try {
    if (isSequenceDirty) {
      // Operator has uncommitted sequence order changes: push them now!
      const pushRes = await fetch('/api/push-sequence', {
        method: 'POST',
        headers: getAuthHeaders()
      });
      if (!pushRes.ok) throw new Error('Failed to push sequence to Google Sheet');
      const pushData = await pushRes.json();
      lastSyncedAt = pushData.last_synced_at;
      setDirtyState(false);
      showToast(`✓ Successfully synced ${pushData.synced_count} acts to Google Sheet & renamed Drive tracks!`);
    } else {
      // Normal refresh from Google Sheet
      const syncRes = await fetch('/api/sync', { method: 'POST', headers: getAuthHeaders() });
      if (syncRes.ok) {
        const syncData = await syncRes.json();
        lastSyncedAt = syncData.last_synced_at;
      }
    }
  } catch (e) {
    console.warn("Sync error:", e);
    showToast(`Sync failed: ${e.message}`, 'error');
  }

  await loadQueue(false);
  refreshBtn.classList.remove('opacity-50', 'pointer-events-none');
  if (icon) icon.classList.remove('animate-spin');
}

function setDirtyState(dirty) {
  isSequenceDirty = dirty;
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
      refreshBtn.title = "Local stage sequence is modified! Click to push to Google Sheet and rename Drive files.";
      const span = refreshBtn.querySelector('span');
      if (span) span.textContent = "Sync to Sheet";
    } else {
      // Normal Orange state
      refreshBtn.className = "px-3 py-1.5 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-bold text-xs shadow-md shadow-orange-500/20 flex items-center gap-1.5 transition active:scale-95 border border-orange-400/40";
      refreshBtn.title = "Refresh latest data from Google Sheet & Drive";
      const span = refreshBtn.querySelector('span');
      if (span) span.textContent = "Refresh Data";
    }
  }

  updateSyncStatusBadge();
  if (window.lucide) lucide.createIcons();
}

function updateSyncStatusBadge() {
  const syncBadge = document.getElementById('sync-status-indicator');
  const syncText = document.getElementById('sync-status-text');
  if (!syncBadge || !syncText) return;

  if (isSequenceDirty) {
    syncBadge.className = 'flex items-center gap-1.5 text-xs text-amber-300 font-medium px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/30';
    syncBadge.title = 'Local sequence has unsaved edits';
    syncText.textContent = 'Unsynced Edits';
    const dot = syncBadge.querySelector('span:first-child');
    if (dot) dot.className = 'w-2 h-2 rounded-full bg-amber-400 animate-ping';
  } else {
    syncBadge.className = 'flex items-center gap-1.5 text-xs text-emerald-400 font-medium px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20';
    const ago = formatTimeAgo(lastSyncedAt);
    syncText.textContent = `● Synced ${ago}`;
    if (lastSyncedAt) {
      syncBadge.title = `Last synchronized with Google Sheet: ${new Date(lastSyncedAt).toLocaleString()}`;
    }
    const dot = syncBadge.querySelector('span:first-child');
    if (dot) dot.className = 'w-2 h-2 rounded-full bg-emerald-500 animate-pulse';
  }
}

function formatTimeAgo(isoString) {
  if (!isoString) return 'Just now';
  const date = new Date(isoString);
  const now = new Date();
  const diffSec = Math.floor((now - date) / 1000);
  if (diffSec < 15) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  return `${diffHr}h ago`;
}

function formatTime(seconds) {
  if (isNaN(seconds) || seconds === 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[m]);
}
