import { S, hooks, isAudioPlaying, transport } from "./state.js";
import { fadeOut, fader, setOutputLevel, toggleMute, updatePlayPauseButton } from "./audio-engine.js";
import { escapeHtml } from "./util.js";

export function handleMuteClick() {
  if (S.isMuted) {
    toggleMute();
  } else {
    confirmIfPlaying('Muting live stage audio', () => {
      toggleMute();
    });
  }
}

let disruptionPendingCallback = null;

export function confirmIfPlaying(actionDescription, onProceed) {
  if (!isAudioPlaying()) {
    onProceed();
    return;
  }

  const modal = document.getElementById('disruption-modal');
  const msgEl = document.getElementById('disruption-modal-msg');
  if (msgEl) {
    msgEl.innerHTML = `A track is currently playing live on stage.<br><strong class="c-warn-text">${escapeHtml(actionDescription)}</strong> will stop or silence the music.`;
  }

  disruptionPendingCallback = onProceed;
  if (modal) modal.classList.remove('hidden');
}

export function setupDisruptionModal() {
  const modal = document.getElementById('disruption-modal');
  const cancelBtn = document.getElementById('disruption-cancel-btn');
  const confirmBtn = document.getElementById('disruption-confirm-btn');

  const fadeBtn = document.getElementById('disruption-fade-btn');
  if (fadeBtn) {
    fadeBtn.addEventListener('click', () => {
      if (modal) modal.classList.add('hidden');
      const cb = disruptionPendingCallback;
      disruptionPendingCallback = null;
      if (transport.state === 'PLAYING' || transport.state === 'FADING') {
        fadeOut(() => { if (typeof cb === 'function') cb(); });
      } else if (typeof cb === 'function') {
        cb();
      }
    });
  }

  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      if (modal) modal.classList.add('hidden');
      disruptionPendingCallback = null;
    });
  }

  if (confirmBtn) {
    confirmBtn.addEventListener('click', () => {
      if (modal) modal.classList.add('hidden');
      if (S.wavesurfer && isAudioPlaying()) {
        fader.cancel();
        setOutputLevel(1);
        try { S.wavesurfer.stop(); } catch (e) {}
        transport.send('STOP');
        S.isPlaying = false;
        updatePlayPauseButton();
      }
      if (typeof disruptionPendingCallback === 'function') {
        const cb = disruptionPendingCallback;
        disruptionPendingCallback = null;
        cb();
      }
    });
  }

  // Intercept navigation links
  document.querySelectorAll('header a[href]').forEach(link => {
    link.addEventListener('click', (e) => {
      if (isAudioPlaying()) {
        e.preventDefault();
        const targetHref = link.getAttribute('href');
        confirmIfPlaying('Leaving this console page', () => {
          window.location.href = targetHref;
        });
      }
    });
  });

  // Browser reload / tab close guard
  window.addEventListener('beforeunload', (e) => {
    if (isAudioPlaying()) {
      e.preventDefault();
      e.returnValue = 'Audio is currently playing live on stage. Are you sure you want to leave?';
      return e.returnValue;
    }
  });
}

