// EMA Paattukoottam Stage Playback Console
let queue = [];
let currentCuedItem = null;
let wavesurfer = null;
let isPlaying = false;
let userAdminPin = localStorage.getItem('paattukoottam_pin') || '';

document.addEventListener('DOMContentLoaded', async () => {
  setupAuth();
  initWaveSurfer();
  setupKeyboardHotkeys();
  setupActionButtons();

  if (userAdminPin) {
    await testAuthAndLoad();
  } else {
    showAuthModal();
  }
});

function getAuthHeaders() {
  const headers = {};
  if (userAdminPin) {
    headers['X-Admin-PIN'] = userAdminPin;
  }
  return headers;
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

async function loadQueue() {
  const container = document.getElementById('queue-container');
  const statsSummary = document.getElementById('stats-summary');
  const countPill = document.getElementById('queue-count-pill');

  try {
    const res = await fetch('/api/stage-queue', { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to fetch stage queue');
    queue = await res.json();

    const total = queue.length;
    const uploaded = queue.filter(q => q.track_status === 'Uploaded').length;
    const acoustic = queue.filter(q => q.track_status === 'Acoustic').length;
    const pending = queue.filter(q => q.track_status === 'Pending').length;
    const performed = queue.filter(q => q.track_status === 'Performed').length;
    const skipped = queue.filter(q => q.track_status === 'Skipped').length;

    statsSummary.textContent = `${total} items sequenced • ${uploaded} ready • ${skipped} on hold • ${pending} pending track • ${performed} done`;
    countPill.textContent = `${performed}/${total} completed`;

    renderQueueList();
  } catch (err) {
    container.innerHTML = `<div class="p-8 text-center text-rose-400 text-sm">Failed to load stage queue: ${err.message}</div>`;
  }
}

function renderQueueList() {
  const container = document.getElementById('queue-container');
  if (queue.length === 0) {
    container.innerHTML = `<div class="p-8 text-center text-slate-500 text-sm">No performances sequenced in Google Sheet yet.</div>`;
    return;
  }

  container.innerHTML = '';
  queue.forEach((item) => {
    const isCued = currentCuedItem && currentCuedItem.entry_id === item.entry_id;
    const isDone = item.track_status === 'Performed';
    const isSkipped = item.track_status === 'Skipped';
    const isAcoustic = item.track_status === 'Acoustic';
    const isUploaded = item.track_status === 'Uploaded';

    const row = document.createElement('div');
    row.id = `queue-row-${item.entry_id}`;
    row.className = `p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition border-l-4 ${
      isCued
        ? 'cued-active bg-orange-500/10 border-orange-500'
        : isDone
        ? 'opacity-60 bg-slate-950/40 border-slate-700'
        : isSkipped
        ? 'bg-amber-950/20 border-amber-500/60'
        : 'bg-slate-900/30 border-transparent hover:bg-slate-800/40'
    }`;

    const seqNum = item.sequence_order !== null ? String(item.sequence_order).padStart(2, '0') : '??';
    
    // Performer & duet formatting
    let performerDisplay = escapeHtml(item.performer_name);
    if (item.partner_name) {
      performerDisplay = `Duet: <span class="text-white font-bold">${escapeHtml(item.performer_name)}</span> & <span class="text-orange-300 font-bold">${escapeHtml(item.partner_name)}</span>`;
    }

    let statusPill = '';
    if (isDone) {
      statusPill = `<span class="px-2.5 py-1 rounded-full text-xs font-medium bg-slate-800 text-slate-400 border border-slate-700 flex items-center gap-1"><i data-lucide="check" class="w-3 h-3"></i> Performed</span>`;
    } else if (isSkipped) {
      statusPill = `<span class="px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/20 text-amber-300 border border-amber-500/50 flex items-center gap-1"><i data-lucide="pause-circle" class="w-3 h-3"></i> On Hold / Skipped</span>`;
    } else if (isUploaded) {
      statusPill = `<span class="px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1"><i data-lucide="music" class="w-3 h-3"></i> Ready</span>`;
    } else if (isAcoustic) {
      statusPill = `<span class="px-2.5 py-1 rounded-full text-xs font-medium bg-sky-500/20 text-sky-300 border border-sky-500/40 flex items-center gap-1"><i data-lucide="guitar" class="w-3 h-3"></i> Acoustic / Live</span>`;
    } else {
      statusPill = `<span class="px-2.5 py-1 rounded-full text-xs font-medium bg-slate-800 text-amber-300 border border-amber-500/30 flex items-center gap-1"><i data-lucide="clock" class="w-3 h-3"></i> Pending</span>`;
    }

    const durationInfo = item.duration ? `<span class="text-[11px] font-mono text-slate-400 ml-1">(${item.duration})</span>` : '';

    row.innerHTML = `
      <div class="flex items-start sm:items-center gap-3.5">
        <div class="w-10 h-10 rounded-xl ${isCued ? 'bg-orange-500 text-white' : 'bg-slate-800 text-slate-300'} flex items-center justify-center font-mono font-bold text-sm shrink-0 border border-slate-700 shadow">
          #${seqNum}
        </div>
        <div>
          <div class="flex items-center gap-2 flex-wrap">
            <h3 class="font-bold text-base text-white ${isDone ? 'line-through text-slate-400' : ''}">
              ${performerDisplay}
            </h3>
            <span class="text-[11px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-medium border border-slate-700">
              ${escapeHtml(item.performance_type)}
            </span>
          </div>
          <p class="text-xs text-orange-400 font-medium mt-0.5 ${isDone ? 'line-through text-slate-500' : ''}">
            "${escapeHtml(item.song_title)}" ${durationInfo}
          </p>
        </div>
      </div>

      <div class="flex items-center gap-2 self-end sm:self-center shrink-0 flex-wrap justify-end">
        ${statusPill}

        <!-- Cue Button (Loads track to player view without autoplaying) -->
        <button class="btn-cue-row px-3 py-1.5 rounded-xl font-semibold text-xs transition flex items-center gap-1.5 ${
          isUploaded || item.drive_file_id
            ? (isCued ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/30' : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700')
            : 'bg-slate-800/50 text-slate-600 cursor-not-allowed border border-slate-800'
        }" ${isUploaded || item.drive_file_id ? '' : 'disabled'}>
          <i data-lucide="${isCued ? 'disc' : 'disc-3'}" class="w-3.5 h-3.5 ${isCued && isPlaying ? 'animate-spin' : ''}"></i>
          <span>${isCued ? 'Cued' : 'Cue Track'}</span>
        </button>

        <!-- Skip / Hold Button (for no-shows) -->
        ${!isDone ? `
        <button class="btn-hold-row px-2.5 py-1.5 rounded-xl font-medium text-xs border transition flex items-center gap-1 ${
          isSkipped
            ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border-amber-500/40'
            : 'bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-amber-300 border-slate-800'
        }">
          <i data-lucide="${isSkipped ? 'play' : 'pause-circle'}" class="w-3.5 h-3.5"></i>
          <span>${isSkipped ? 'Re-Queue' : 'Hold'}</span>
        </button>
        ` : ''}

        <!-- Done / Undo Toggle Button -->
        <button class="btn-done-row px-3 py-1.5 rounded-xl font-medium text-xs border transition flex items-center gap-1 ${
          isDone
            ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
            : 'bg-slate-900 hover:bg-emerald-950/60 text-emerald-400 hover:text-emerald-300 border-slate-800 hover:border-emerald-500/40'
        }">
          <i data-lucide="${isDone ? 'rotate-ccw' : 'check'}" class="w-3.5 h-3.5"></i>
          <span>${isDone ? 'Undo' : 'Done'}</span>
        </button>
      </div>
    `;

    // Row handlers
    row.querySelector('.btn-cue-row').addEventListener('click', () => {
      cueTrack(item, false); // Just load to player view, NO autoplay
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

    container.appendChild(row);
  });

  if (window.lucide) lucide.createIcons();
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
  const playerBadge = document.getElementById('player-badge');

  playerTitle.textContent = item.song_title;
  let singerText = item.performer_name;
  if (item.partner_name) singerText = `Duet: ${item.performer_name} & ${item.partner_name}`;
  playerPerformer.textContent = `#${String(item.sequence_order || 0).padStart(2, '0')} • ${singerText}`;

  playerBadge.className = 'w-10 h-10 rounded-xl bg-orange-500/20 text-orange-400 flex items-center justify-center shrink-0 border border-orange-500/40';

  playBtn.disabled = false;
  markDoneBtn.disabled = false;
  holdBtn.disabled = false;

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

function cueNextTrack(autoPlay = false) {
  if (queue.length === 0) return;

  let currentIndex = -1;
  if (currentCuedItem) {
    currentIndex = queue.findIndex(q => q.entry_id === currentCuedItem.entry_id);
  }

  // Find the next track that is not yet marked performed and not skipped
  for (let i = currentIndex + 1; i < queue.length; i++) {
    if (queue[i].track_status !== 'Performed' && queue[i].track_status !== 'Skipped' && (queue[i].track_status === 'Uploaded' || queue[i].drive_file_id)) {
      cueTrack(queue[i], autoPlay);
      return;
    }
  }

  // Fallback to absolute next item
  if (currentIndex + 1 < queue.length) {
    cueTrack(queue[currentIndex + 1], autoPlay);
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

    renderQueueList();

    const total = queue.length;
    const performed = queue.filter(q => q.track_status === 'Performed').length;
    document.getElementById('queue-count-pill').textContent = `${performed}/${total} completed`;
  } catch (err) {
    alert(`Could not update status: ${err.message}`);
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

  // Sync Sheet button
  const refreshBtn = document.getElementById('refresh-queue-btn');
  refreshBtn.addEventListener('click', async () => {
    refreshBtn.classList.add('opacity-50', 'pointer-events-none');
    await loadQueue();
    refreshBtn.classList.remove('opacity-50', 'pointer-events-none');
  });

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
    } catch (err) {
      alert(`Could not export offline tracks: ${err.message}`);
    } finally {
      zipBtn.innerHTML = originalText;
      zipBtn.classList.remove('opacity-50', 'pointer-events-none');
      if (window.lucide) lucide.createIcons();
    }
  });
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
