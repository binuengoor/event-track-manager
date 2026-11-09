import { S, hooks, trackGains, transport } from "./state.js";
import { FADE_MS, createFader, createGainStage } from "./fade.js";
import { applySink, listOutputs, rememberSink, rememberedSink, sinkSupported } from "./output-device.js";
import { broadcastStageMonitor } from "./stage-sync.js";
import { escapeHtml, showToast, updatePlayerTimeReadouts } from "./util.js";

export function syncConsolePreviewVideo(play) {
  const previewVid = document.getElementById('console-preview-video');
  if (!previewVid) return;
  previewVid.muted = true;
  if (play) {
    if (S.wavesurfer && typeof S.wavesurfer.getCurrentTime === 'function') {
      previewVid.currentTime = S.wavesurfer.getCurrentTime();
    }
    previewVid.play().catch(() => {});
  } else {
    previewVid.pause();
    if (S.wavesurfer && typeof S.wavesurfer.getCurrentTime === 'function') {
      previewVid.currentTime = S.wavesurfer.getCurrentTime();
    }
  }
}

// Read a design token for the canvas waveform (CSS variables cannot reach a canvas).
function token(name, fallback) {
  try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback; } catch (e) { return fallback; }
}

export function initWaveSurfer() {
  const container = document.getElementById('player-waveform');
  if (!container || typeof WaveSurfer === 'undefined') return;

  try {
    S.wavesurfer = WaveSurfer.create({
      container: container,
      waveColor: token('--border-strong', '#3D4554'),
      progressColor: token('--status-playing-fg', '#34D399'),
      cursorColor: token('--text-primary', '#F3F4F6'),
      cursorWidth: 2,
      barWidth: 3,
      barGap: 3,
      barRadius: 2,
      height: 80,
      normalize: true
    });

    let lastBroadcastSyncTime = 0;

    ensureGainStage();

    S.wavesurfer.on('play', () => {
      if (S.gainStage) S.gainStage.resume();
      transport.send('PLAY');
      S.isPlaying = true;
      updatePlayPauseButton();
      broadcastStageMonitor('PLAY');
      syncConsolePreviewVideo(true);
    });

    S.wavesurfer.on('pause', () => {
      if (fader.active) { fader.cancel(); setOutputLevel(1); } // pausing mid-fade keeps the act audible next time
      transport.send('PAUSE');
      S.isPlaying = false;
      updatePlayPauseButton();
      broadcastStageMonitor('PAUSE');
      syncConsolePreviewVideo(false);
    });

    S.wavesurfer.on('seeking', () => {
      broadcastStageMonitor('SEEK');
      const cur = S.wavesurfer.getCurrentTime();
      const previewVid = document.getElementById('console-preview-video');
      if (previewVid) previewVid.currentTime = cur;
    });

    S.wavesurfer.on('timeupdate', (currentTime) => {
      if (!updatePlayerTimeReadouts(currentTime, S.wavesurfer.getDuration(), S.currentCuedItem)) return;
      const previewVid = document.getElementById('console-preview-video');
      if (previewVid && !previewVid.paused && Math.abs(previewVid.currentTime - currentTime) > 0.3) {
        previewVid.currentTime = currentTime;
      }
      const now = Date.now();
      if (now - lastBroadcastSyncTime > 2000) {
        lastBroadcastSyncTime = now;
        broadcastStageMonitor('SYNC');
      }
    });

    S.wavesurfer.on('ready', (duration) => {
      if (!updatePlayerTimeReadouts(S.wavesurfer.getCurrentTime(), duration, S.currentCuedItem, true)) return;
      document.getElementById('waveform-placeholder').classList.add('hidden');
      updateTransportUi();
      broadcastStageMonitor('CUE');
    });

    S.wavesurfer.on('finish', () => {
      transport.send('FINISH');
      S.isPlaying = false;
      updatePlayPauseButton();
      broadcastStageMonitor('PAUSE');
      syncConsolePreviewVideo(false);
    });

  } catch (e) {
    console.warn('WaveSurfer initialization error:', e);
  }
}

export function toggleMute() {
  if (!S.wavesurfer) return;
  try {
    const nextMute = !S.isMuted;
    S.wavesurfer.setMuted(nextMute);
    S.isMuted = nextMute;
    updateMuteButton();
    showToast(S.isMuted ? 'Audio muted' : 'Audio unmuted', S.isMuted ? 'info' : 'success');
  } catch (e) {
    console.warn('Mute error:', e);
  }
}

