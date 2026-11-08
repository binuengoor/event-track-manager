import { S } from "./state.js";
import { updateStageNotes, updateStatus } from "./act-actions.js";
import { fadeOut, togglePlayPause } from "./audio-engine.js";
import { isDoneItem } from "./deck-policy.js";
import { cueNextTrack, handleCueNext, uncueTrack } from "./deck.js";
import { confirmIfPlaying, handleMuteClick } from "./disruption.js";
import { bindHoldButton, createHoldConfirm } from "./hold-confirm.js";
import { updatePlayerBarState } from "./player-bar.js";
import { openStageMonitor } from "./stage-monitor-sync.js";
import { handleSyncButtonClick } from "./sync-order.js";
import { getAuthHeaders, showToast } from "./util.js";
import { cacheAllTracksOffline, clearVaultStorage } from "./vault-ui.js";

export function setupActionButtons() {
  document.getElementById('btn-play-pause').addEventListener('click', togglePlayPause);

  document.getElementById('btn-seek-back').addEventListener('click', () => {
    if (S.wavesurfer) S.wavesurfer.seekTo(Math.max(0, (S.wavesurfer.getCurrentTime() - 5) / S.wavesurfer.getDuration()));
  });

  document.getElementById('btn-seek-fwd').addEventListener('click', () => {
    if (S.wavesurfer) S.wavesurfer.seekTo(Math.min(1, (S.wavesurfer.getCurrentTime() + 5) / S.wavesurfer.getDuration()));
  });

  const muteBtn = document.getElementById('btn-mute');
  if (muteBtn) {
    muteBtn.addEventListener('click', handleMuteClick);
  }

  document.getElementById('btn-cue-next').addEventListener('click', handleCueNext);
  document.getElementById('btn-ondeck-cue').addEventListener('click', handleCueNext);
  document.getElementById('btn-fade').addEventListener('click', () => fadeOut());

  // Done is press-and-hold (about 1 s). Undo, shown once the act is done, stays a click.
  const markDoneBtn = document.getElementById('btn-mark-done');
  const cuedIsDone = () => isDoneItem(S.currentCuedItem);
  const runMarkDone = () => {
    if (!S.currentCuedItem) return;
    const isCuedDone = cuedIsDone();
    const promptMsg = isCuedDone ? 'Restoring track as upcoming' : 'Marking track as completed';
    confirmIfPlaying(promptMsg, async () => {
      const nextStatus = isCuedDone ? 'Upcoming' : 'Performed';
      await updateStatus(S.currentCuedItem.entry_id, nextStatus);
      if (nextStatus === 'Performed') {
        cueNextTrack(false);
      } else {
        updatePlayerBarState();
      }
    });
  };
  bindHoldButton(markDoneBtn, createHoldConfirm({
    onProgress: p => markDoneBtn.style.setProperty('--hold', p),
    onConfirm: () => { if (S.currentCuedItem && !cuedIsDone()) runMarkDone(); },
  }), { enabled: () => Boolean(S.currentCuedItem) && !cuedIsDone() });
  markDoneBtn.addEventListener('click', () => { if (S.currentCuedItem && cuedIsDone()) runMarkDone(); });

  document.getElementById('btn-hold-skip').addEventListener('click', async () => {
    if (S.currentCuedItem) {
      const isCuedSkipped = S.currentCuedItem.performance_status === 'On Hold' || S.currentCuedItem.track_status === 'Skipped';
      const promptMsg = isCuedSkipped ? 'Returning track to upcoming queue' : 'Putting current track on hold';
      confirmIfPlaying(promptMsg, async () => {
        const nextStatus = isCuedSkipped ? 'Upcoming' : 'On Hold';
        await updateStatus(S.currentCuedItem.entry_id, nextStatus);
        if (nextStatus === 'On Hold') {
          cueNextTrack(false);
        } else {
          updatePlayerBarState();
        }
      });
    }
  });

  const uncueBtn = document.getElementById('btn-uncue');
  if (uncueBtn) {
    uncueBtn.addEventListener('click', () => {
      uncueTrack();
    });
  }

  const promptPlayerBarNoteEdit = () => {
    if (!S.currentCuedItem) return;
    const currentNote = (S.currentCuedItem.stage_notes || '').trim();
    let singerText = S.currentCuedItem.performer_name;
    if (S.currentCuedItem.partner_name) singerText = `${S.currentCuedItem.performer_name} & ${S.currentCuedItem.partner_name}`;
    const newNote = prompt(`Stage note / additional info for "${singerText} - ${S.currentCuedItem.song_title}":\n(Will be shown live on stage screen. Leave blank to clear.)`, currentNote);
    if (newNote !== null) {
      updateStageNotes(S.currentCuedItem.entry_id, newNote);
    }
  };

  const notesText = document.getElementById('player-notes-text');
  if (notesText) notesText.addEventListener('click', promptPlayerBarNoteEdit);

  const notesEditBtn = document.getElementById('player-notes-edit-btn');
  if (notesEditBtn) notesEditBtn.addEventListener('click', promptPlayerBarNoteEdit);


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

  // Cache All Offline button
  const cacheAllBtn = document.getElementById('cache-all-btn');
  if (cacheAllBtn) {
    cacheAllBtn.addEventListener('click', async () => {
      await cacheAllTracksOffline();
    });
  }

  // Clear Local Vault Cache button
  const clearVaultBtn = document.getElementById('clear-vault-btn');
  if (clearVaultBtn) {
    clearVaultBtn.addEventListener('click', async () => {
      await clearVaultStorage();
    });
  }

  // Offline ZIP Download button
  const zipBtn = document.getElementById('download-zip-btn');
  if (zipBtn) {
    zipBtn.addEventListener('click', async () => {
      zipBtn.classList.add('opacity-50', 'pointer-events-none');
      const originalText = zipBtn.innerHTML;
      zipBtn.innerHTML = `<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i><span>Bundling...</span>`;
      if (window.lucide) lucide.createIcons();

      try {
        const res = await fetch(`/api/admin/export-tracks-zip`, {
          headers: getAuthHeaders()
        });
        if (!res.ok) throw new Error('ZIP bundling failed');

        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;

        const disp = res.headers.get('Content-Disposition');
        let filename = `Stage_Tracks_${Date.now()}.zip`;
        if (disp && disp.includes('filename=')) {
          filename = disp.split('filename=')[1].replace(/["']/g, '').trim();
        }

        a.download = filename;
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

  // Pop-out Stage Confidence Monitor buttons
  const openStageMonitorBtn = document.getElementById('open-stage-monitor-btn');
  if (openStageMonitorBtn) {
    openStageMonitorBtn.addEventListener('click', openStageMonitor);
  }
}

