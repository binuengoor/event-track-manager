// UI helpers (errors, formatting, toast).
// Classic script: shares globals with the other intake files (see load order in the page).

// Shows the error card. opts.title is the bold heading; opts.action is 'file' or 'link' to offer the matching recovery button.
function showError(msg, opts = {}) {
  const errCard = document.getElementById('error-card');
  document.getElementById('error-message').textContent = msg;
  const titleEl = document.getElementById('error-title');
  if (titleEl) titleEl.textContent = opts.title || 'Something went wrong';
  const actionBtn = document.getElementById('error-action-btn');
  if (actionBtn) {
    actionBtn.dataset.action = opts.action || '';
    actionBtn.textContent = opts.action === 'link' ? 'Paste a different link' : 'Choose another file';
    actionBtn.classList.toggle('hidden', !opts.action);
  }
  document.getElementById('retry-upload-btn')?.classList.toggle('hidden', !lastSubmitFailed);
  errCard.classList.remove('hidden');
  errCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (window.lucide) lucide.createIcons();
}

function hideError() {
  document.getElementById('error-card').classList.add('hidden');
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[m]);
}

function renderTypePill(perfType) {
  const raw = (perfType || 'Solo').trim();
  const lower = raw.toLowerCase();
  let kind = 'solo';
  if (lower.includes('duet')) kind = 'duet';
  else if (lower.includes('group')) kind = 'group';
  else if (lower.includes('acoustic') || lower.includes('live')) kind = 'live';
  return `<span class="me-type" data-kind="${kind}">${escapeHtml(raw)}</span>`;
}

function showToast(message, type = 'success') {
  let toast = document.getElementById('intake-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'intake-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = `me-toast is-visible ${type === 'error' ? 'is-error' : 'is-ok'}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.classList.remove('is-visible'); }, 4000);
}