export function updateMuteButton() {
  const icon = document.getElementById('mute-icon');
  const btn = document.getElementById('btn-mute');
  const label = document.getElementById('mute-label');
  if (!icon || !btn) return;
  if (S.isMuted) {
    icon.setAttribute('data-lucide', 'volume-x');
    btn.className = 'c-tbtn is-muted';
    btn.setAttribute('aria-pressed', 'true');
    if (label) label.textContent = 'Unmute';
    btn.title = 'Unmute Audio [M]';
  } else {
    icon.setAttribute('data-lucide', 'volume-2');
    btn.className = 'c-tbtn';
    btn.setAttribute('aria-pressed', 'false');
    if (label) label.textContent = 'Mute';
    btn.title = 'Mute Audio [M]';
  }
  if (window.lucide) lucide.createIcons();
}

export function updatePlayPauseButton() {
  const playIcon = document.getElementById('play-icon');
  if (!playIcon) return;
  if (S.isPlaying) {
    playIcon.setAttribute('data-lucide', 'pause');
  } else {
    playIcon.setAttribute('data-lucide', 'play');
  }
  const playLabel = document.getElementById('play-label');
  if (playLabel) playLabel.textContent = S.isPlaying ? 'Pause' : 'Play';
  if (window.lucide) lucide.createIcons();
  updateTransportUi(); // keeps Fade out enabled while sound is live (it was left disabled after Play)
}

export function togglePlayPause() {
  if (!S.currentCuedItem || !S.wavesurfer) return;
  if (S.gainStage) S.gainStage.resume();
  S.wavesurfer.playPause();
}

// Fade through the gain stage, then stop. afterDone runs once the fade has finished.
let fadeAfterDone = null;
export function setOutputLevel(v) {
  if (S.gainStage) S.gainStage.setGain(v);
  else if (S.wavesurfer && typeof S.wavesurfer.setVolume === 'function') { try { S.wavesurfer.setVolume(Math.min(1, S.trackBaseGain) * v); } catch (e) {} }
}
// Loudness gain for the cued act; boosts need the gain stage, cuts also work through plain volume.
export function applyTrackGain(entryId) {
  S.trackBaseGain = trackGains.linear(entryId);
  if (S.gainStage) S.gainStage.setBase(S.trackBaseGain);
  else setOutputLevel(1);
}
export const fader = createFader({
  duration: FADE_MS,
  setLevel: v => setOutputLevel(v),
  onDone: () => {
    transport.send('FADE_DONE');
    try { S.wavesurfer.stop(); } catch (e) {}
    setOutputLevel(1);
    S.isPlaying = false;
    updatePlayPauseButton();
    updateTransportUi();
    const cb = fadeAfterDone;
    fadeAfterDone = null;
    if (typeof cb === 'function') cb();
  },
});
export function fadeOut(afterDone = null) {
  if (transport.state !== 'PLAYING' || !S.wavesurfer) return false;
  fadeAfterDone = afterDone;
  transport.send('FADE_START');
  fader.start(1);
  updateTransportUi();
  return true;
}

export function ensureGainStage() {
  if (S.gainStage || !S.wavesurfer || typeof S.wavesurfer.getMediaElement !== 'function') return;
  S.gainStage = createGainStage(S.wavesurfer.getMediaElement());
  if (S.gainStage) S.gainStage.setBase(S.trackBaseGain);
  setupOutputDevice();
}

export async function setupOutputDevice() {
  const wrap = document.getElementById('output-device-wrap');
  const select = document.getElementById('output-device-select');
  const element = S.wavesurfer && S.wavesurfer.getMediaElement ? S.wavesurfer.getMediaElement() : null;
  if (!wrap || !select || !sinkSupported(element, S.gainStage)) return;
  const outputs = await listOutputs();
  if (outputs.length === 0) return;
  select.innerHTML = '<option value="">System default</option>' + outputs.map(o => `<option value="${escapeHtml(o.id)}">${escapeHtml(o.label)}</option>`).join('');
  const saved = rememberedSink();
  if (saved && outputs.some(o => o.id === saved)) {
    select.value = saved;
    applySink(saved, element, S.gainStage).catch(() => {});
  }
  wrap.classList.remove('hidden');
  select.addEventListener('change', async () => {
    try {
      await applySink(select.value, element, S.gainStage);
      rememberSink(select.value);
      showToast('Output device changed');
    } catch (err) {
      showToast(`Could not use that output: ${err.message}`, 'error');
    }
  });
}

export function updateTransportUi() {
  const fadeBtn = document.getElementById('btn-fade');
  if (fadeBtn) {
    fadeBtn.disabled = transport.state !== 'PLAYING';
    const label = fadeBtn.querySelector('span');
    if (label) label.firstChild.textContent = transport.state === 'FADING' ? 'Fading... ' : 'Fade out ';
  }
  const playBtn = document.getElementById('btn-play-pause');
  if (playBtn && S.currentCuedItem && S.currentCuedItem.track_status !== 'Acoustic') playBtn.disabled = transport.state === 'FADING';
  if (hooks.updateNowState) hooks.updateNowState();
}

