import { S, reorderLock, screensState } from "./state.js";
import { renderQueueList } from "./queue-render.js";
import { screens } from "./stage-sync.js";
import { idlePusher, updateReorderLockUi } from "./sync-order.js";
import { showToast } from "./util.js";
import { closeSheet, openSheet } from "./vault-ui.js";
import { createWakeLock } from "./wake-lock.js";

export function setupConsoleUpgrades() {
  // Reorder lock
  const lockBtn = document.getElementById('reorder-lock-btn');
  if (lockBtn) {
    lockBtn.addEventListener('click', () => {
      reorderLock.toggle();
      if (reorderLock.locked) idlePusher.flush();
      updateReorderLockUi();
      renderQueueList();
    });
    updateReorderLockUi();
  }

  // Announcement (inline)
  const annInput = document.getElementById('announcement-input');
  const sendAnnouncement = async (text) => {
    const out = await screens.sendAnnouncement(text);
    screensState.announcement = out.text;
    if (annInput) { annInput.value = out.text; delete annInput.dataset.dirty; }
    const state = document.getElementById('announcement-state');
    if (state) state.textContent = out.text ? (out.persisted ? 'Sent to all screens.' : 'Sent to screens in this browser only (could not reach the server).') : 'Cleared.';
    if (!out.persisted) showToast('Announcement was not saved on the server.', 'warning');
  };
  if (annInput) annInput.addEventListener('input', () => { annInput.dataset.dirty = '1'; });
  const annSend = document.getElementById('announcement-send-btn');
  if (annSend) annSend.addEventListener('click', () => sendAnnouncement(annInput ? annInput.value : ''));
  const annClear = document.getElementById('announcement-clear-btn');
  if (annClear) annClear.addEventListener('click', () => sendAnnouncement(''));
  if (annInput) annInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); sendAnnouncement(annInput.value); } });

  // Screens sheet
  const screensBtn = document.getElementById('open-screens-btn');
  if (screensBtn) screensBtn.addEventListener('click', () => openSheet('screens-sheet'));
  const screensClose = document.getElementById('screens-sheet-close');
  if (screensClose) screensClose.addEventListener('click', () => closeSheet('screens-sheet'));
  const fadeBlack = document.getElementById('fade-black-toggle');
  if (fadeBlack) {
    fadeBlack.addEventListener('click', () => {
      screensState.fadeBlack = !screensState.fadeBlack;
      screens.setFadeBlack(screensState.fadeBlack);
      fadeBlack.textContent = screensState.fadeBlack ? 'On' : 'Off';
      fadeBlack.setAttribute('aria-checked', String(screensState.fadeBlack));
    });
  }
  const lyricsInput = document.getElementById('lyrics-input');
  const lyricsSend = document.getElementById('lyrics-send-btn');
  if (lyricsSend && lyricsInput) lyricsSend.addEventListener('click', () => { screensState.lyrics = lyricsInput.value; screens.sendLyrics(lyricsInput.value); });
  const lyricsClear = document.getElementById('lyrics-clear-btn');
  if (lyricsClear && lyricsInput) lyricsClear.addEventListener('click', () => { lyricsInput.value = ''; screensState.lyrics = ''; screens.sendLyrics(''); });

  // Vault sheet
  const vaultChip = document.getElementById('vault-status-indicator');
  if (vaultChip) vaultChip.addEventListener('click', () => openSheet('vault-sheet'));
  const vaultClose = document.getElementById('vault-sheet-close');
  if (vaultClose) vaultClose.addEventListener('click', () => closeSheet('vault-sheet'));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeSheet('vault-sheet'); closeSheet('screens-sheet'); }
  });

  // Screen wake lock; the first tap also unlocks audio output in browsers that start suspended.
  const wake = createWakeLock();
  wake.enable();
  document.addEventListener('pointerdown', () => { wake.enable(); if (S.gainStage) S.gainStage.resume(); }, { once: false });
}

