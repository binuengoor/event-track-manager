// UI helpers (errors, formatting, toast).
// Classic script: shares globals with the other intake files (see load order in the page).

function showError(msg) {
  const errCard = document.getElementById('error-card');
  document.getElementById('error-message').textContent = msg;
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
  let colorClasses = 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30';
  if (lower.includes('duet')) {
    colorClasses = 'bg-purple-500/15 text-purple-300 border-purple-500/30';
  } else if (lower.includes('group')) {
    colorClasses = 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
  } else if (lower.includes('acoustic') || lower.includes('live')) {
    colorClasses = 'bg-amber-500/15 text-amber-300 border-amber-500/30';
  }
  return `<span class="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full border ${colorClasses} tracking-wide shrink-0">${escapeHtml(raw)}</span>`;
}

function showToast(message, type = 'success') {
  let toast = document.getElementById('intake-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'intake-toast';
    toast.className = 'fixed bottom-5 right-5 z-50 px-4 py-3 rounded-2xl text-xs font-bold text-white shadow-xl transition-all duration-300 transform translate-y-10 opacity-0 flex items-center gap-2';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = `fixed bottom-5 right-5 z-50 px-4 py-3 rounded-2xl text-xs font-bold text-white shadow-xl transition-all duration-300 transform translate-y-0 opacity-100 flex items-center gap-2 ${
    type === 'error' ? 'bg-rose-600 border border-rose-500' : 'bg-emerald-600 border border-emerald-500'
  }`;
  setTimeout(() => {
    toast.classList.add('translate-y-10', 'opacity-0');
  }, 4000);
}
