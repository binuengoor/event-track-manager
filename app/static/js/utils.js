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
