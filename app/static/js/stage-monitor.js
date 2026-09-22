/**
 * Stage Confidence Monitor
 * Communicates with the sound console in real-time over native BroadcastChannel.
 * Receives sync events (CUE, PLAY, PAUSE, SEEK, UNCUE, SYNC) with zero audio output.
 */

document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) {
    window.lucide.createIcons();
  }

  const videoContainer = document.getElementById('video-container');
  const stageVideo = document.getElementById('stage-video');
  const standbyCard = document.getElementById('standby-card');
  const stagePerformer = document.getElementById('stage-performer-name');
  const stageSong = document.getElementById('stage-song-title');
  const stageActType = document.getElementById('stage-act-type');
  const standbyBadge = document.getElementById('standby-badge');
  const cuedSummary = document.getElementById('cued-track-summary');
  const timeDisplay = document.getElementById('time-display');
  const fullscreenBtn = document.getElementById('fullscreen-btn');
  const fullscreenIcon = document.getElementById('fullscreen-icon');
  const syncStatusIndicator = document.getElementById('sync-status-indicator');
  const syncStatusText = document.getElementById('sync-status-text');

  // Hard-enforce muting at all times to prevent stage HDMI audio hijack
  stageVideo.muted = true;
  stageVideo.volume = 0;

  let currentEntryId = null;
  let currentMediaType = null;
  let lastSyncTime = Date.now();

  function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  // Setup BroadcastChannel communication
  let channel = null;
  try {
    channel = new BroadcastChannel('stage_monitor_channel');
    channel.onmessage = handleBroadcastMessage;
  } catch (e) {
    console.error('BroadcastChannel unsupported or blocked:', e);
    syncStatusText.textContent = 'Sync Unsupported';
    syncStatusIndicator.className = 'flex items-center gap-2 px-3 py-1 rounded-full bg-rose-500/20 border border-rose-500/30 text-xs font-semibold text-rose-400';
  }

  function handleBroadcastMessage(event) {
    const data = event.data;
    if (!data || !data.type) return;

    lastSyncTime = Date.now();
    updateConnectionStatus(true);

    switch (data.type) {
      case 'CUE':
        handleCue(data);
        break;
      case 'PLAY':
        handlePlay(data);
        break;
      case 'PAUSE':
        handlePause(data);
        break;
      case 'SEEK':
        handleSeek(data);
        break;
      case 'UNCUE':
        handleUncue();
        break;
      case 'SYNC':
        handleSync(data);
        break;
    }
  }

  function handleCue(data) {
    currentEntryId = data.entryId;
    currentMediaType = data.mediaType;

    const performerText = data.performerName + (data.partnerName ? ` & ${data.partnerName}` : '');
    const songText = data.songTitle || 'Performance';

    stagePerformer.textContent = performerText;
    stageSong.textContent = songText;
    cuedSummary.textContent = `${performerText} - ${songText}`;

    if (data.mediaType === 'video' && data.streamUrl) {
      // Switch to video mode
      standbyCard.classList.add('hidden');
      videoContainer.classList.remove('hidden');

      if (stageVideo.src !== data.streamUrl && !stageVideo.src.endsWith(data.streamUrl)) {
        stageVideo.src = data.streamUrl;
        stageVideo.load();
      }

      if (typeof data.currentTime === 'number') {
        stageVideo.currentTime = data.currentTime;
      }

      if (data.isPlaying) {
        stageVideo.play().catch(e => console.warn('Video auto-play prevented:', e));
      } else {
        stageVideo.pause();
      }
    } else {
      // Audio or acoustic mode: Show presentation card
      videoContainer.classList.add('hidden');
      standbyCard.classList.remove('hidden');
      stageVideo.pause();
      stageVideo.src = '';

      standbyBadge.textContent = 'Live on Stage';
      stageActType.textContent = data.mediaType === 'acoustic' ? 'Acoustic / Live Instruments' : 'Audio Track Playing';
    }

    if (data.currentTime !== undefined) {
      timeDisplay.textContent = formatTime(data.currentTime);
    }
  }

  function handlePlay(data) {
    if (data.currentTime !== undefined) {
      timeDisplay.textContent = formatTime(data.currentTime);
    }

    if (currentMediaType === 'video') {
      if (typeof data.currentTime === 'number' && Math.abs(stageVideo.currentTime - data.currentTime) > 0.3) {
        stageVideo.currentTime = data.currentTime;
      }
      stageVideo.play().catch(e => console.warn('Video play blocked:', e));
    }
  }

  function handlePause(data) {
    if (data.currentTime !== undefined) {
      timeDisplay.textContent = formatTime(data.currentTime);
    }

    if (currentMediaType === 'video') {
      stageVideo.pause();
      if (typeof data.currentTime === 'number' && Math.abs(stageVideo.currentTime - data.currentTime) > 0.2) {
        stageVideo.currentTime = data.currentTime;
      }
    }
  }

  function handleSeek(data) {
    if (typeof data.currentTime === 'number') {
      timeDisplay.textContent = formatTime(data.currentTime);
      if (currentMediaType === 'video') {
        stageVideo.currentTime = data.currentTime;
      }
    }
  }

  function handleSync(data) {
    if (!currentEntryId && data.entryId) {
      handleCue(data);
      return;
    }

    if (typeof data.currentTime === 'number') {
      timeDisplay.textContent = formatTime(data.currentTime);

      if (currentMediaType === 'video') {
        const drift = Math.abs(stageVideo.currentTime - data.currentTime);
        if (drift > 0.4) {
          stageVideo.currentTime = data.currentTime;
        }

        if (data.isPlaying && stageVideo.paused) {
          stageVideo.play().catch(() => {});
        } else if (!data.isPlaying && !stageVideo.paused) {
          stageVideo.pause();
        }
      }
    }
  }

  function handleUncue() {
    currentEntryId = null;
    currentMediaType = null;

    videoContainer.classList.add('hidden');
    standbyCard.classList.remove('hidden');

    stageVideo.pause();
    stageVideo.src = '';

    standbyBadge.textContent = 'Stage Confidence Monitor';
    stagePerformer.textContent = 'EMA Paattukoottam';
    stageSong.textContent = 'Live Music & Stage Program';
    stageActType.textContent = 'Ready for Next Act';
    cuedSummary.textContent = 'Standing by...';
    timeDisplay.textContent = '0:00';
  }

  function updateConnectionStatus(isConnected) {
    if (isConnected) {
      syncStatusText.textContent = 'Connected to Console';
      syncStatusIndicator.className = 'flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-xs font-semibold text-emerald-400';
    } else {
      syncStatusText.textContent = 'Waiting for Console...';
      syncStatusIndicator.className = 'flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-500/30 text-xs font-semibold text-amber-400';
    }
  }

  // Periodic liveness check
  setInterval(() => {
    const isAlive = (Date.now() - lastSyncTime) < 8000;
    updateConnectionStatus(isAlive);
  }, 4000);

  // Request current state from Console upon opening
  if (channel) {
    channel.postMessage({ type: 'REQUEST_STATE' });
  }

  // Fullscreen support
  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        console.warn(`Error attempting to enable fullscreen: ${err.message}`);
      });
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  }

  if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', toggleFullscreen);
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'f' || e.key === 'F') {
      toggleFullscreen();
    }
  });

  document.addEventListener('dblclick', (e) => {
    // Only toggle if not clicking interactive buttons
    if (e.target.closest('button')) return;
    toggleFullscreen();
  });

  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) {
      if (fullscreenIcon) fullscreenIcon.setAttribute('data-lucide', 'minimize-2');
    } else {
      if (fullscreenIcon) fullscreenIcon.setAttribute('data-lucide', 'maximize-2');
    }
    if (window.lucide) window.lucide.createIcons();
  });

  // Fade out control overlays on mouse inactivity
  let idleTimer = null;
  const controlOverlay = document.getElementById('control-overlay');
  const progressOverlay = document.getElementById('progress-overlay');

  function resetIdleTimer() {
    controlOverlay.classList.remove('idle-fade');
    progressOverlay.classList.remove('idle-fade');
    document.body.style.cursor = 'default';

    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      controlOverlay.classList.add('idle-fade');
      progressOverlay.classList.add('idle-fade');
      document.body.style.cursor = 'none';
    }, 3500);
  }

  document.addEventListener('mousemove', resetIdleTimer);
  resetIdleTimer();
});
