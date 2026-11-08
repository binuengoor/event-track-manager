import { S, hooks, transport } from "./state.js";
import { fader, setOutputLevel, updatePlayPauseButton, updateTransportUi } from "./audio-engine.js";
import { broadcastStageMonitor, relayLiveSoon } from "./stage-sync.js";

export function updatePlayerBarState() {
  if (!S.currentCuedItem) return;
  const markDoneBtn = document.getElementById('btn-mark-done');
  const holdBtn = document.getElementById('btn-hold-skip');
  const isCuedDone = S.currentCuedItem.performance_status === 'Performed' || S.currentCuedItem.track_status === 'Performed';
  const isCuedSkipped = S.currentCuedItem.performance_status === 'On Hold' || S.currentCuedItem.track_status === 'Skipped';

  if (markDoneBtn) {
    markDoneBtn.disabled = false;
    if (isCuedDone) {
      markDoneBtn.className = 'hold-fill px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs border border-slate-700 flex items-center gap-1.5 transition disabled:opacity-40 disabled:pointer-events-none';
      markDoneBtn.title = 'Undo completed status';
      markDoneBtn.innerHTML = '<i data-lucide="rotate-ccw" class="w-4 h-4"></i><span>Undo</span>';
    } else {
      markDoneBtn.className = 'hold-fill px-3.5 py-2 rounded-xl bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-400 font-semibold text-xs border border-emerald-500/40 flex items-center gap-1.5 transition disabled:opacity-40 disabled:pointer-events-none';
      markDoneBtn.title = 'Hold to mark as performed (hold Enter)';
      markDoneBtn.innerHTML = '<i data-lucide="check-check" class="w-4 h-4"></i><span>Done</span>';
    }
    markDoneBtn.style.setProperty('--hold', 0);
  }

  if (holdBtn) {
    holdBtn.disabled = false;
    if (isCuedSkipped) {
      holdBtn.className = 'px-3 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-semibold text-xs border border-amber-500/50 flex items-center gap-1.5 transition disabled:opacity-40 disabled:pointer-events-none';
      holdBtn.title = 'Return performer to queue';
      holdBtn.innerHTML = '<i data-lucide="play" class="w-4 h-4"></i><span>Re-Queue</span>';
    } else {
      holdBtn.className = 'px-3 py-2 rounded-xl bg-amber-950/60 hover:bg-amber-900/80 text-amber-400 font-semibold text-xs border border-amber-500/40 flex items-center gap-1.5 transition disabled:opacity-40 disabled:pointer-events-none';
      holdBtn.title = 'No-Show / Put On Hold';
      holdBtn.innerHTML = '<i data-lucide="pause-circle" class="w-4 h-4"></i><span>Hold</span>';
    }
  }

  if (window.lucide) lucide.createIcons();
}

export function resetPlayerBar() {
  S.currentCuedItem = null;
  fader.cancel();
  setOutputLevel(1);
  transport.send('UNCUE');
  localStorage.removeItem('paattukoottam_cued_entry_id');

  if (S.currentCuedObjectUrl) {
    URL.revokeObjectURL(S.currentCuedObjectUrl);
    S.currentCuedObjectUrl = null;
  }

  const cuedVaultStatus = document.getElementById('cued-vault-status');
  if (cuedVaultStatus) cuedVaultStatus.classList.add('hidden');

  const playerTitle = document.getElementById('player-title');
  const playerPerformer = document.getElementById('player-performer');
  const playBtn = document.getElementById('btn-play-pause');
  const markDoneBtn = document.getElementById('btn-mark-done');
  const holdBtn = document.getElementById('btn-hold-skip');
  const uncueBtn = document.getElementById('btn-uncue');
  const downloadBtn = document.getElementById('btn-download-cued');
  const playerBadge = document.getElementById('player-badge');
  const placeholder = document.getElementById('waveform-placeholder');

  if (playerTitle) playerTitle.textContent = 'No Track Cued';
  if (playerPerformer) playerPerformer.textContent = 'Tap "Cue Track" on any song to inspect & play';
  if (playerBadge) playerBadge.className = 'w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-slate-400 shrink-0 border border-slate-700';

  const notesBar = document.getElementById('player-notes-bar');
  if (notesBar) notesBar.classList.add('hidden');

  if (playBtn) playBtn.disabled = true;
  if (markDoneBtn) {
    markDoneBtn.disabled = true;
    markDoneBtn.className = 'hold-fill px-3.5 py-2 rounded-xl bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-400 font-semibold text-xs border border-emerald-500/40 flex items-center gap-1.5 transition disabled:opacity-40 disabled:pointer-events-none';
    markDoneBtn.title = 'Hold to mark as performed (hold Enter)';
    markDoneBtn.innerHTML = '<i data-lucide="check-check" class="w-4 h-4"></i><span>Done</span>';
  }
  if (holdBtn) {
    holdBtn.disabled = true;
    holdBtn.className = 'px-3 py-2 rounded-xl bg-amber-950/60 hover:bg-amber-900/80 text-amber-400 font-semibold text-xs border border-amber-500/40 flex items-center gap-1.5 transition disabled:opacity-40 disabled:pointer-events-none';
    holdBtn.title = 'No-Show / Put On Hold';
    holdBtn.innerHTML = '<i data-lucide="pause-circle" class="w-4 h-4"></i><span>Hold</span>';
  }
  if (uncueBtn) uncueBtn.disabled = true;
  if (window.lucide) lucide.createIcons();
  if (downloadBtn) {
    downloadBtn.classList.add('opacity-40', 'pointer-events-none');
    downloadBtn.onclick = null;
  }

  if (S.wavesurfer) {
    try {
      S.wavesurfer.stop();
      S.wavesurfer.empty();
    } catch (e) {}
  }
  S.isPlaying = false;
  updatePlayPauseButton();

  document.getElementById('player-current-time').textContent = '0:00';
  document.getElementById('player-duration').textContent = '0:00';
  if (placeholder) {
    placeholder.textContent = 'Waveform visualizer ready';
    placeholder.classList.remove('hidden');
  }

  const previewContainer = document.getElementById('player-video-preview');
  if (previewContainer) previewContainer.classList.add('hidden');
  const previewVid = document.getElementById('console-preview-video');
  if (previewVid) {
    previewVid.pause();
    previewVid.src = '';
  }
  if (playerBadge) playerBadge.classList.remove('hidden');

  broadcastStageMonitor('UNCUE');
  updateTransportUi();
  relayLiveSoon();

  hooks.renderQueueList();
}

export function updatePlayerBarNotes(notes) {
  const bar = document.getElementById('player-notes-bar');
  const text = document.getElementById('player-notes-text');
  if (!bar || !text) return;
  if (!S.currentCuedItem) {
    bar.classList.add('hidden');
    return;
  }
  bar.classList.remove('hidden');
  if (notes && notes.trim()) {
    text.textContent = `Note: ${notes.trim()}`;
    text.className = 'truncate font-medium text-amber-300 cursor-pointer hover:underline';
  } else {
    text.textContent = '+ Add stage note...';
    text.className = 'truncate italic text-slate-400 cursor-pointer hover:text-amber-300 hover:underline';
  }
}

