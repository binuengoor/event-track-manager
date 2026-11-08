import { S, hooks, transport } from "./state.js";
import { applyTrackGain, updatePlayPauseButton, updateTransportUi } from "./audio-engine.js";
import { resolveCueNext, selectAct } from "./deck-policy.js";
import { confirmIfPlaying } from "./disruption.js";
import { actionReachedServer, beginAction, enqueueOfflineAction } from "./offline-sync.js";
import { resetPlayerBar, updatePlayerBarNotes, updatePlayerBarState } from "./player-bar.js";
import { broadcastStageMonitor, relayLiveSoon } from "./stage-sync.js";
import { getAuthHeaders, showToast } from "./util.js";
import { getCachedTrack, saveCachedTrack } from "./vault-store.js";
import { updateVaultStatusDisplay } from "./vault-ui.js";

export async function uncueTrack() {
  const itemToUncue = S.currentCuedItem;
  const songName = itemToUncue ? itemToUncue.song_title : 'Active Track';

  confirmIfPlaying(`Uncueing "${songName}"`, async () => {
    const action = beginAction();
    if (itemToUncue) {
      const target = S.queue.find(q => q.entry_id === itemToUncue.entry_id);
      if (target && target.performance_status === 'On Stage') {
        target.performance_status = 'Upcoming';
      }
    } else {
      S.queue.forEach(q => {
        if (q.performance_status === 'On Stage') q.performance_status = 'Upcoming';
      });
    }

    localStorage.removeItem('paattukoottam_cued_entry_id');
    resetPlayerBar();

    if (!navigator.onLine) {
      if (!await enqueueOfflineAction('uncue', null, {}, action)) return;
      showToast(`✓ Uncued "${songName}" locally. Live Program restored.`);
      return;
    }

    try {
      const res = await fetch('/api/clear-active', {
        method: 'POST',
        headers: getAuthHeaders()
      });
      if (!res.ok) throw new Error('Failed to uncue track on server');
      actionReachedServer('uncue', null, action);
      relayLiveSoon();
      showToast(`✓ Uncued "${songName}". Live Program restored to countdown.`);
    } catch (err) {
      if (!await enqueueOfflineAction('uncue', null, {}, action)) return;
      showToast(`Uncued locally (network error, will sync when online)`, 'warning');
    }
  });
}

