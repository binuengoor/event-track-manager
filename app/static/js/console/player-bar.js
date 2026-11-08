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
      markDoneBtn.className = 'c-tbtn c-tbtn--done hold-fill is-undo';
      markDoneBtn.title = 'Undo completed status';
      markDoneBtn.innerHTML = '<i data-lucide="rotate-ccw"></i><span class="c-done__text"><span>Undo</span></span>';
    } else {
      markDoneBtn.className = 'c-tbtn c-tbtn--done hold-fill';
      markDoneBtn.title = 'Hold to mark as performed (hold Enter)';
      markDoneBtn.innerHTML = '<span class="c-ring" aria-hidden="true"></span><span class="c-done__text"><span>Done</span><kbd>Hold Enter</kbd></span>';
    }
    markDoneBtn.style.setProperty('--hold', 0);
  }

  if (holdBtn) {
    holdBtn.disabled = false;
    if (isCuedSkipped) {
      holdBtn.className = 'c-sbtn c-sbtn--warn is-on';
      holdBtn.title = 'Return performer to queue';
      holdBtn.innerHTML = '<i data-lucide="play"></i><span>Re-Queue</span>';
    } else {
      holdBtn.className = 'c-sbtn c-sbtn--warn';
      holdBtn.title = 'No-Show / Put On Hold';
      holdBtn.innerHTML = '<i data-lucide="pause-circle"></i><span>Hold</span>';
    }
  }

  if (window.lucide) lucide.createIcons();
}

const EYEBROW = { IDLE: 'No act cued', CUED: 'Cued', PLAYING: 'Playing', PAUSED: 'Paused', FADING: 'Fading out', ENDED: 'Ended' };

// Mirror the transport state onto the panel: eyebrow, theme hooks and the current row's tag.
export function updateNowState() {
  const panel = document.getElementById('player-bar');
  const eyebrow = document.getElementById('player-eyebrow');
  const state = transport.state || 'IDLE';
  if (panel && panel.dataset) panel.dataset.transport = state.toLowerCase();
  const item = S.currentCuedItem;
  const num = item && item.sequence_order != null ? ` \u00b7 ${String(item.sequence_order).padStart(2, '0')}` : '';
  if (eyebrow) eyebrow.textContent = `${EYEBROW[state] || ''}${item ? num : ''}`;
  const live = state === 'PLAYING' || state === 'FADING';
  const row = document.querySelector('.c-row.is-cued');
  if (row) {
    row.classList.toggle('is-playing', live);
    const tag = row.querySelector('.c-row__tag');
    if (tag) tag.textContent = live ? 'Playing' : 'Cued';
  }
}
hooks.updateNowState = updateNowState;

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
  if (playerPerformer) playerPerformer.textContent = 'Pick an act in the running order to cue it';
  if (playerBadge) playerBadge.className = 'c-now__badge';

  const notesBar = document.getElementById('player-notes-bar');
  if (notesBar) notesBar.classList.add('hidden');

  if (playBtn) playBtn.disabled = true;
  if (markDoneBtn) {
    markDoneBtn.disabled = true;
    markDoneBtn.className = 'c-tbtn c-tbtn--done hold-fill';
    markDoneBtn.title = 'Hold to mark as performed (hold Enter)';
    markDoneBtn.innerHTML = '<span class="c-ring" aria-hidden="true"></span><span class="c-done__text"><span>Done</span><kbd>Hold Enter</kbd></span>';
  }
  if (holdBtn) {
    holdBtn.disabled = true;
    holdBtn.className = 'c-sbtn c-sbtn--warn';
    holdBtn.title = 'No-Show / Put On Hold';
    holdBtn.innerHTML = '<i data-lucide="pause-circle"></i><span>Hold</span>';
  }
  if (uncueBtn) uncueBtn.disabled = true;
  if (window.lucide) lucide.createIcons();
  if (downloadBtn) {
    downloadBtn.classList.add('is-busy');
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
  updateNowState();
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
    text.textContent = notes.trim();
    text.title = notes.trim();
    text.className = 'c-note__text';
  } else {
    text.textContent = 'No note yet';
    text.className = 'c-note__text is-empty';
  }
}

