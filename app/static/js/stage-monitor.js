/**
 * Stage Confidence Monitor
 * Communicates with the sound console over BroadcastChannel `stage_monitor_channel`.
 * Messages: CUE, PLAY, PAUSE, SEEK, UNCUE, SYNC (transport), ANNOUNCEMENT, FADE_BLACK, LYRICS.
 * Video is always muted. Late open: the page asks the console for state (REQUEST_STATE).
 */

document.addEventListener('DOMContentLoaded', () => {
  const L = window.EtmLive;
  const $ = (id) => document.getElementById(id);

  const videoContainer = $('video-container');
  const stageVideo = $('stage-video');
  const standbyCard = $('standby-card');
  const stagePerformer = $('stage-performer-name');
  const stageSong = $('stage-song-title');
  const stageActType = $('stage-act-type');
  const standbyBadge = $('standby-badge');
  const cuedSummary = $('cued-track-summary');
  const timeDisplay = $('time-display');
  const syncIndicator = $('sync-status-indicator');
  const syncText = $('sync-status-text');
  const announcementEl = $('announcement');
  const lyricsPanel = $('lyrics-panel');
  const lyricsText = $('lyrics-text');
  const disconnectedEl = $('disconnected');
  const blackOverlay = $('black-overlay');
  const blackCorner = $('black-corner');

  // Hard-enforce muting at all times to prevent stage HDMI audio hijack
  stageVideo.muted = true;
  stageVideo.volume = 0;

  const view = { entryId: null, mediaType: null, streamUrl: null, fadeBlack: false, lyrics: '', performer: '' };
  let lastSyncTime = Date.now();
  let connected = false;

  function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  // Render the mutually exclusive layers from the pure mode selector.
  function renderMode() {
    const mode = L.monitorMode(view);
    document.body.dataset.mode = mode;
    standbyCard.dataset.state = view.entryId ? 'name' : 'standby';
    blackOverlay.classList.toggle('hidden', mode !== 'black');
    blackCorner.textContent = view.performer ? `On stage: ${view.performer}` : '';
    lyricsPanel.classList.toggle('hidden', mode !== 'lyrics');
    // Video keeps running underneath the black fade and lyrics layers.
    const showVideo = Boolean(view.entryId && view.mediaType === 'video' && view.streamUrl);
    videoContainer.classList.toggle('hidden', !showVideo);
    standbyCard.classList.toggle('hidden', showVideo);
  }

  function setAnnouncement(text) {
    const clean = L.cleanAnnouncement(text);
    announcementEl.textContent = clean;
    announcementEl.classList.toggle('hidden', !clean);
  }

  function updateConnectionStatus(isConnected) {
    connected = isConnected;
    disconnectedEl.classList.toggle('hidden', isConnected);
    syncText.textContent = isConnected ? 'Connected to the console' : 'Waiting for the console';
    syncIndicator.className = isConnected ? 'ok' : 'bad';
  }

  let channel = null;
  try {
    channel = new BroadcastChannel('stage_monitor_channel');
    channel.onmessage = handleBroadcastMessage;
  } catch (e) {
    console.error('BroadcastChannel unsupported or blocked:', e);
    syncText.textContent = 'Sync not supported in this browser';
  }

  function handleBroadcastMessage(event) {
    const data = event.data;
    if (!data || !data.type) return;
    if (data.type === 'REQUEST_STATE') return; // another monitor asking the console

    lastSyncTime = Date.now();
    updateConnectionStatus(true);

    switch (data.type) {
      case 'CUE': handleCue(data); break;
      case 'PLAY': handlePlay(data); break;
      case 'PAUSE': handlePause(data); break;
      case 'SEEK': handleSeek(data); break;
      case 'UNCUE': handleUncue(data); break;
      case 'SYNC': handleSync(data); break;
      case 'ANNOUNCEMENT': setAnnouncement(data.text); break;
      case 'FADE_BLACK': view.fadeBlack = Boolean(data.on); renderMode(); break;
      case 'LYRICS':
        view.lyrics = String(data.text == null ? '' : data.text);
        lyricsText.textContent = view.lyrics;
        renderMode();
        break;
    }
  }

  function handleCue(data) {
    view.entryId = data.entryId;
    view.mediaType = data.mediaType;
    view.streamUrl = data.mediaType === 'video' ? data.streamUrl : null;

    const performerText = data.performerName + (data.partnerName ? ` & ${data.partnerName}` : '');
    const songText = data.songTitle || 'Performance';
    view.performer = performerText;

    stagePerformer.textContent = performerText;
    stageSong.textContent = songText;
    cuedSummary.textContent = `${performerText} - ${songText}`;

    if (data.mediaType === 'video' && data.streamUrl) {
      if (stageVideo.src !== data.streamUrl && !stageVideo.src.endsWith(data.streamUrl)) {
        stageVideo.src = data.streamUrl;
        stageVideo.load();
      }
      if (typeof data.currentTime === 'number') stageVideo.currentTime = data.currentTime;
      if (data.isPlaying) stageVideo.play().catch(e => console.warn('Video auto-play prevented:', e));
      else stageVideo.pause();
    } else {
      stageVideo.pause();
      stageVideo.removeAttribute('src');
      stageVideo.load();
      standbyBadge.textContent = 'Now on stage';
      stageActType.textContent = data.mediaType === 'acoustic' ? 'Acoustic / live instruments' : 'Audio track playing';
    }
    if (data.currentTime !== undefined) timeDisplay.textContent = formatTime(data.currentTime);
    renderMode();
  }

  function handlePlay(data) {
    if (data.currentTime !== undefined) timeDisplay.textContent = formatTime(data.currentTime);
    if (view.mediaType === 'video') {
      if (typeof data.currentTime === 'number' && Math.abs(stageVideo.currentTime - data.currentTime) > 0.3) {
        stageVideo.currentTime = data.currentTime;
      }
      stageVideo.play().catch(e => console.warn('Video play blocked:', e));
    }
  }

  function handlePause(data) {
    if (data.currentTime !== undefined) timeDisplay.textContent = formatTime(data.currentTime);
    if (view.mediaType === 'video') {
      stageVideo.pause();
      if (typeof data.currentTime === 'number' && Math.abs(stageVideo.currentTime - data.currentTime) > 0.2) {
        stageVideo.currentTime = data.currentTime;
      }
    }
  }

  function handleSeek(data) {
    if (typeof data.currentTime === 'number') {
      timeDisplay.textContent = formatTime(data.currentTime);
      if (view.mediaType === 'video') stageVideo.currentTime = data.currentTime;
    }
  }

  function handleSync(data) {
    if (!view.entryId && data.entryId) { handleCue(data); return; }
    if (typeof data.currentTime === 'number') {
      timeDisplay.textContent = formatTime(data.currentTime);
      if (view.mediaType === 'video') {
        if (Math.abs(stageVideo.currentTime - data.currentTime) > 0.4) stageVideo.currentTime = data.currentTime;
        if (data.isPlaying && stageVideo.paused) stageVideo.play().catch(() => {});
        else if (!data.isPlaying && !stageVideo.paused) stageVideo.pause();
      }
    }
  }

  function handleUncue(data) {
    view.entryId = null;
    view.mediaType = null;
    view.streamUrl = null;
    view.performer = '';
    stageVideo.pause();
    stageVideo.removeAttribute('src');
    stageVideo.load();
    standbyBadge.textContent = 'Standby';
    stagePerformer.textContent = document.title.split(' - ').pop() || 'Event';
    stageSong.textContent = (data && data.nextPerformer)
      ? `Next: ${data.nextPerformer}${data.nextSong ? ' \u00b7 ' + data.nextSong : ''}`
      : 'Waiting for the next act';
    stageActType.textContent = 'Standing by';
    cuedSummary.textContent = 'Standing by...';
    timeDisplay.textContent = '0:00';
    renderMode();
  }

  // Liveness: the notice shows after 8 s without messages and stays until one arrives.
  setInterval(() => {
    const alive = L.isConnected(lastSyncTime, Date.now(), L.DISCONNECT_MS);
    if (alive !== connected) updateConnectionStatus(alive);
  }, 1000);
  // First 8 s: no notice yet, indicator says Connecting; the tick above flips to the notice.
  connected = true;
  syncText.textContent = 'Connecting...';
  syncIndicator.className = 'bad';

  // Late open: ask the console to replay current state.
  if (channel) channel.postMessage({ type: 'REQUEST_STATE' });

  if (window.EtmWakeLock) window.EtmWakeLock.start();

  // Fullscreen
  const fullscreenBtn = $('fullscreen-btn');
  const fullscreenLabel = $('fullscreen-label');
  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => console.warn(`Fullscreen failed: ${err.message}`));
    } else if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  }
  fullscreenBtn.addEventListener('click', toggleFullscreen);
  document.addEventListener('keydown', (e) => { if (e.key === 'f' || e.key === 'F') toggleFullscreen(); });
  document.addEventListener('dblclick', (e) => { if (!e.target.closest('button')) toggleFullscreen(); });
  document.addEventListener('fullscreenchange', () => {
    fullscreenLabel.textContent = document.fullscreenElement ? 'Exit fullscreen (F)' : 'Fullscreen (F)';
  });

  // Fade control overlays on inactivity (the disconnected notice and announcement never fade)
  let idleTimer = null;
  const controlOverlay = $('control-overlay');
  const progressOverlay = $('progress-overlay');
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
  renderMode();
});
