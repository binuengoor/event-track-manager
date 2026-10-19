/**
 * Shared Frontend Utilities for Event & Track Manager
 * Centralizes HTML escaping, phone validation, string formatting, and common helpers.
 */

window.escapeHtml = function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

/** Removes decorative emoji from event names (keeps them out of headings and browser tabs). */
window.cleanEventName = function cleanEventName(str) {
  if (!str) return "";
  const cleaned = String(str)
    .replace(/[\p{Extended_Pictographic}\u2728\uFE0F\u200D]/gu, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned || String(str).trim();
};

window.escapeQuotes = function escapeQuotes(str) {
  if (!str) return "";
  return String(str).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
};

window.isValidPhone = function isValidPhone(phone) {
  if (!phone) return false;
  const digits = String(phone).replace(/\D/g, "");
  return digits.length >= 10;
};

window.formatPhone = function formatPhone(phone) {
  if (!phone) return "";
  const digits = String(phone).replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone;
};

window.sanitizeFilename = function sanitizeFilename(text) {
  if (!text) return "";
  const cleaned = String(text).replace(/[^\w\s-]/g, "").trim();
  return cleaned.replace(/[-\s]+/g, "_");
};

window.adaptNavigationForEventConfig = function adaptNavigationForEventConfig(info) {
  if (!info) return;
  if (info.stage_performances_enabled === false) {
    const relabel = (a, fn) => {
      const target = a.querySelector('.nav-label') || a;
      if (target === a && a.children.length) return;
      target.textContent = fn(target.textContent.trim());
    };
    document.querySelectorAll('a[href="/performer"]').forEach(a => {
      relabel(a, text => /performer/i.test(text) ? text.replace(/Performer(\s+Hub)?/i, 'Attendee Hub') : text);
    });
    document.querySelectorAll('a[href="/dashboard"]').forEach(a => {
      relabel(a, text => (text.toLowerCase() === 'dashboard' || text.toLowerCase().includes('transparency dashboard')) ? 'Food Board' : text);
    });
  }
  if (info.console_enabled === false) {
    document.querySelectorAll('a[href="/console"]').forEach(a => {
      a.classList.add('opacity-40');
      a.title = 'Sound console is inactive for this event';
    });
  }
  if (info.live_display_enabled === false) {
    document.querySelectorAll('a[href="/live"]').forEach(a => {
      a.classList.add('opacity-40');
      a.title = 'Live stage display is inactive for this event';
    });
  }
};
