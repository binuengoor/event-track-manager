import { S } from "./state.js";
import { fadeOut, togglePlayPause } from "./audio-engine.js";
import { handleCueNext } from "./deck.js";
import { handleMuteClick } from "./disruption.js";

export function setupKeyboardHotkeys() {
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!document.getElementById('auth-modal').classList.contains('hidden')) return;

    if (e.code === 'Space') {
      e.preventDefault();
      togglePlayPause();
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault();
      if (S.wavesurfer) S.wavesurfer.seekTo(Math.max(0, (S.wavesurfer.getCurrentTime() - 5) / S.wavesurfer.getDuration()));
    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      if (S.wavesurfer) S.wavesurfer.seekTo(Math.min(1, (S.wavesurfer.getCurrentTime() + 5) / S.wavesurfer.getDuration()));
    } else if (e.code === 'KeyM') {
      e.preventDefault();
      handleMuteClick();
    } else if (e.code === 'ArrowDown') {
      e.preventDefault();
      handleCueNext();
    } else if (e.code === 'KeyF') {
      e.preventDefault();
      fadeOut();
    }
    // No bare Enter hotkey: Done is hold-to-confirm on its own button.
  });
}