export function cueTrack(item, autoPlay = false, isRestoration = false) {
  if (S.currentCuedItem && S.currentCuedItem.entry_id === item.entry_id) {
    if (autoPlay && S.wavesurfer) S.wavesurfer.play();
    return;
  }

  const applyCue = async () => {
    if (S.onDeckId === item.entry_id) S.onDeckId = null;
    transport.send('CUE');
    S.currentCuedItem = item;
    localStorage.setItem('paattukoottam_cued_entry_id', item.entry_id);

    const playerTitle = document.getElementById('player-title');
    const playerPerformer = document.getElementById('player-performer');
    const playBtn = document.getElementById('btn-play-pause');
    const markDoneBtn = document.getElementById('btn-mark-done');
    const holdBtn = document.getElementById('btn-hold-skip');
    const uncueBtn = document.getElementById('btn-uncue');
    const downloadBtn = document.getElementById('btn-download-cued');
    const playerBadge = document.getElementById('player-badge');
    const cuedVaultStatus = document.getElementById('cued-vault-status');

    if (playerTitle) playerTitle.textContent = item.song_title;
    let singerText = item.performer_name;
    if (item.partner_name) singerText = `Duet: ${item.performer_name} & ${item.partner_name}`;
    if (playerPerformer) playerPerformer.textContent = `#${String(item.sequence_order || 0).padStart(2, '0')} • ${singerText}`;

    updatePlayerBarNotes(item.stage_notes || '');

    const isAcoustic = item.track_status === 'Acoustic';
    const isVideo = (item.media_type === 'video') || (item.track_file && item.track_file.endsWith('.mp4'));

    const previewContainer = document.getElementById('player-video-preview');
    const previewVid = document.getElementById('console-preview-video');

    if (isVideo) {
      if (playerBadge) playerBadge.classList.add('hidden');
      if (previewContainer) previewContainer.classList.remove('hidden');
      if (previewVid) {
        previewVid.muted = true;
        previewVid.src = `/api/stream/${item.entry_id}`;
        previewVid.load();
      }
    } else {
      if (previewContainer) previewContainer.classList.add('hidden');
      if (previewVid) {
        previewVid.pause();
        previewVid.src = '';
      }
      if (playerBadge) {
        playerBadge.classList.remove('hidden');
        if (isAcoustic) {
          playerBadge.className = 'w-10 h-10 rounded-xl bg-sky-500/20 text-sky-400 flex items-center justify-center shrink-0 border border-sky-500/40';
          playerBadge.innerHTML = '<i data-lucide="guitar" class="w-5 h-5"></i>';
        } else {
          playerBadge.className = 'w-10 h-10 rounded-xl bg-orange-500/20 text-orange-400 flex items-center justify-center shrink-0 border border-orange-500/40';
          playerBadge.innerHTML = '<i data-lucide="music-2" class="w-5 h-5"></i>';
        }
      }
    }

    if (playBtn) playBtn.disabled = isAcoustic;
    updatePlayerBarState();
    if (uncueBtn) uncueBtn.disabled = false;

    // Configure 1-Click Track Download for Local Playback
    if (downloadBtn) {
      if (isAcoustic) {
        downloadBtn.classList.add('opacity-40', 'pointer-events-none');
        downloadBtn.onclick = null;
      } else {
        downloadBtn.onclick = async (e) => {
          e.preventDefault();
          if (!S.currentCuedItem) return;

          // Check if already in local Vault
          const cached = await getCachedTrack(S.currentCuedItem.entry_id);
          if (cached && cached.blob) {
            const url = window.URL.createObjectURL(cached.blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${S.currentCuedItem.entry_id}_${S.currentCuedItem.performer_name}_${S.currentCuedItem.song_title}.mp3`.replace(/\s+/g, '_');
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
            showToast('✓ Track exported from local Vault!');
            return;
          }

          downloadBtn.classList.add('opacity-50', 'pointer-events-none');
          showToast('Downloading track...');
          try {
            const res = await fetch(`/api/download-track/${S.currentCuedItem.entry_id}`, {
              headers: getAuthHeaders()
            });
            if (!res.ok) throw new Error('Download failed from server');
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const disp = res.headers.get('Content-Disposition');
            let filename = `${S.currentCuedItem.entry_id}_track.mp3`;
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
    }

    const placeholder = document.getElementById('waveform-placeholder');
    if (isAcoustic) {
      if (cuedVaultStatus) cuedVaultStatus.classList.add('hidden');
      if (placeholder) {
        placeholder.textContent = '🎸 Acoustic Act — Live Instruments / No Backing Track File Needed';
        placeholder.classList.remove('hidden');
      }
      if (S.wavesurfer) {
        try {
          S.wavesurfer.stop();
          S.wavesurfer.empty();
        } catch (e) {}
      }
      document.getElementById('player-current-time').textContent = 'Live';
      document.getElementById('player-duration').textContent = 'Stage';
    } else {
      if (placeholder) {
        placeholder.textContent = 'Loading audio waveform...';
        placeholder.classList.remove('hidden');
      }

      if (cuedVaultStatus) {
        cuedVaultStatus.className = 'mt-0.5 inline-flex items-center gap-1 text-[10px] font-semibold text-amber-400';
        cuedVaultStatus.innerHTML = '<span class="animate-spin text-xs">⚡</span><span>Checking Vault...</span>';
        cuedVaultStatus.classList.remove('hidden');
      }

      let audioSourceUrl = `/api/stream/${item.entry_id}`;
      let isVaultCached = false;

      // 1. Check IndexedDB Audio Vault
      const cached = await getCachedTrack(item.entry_id);
      const isStale = cached && (
        (item.track_version && (cached.track_version || cached.drive_file_id) && (cached.track_version || cached.drive_file_id) !== item.track_version) ||
        (item.last_updated && cached.last_updated && cached.last_updated !== item.last_updated) ||
        (item.song_title && cached.song_title && cached.song_title !== item.song_title)
      );

      if (cached && cached.blob && !isStale) {
        isVaultCached = true;
        if (S.currentCuedObjectUrl) {
          URL.revokeObjectURL(S.currentCuedObjectUrl);
        }
        S.currentCuedObjectUrl = URL.createObjectURL(cached.blob);
        audioSourceUrl = S.currentCuedObjectUrl;

        if (cuedVaultStatus) {
          cuedVaultStatus.className = 'mt-0.5 inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400';
          cuedVaultStatus.innerHTML = '<i data-lucide="shield-check" class="w-3 h-3 text-emerald-400"></i><span>⚡ Cached in Vault (Offline Safe)</span>';
          if (window.lucide) lucide.createIcons();
        }
      } else if (navigator.onLine) {
        // 2. Online & not yet cached or stale: Fetch fresh and store in Vault!
        if (cuedVaultStatus) {
          cuedVaultStatus.className = 'mt-0.5 inline-flex items-center gap-1 text-[10px] font-semibold text-cyan-400 animate-pulse';
          cuedVaultStatus.innerHTML = isStale
            ? '<i data-lucide="refresh-cw" class="w-3 h-3 text-cyan-400 animate-spin"></i><span>Updating stale Vault cache...</span>'
            : '<i data-lucide="hard-drive-download" class="w-3 h-3 text-cyan-400"></i><span>Caching track to Vault...</span>';
          if (window.lucide) lucide.createIcons();
        }

        try {
          const res = await fetch(`/api/stream/${item.entry_id}?t=${Date.now()}`);
          if (res.ok) {
            const blob = await res.blob();
            await saveCachedTrack(item.entry_id, blob, {
              song_title: item.song_title,
              performer_name: item.performer_name,
              track_version: item.track_version,
              last_updated: item.last_updated
            });
            isVaultCached = true;
            if (S.currentCuedObjectUrl) {
              URL.revokeObjectURL(S.currentCuedObjectUrl);
            }
            S.currentCuedObjectUrl = URL.createObjectURL(blob);
            audioSourceUrl = S.currentCuedObjectUrl;
            updateVaultStatusDisplay();

            if (cuedVaultStatus) {
              cuedVaultStatus.className = 'mt-0.5 inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400';
              cuedVaultStatus.innerHTML = '<i data-lucide="shield-check" class="w-3 h-3 text-emerald-400"></i><span>⚡ Cached in Vault (Offline Safe)</span>';
              if (window.lucide) lucide.createIcons();
            }
          }
        } catch (fetchErr) {
          console.warn('Could not cache to Vault on cue:', fetchErr);
        }
      } else {
        // 3. Offline and not cached
        if (cuedVaultStatus) {
          cuedVaultStatus.className = 'mt-0.5 inline-flex items-center gap-1 text-[10px] font-semibold text-rose-400';
          cuedVaultStatus.innerHTML = '<i data-lucide="alert-triangle" class="w-3 h-3 text-rose-400"></i><span>⚠️ Not cached in Vault. Connect to Wi-Fi.</span>';
          if (window.lucide) lucide.createIcons();
        }
        showToast('⚠️ Track was not cached locally and console is offline. Connect to Wi-Fi to load.', 'error');
      }

      if (S.wavesurfer && (isVaultCached || navigator.onLine)) {
        try {
          applyTrackGain(item.entry_id);
          S.wavesurfer.load(audioSourceUrl);
          if (autoPlay) {
            S.wavesurfer.once('ready', () => {
              S.wavesurfer.play();
            });
          }
        } catch (err) {
          console.warn('WaveSurfer load error:', err);
        }
      }
    }

    S.isPlaying = false;
    updatePlayPauseButton();
    updateTransportUi();
    hooks.renderQueueList();
    broadcastStageMonitor('CUE');

    // Notify Live View of currently cued / active performer (skip during page reload restoration)
    if (!isRestoration) {
      const action = beginAction();
      if (navigator.onLine) {
        try {
          const response = await fetch(`/api/set-active/${item.entry_id}`, {
            method: 'POST', headers: getAuthHeaders()
          });
          if (!response.ok) throw new Error('Failed to set active act');
          actionReachedServer('set_active', item.entry_id, action);
          relayLiveSoon();
        } catch (error) {
          await enqueueOfflineAction('set_active', item.entry_id, {}, action);
        }
      } else {
        await enqueueOfflineAction('set_active', item.entry_id, {}, action);
      }
    }
  };

  if (isRestoration) {
    applyCue();
  } else {
    confirmIfPlaying(`Cueing new track "${item.song_title}"`, applyCue);
  }
}

export function cueNextTrack(autoPlay = false) {
  const next = resolveCueNext({ queue: S.queue, currentId: S.currentCuedItem ? S.currentCuedItem.entry_id : null, onDeckId: S.onDeckId });
  if (next) cueTrack(next, autoPlay);
}

// Row click or row Cue: never touches the deck or audio while sound is live.
export function selectRow(item) {
  const result = selectAct({
    transport, item, currentId: S.currentCuedItem ? S.currentCuedItem.entry_id : null,
    loadAct: it => cueTrack(it, false),
    setOnDeck: it => { S.onDeckId = it.entry_id; hooks.renderQueueList(); showToast(`On deck: ${it.song_title}`, 'info'); },
  });
  return result;
}

export function onDeckTarget() {
  if (!S.currentCuedItem && !S.onDeckId) return null;
  return resolveCueNext({ queue: S.queue, currentId: S.currentCuedItem ? S.currentCuedItem.entry_id : null, onDeckId: S.onDeckId });
}

export function renderOnDeck() {
  const strip = document.getElementById('on-deck-strip');
  if (!strip) return;
  const target = onDeckTarget();
  if (!target) { strip.classList.add('hidden'); return; }
  strip.classList.remove('hidden');
  const who = target.partner_name ? `${target.performer_name} & ${target.partner_name}` : target.performer_name;
  document.getElementById('on-deck-text').textContent = ` ${String(target.sequence_order || 0).padStart(2, '0')} \u00b7 ${target.song_title} \u00b7 ${who}`;
  const note = (target.stage_notes || '').trim();
  document.getElementById('on-deck-note').textContent = note ? ` \u00b7 Note: ${note}` : '';
}

export function handleCueNext() {
  confirmIfPlaying('Cueing the on-deck act', () => cueNextTrack(false));
}

