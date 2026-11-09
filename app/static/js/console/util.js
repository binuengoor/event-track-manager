import { S, hooks } from "./state.js";

export function getAuthHeaders() {
  const headers = {};
  if (S.userAdminPin) {
    headers['X-Admin-PIN'] = S.userAdminPin;
  }
  return headers;
}

export function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  const msgEl = document.getElementById('toast-message');
  const iconEl = document.getElementById('toast-icon');

  msgEl.textContent = message;
  if (type === 'error') {
    iconEl.innerHTML = '<i data-lucide="alert-triangle"></i>';
    toast.className = 'c-toast is-show is-error';
  } else {
    iconEl.innerHTML = '<i data-lucide="check-circle"></i>';
    toast.className = 'c-toast is-show';
  }

  if (window.lucide) lucide.createIcons();

  setTimeout(() => {
    toast.className = 'c-toast';
  }, 3500);
}

export function formatTimeAgo(isoString) {
  if (!isoString) return 'Just now';
  const date = new Date(isoString);
  const now = new Date();
  const diffSec = Math.floor((now - date) / 1000);
  if (diffSec < 15) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  return `${diffHr}h ago`;
}

export function formatTime(seconds) {
  if (isNaN(seconds) || seconds === 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export function formatRemainingTime(currentTime, duration) {
  if (!Number.isFinite(duration) || duration <= 0) return '--:--';
  const current = Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0;
  const seconds = Math.max(0, Math.ceil(duration - current));
  const minutesText = String(Math.floor(seconds / 60)).padStart(2, '0');
  const secondsText = String(seconds % 60).padStart(2, '0');
  return `-${minutesText}:${secondsText}`;
}

export function updatePlayerRemainingTime(currentTime, duration) {
  const readout = document.getElementById('player-remaining-time');
  if (readout) readout.textContent = formatRemainingTime(currentTime, duration);
}

export function updatePlayerTimeReadouts(currentTime, duration, item, includeDuration = false) {
  const acoustic = item && (item.track_status === 'Acoustic' || item.is_acoustic === true || /acoustic/i.test(item.performance_type || ''));
  if (!item || acoustic) return false;
  const current = document.getElementById('player-current-time');
  if (current) current.textContent = formatTime(currentTime);
  if (includeDuration) {
    const total = document.getElementById('player-duration');
    if (total) total.textContent = formatTime(duration);
  }
  updatePlayerRemainingTime(currentTime, duration);
  return true;
}

export function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[m]);
}

