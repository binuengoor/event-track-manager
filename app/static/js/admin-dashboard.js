/**
 * Admin destinations built on top of the existing tabs: Overview (totals, show-day switches, preset quick switch,
 * wizard banner), Lineup (running order, track status, unmatched files, restore previous track) and
 * System (events, database snapshots with typed confirmation, offline ZIP).
 * Loaded last. Uses globals from admin-settings.js (adminSettings, loadSettings, showToast, showAdminTab).
 */
(function () {
  'use strict';

  const esc = (v) => (typeof window.escapeHtml === 'function' ? window.escapeHtml(v) : String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const toast = (m, err) => (typeof window.showToast === 'function' ? window.showToast(m, err) : console.log(m));
  const settings = () => (typeof adminSettings !== 'undefined' && adminSettings) || {};
  const el = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);

  async function api(path, opts) {
    const res = await fetch(path, opts);
    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
      const err = new Error((data && data.detail) || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }
  const sendJson = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

  // ------------------------------------------------------------------ pure helpers (unit tested)
  function fmtBytes(b) {
    b = Number(b) || 0;
    if (b >= 1073741824) return `${(b / 1073741824).toFixed(1)} GB`;
    if (b >= 1048576) return `${(b / 1048576).toFixed(1)} MB`;
    if (b >= 1024) return `${Math.round(b / 1024)} KB`;
    return `${b} B`;
  }

  /** Track state shown per act: ready, acoustic (no track needed) or waiting. */
  function trackBadge(perf) {
    const st = String((perf && perf.track_status) || '').toLowerCase();
    if (st === 'acoustic') return { cls: 'al-acoustic', label: 'No track needed', ready: true };
    if (st === 'uploaded' || st === 'ready' || (perf && perf.track_file && st !== 'pending')) return { cls: 'al-ready', label: 'Track ready', ready: true };
    return { cls: 'al-wait', label: 'Waiting for track', ready: false };
  }

  function sortLineup(perfs) {
    return (perfs || []).slice().sort((a, b) => {
      const x = a.sequence_order == null ? 9999 : a.sequence_order;
      const y = b.sequence_order == null ? 9999 : b.sequence_order;
      return x - y;
    });
  }

  /** Typed confirmation: the admin must type the exact word. */
  function confirmMatches(typed, expected) {
    return String(typed || '').trim() === String(expected || '');
  }

  function totalsFrom(summary, perfs, payments) {
    const list = perfs || [];
    const ready = list.filter((p) => trackBadge(p).ready).length;
    return {
      acts: summary ? summary.total_performances : list.length,
      tracksReady: ready,
      tracksTotal: list.length,
      dishesTaken: summary ? summary.food_taken : 0,
      dishesTotal: summary ? summary.food_total : 0,
      paid: payments ? payments.paid : 0,
      paidTotal: payments ? payments.total : 0,
      paymentsOn: !payments || payments.enabled !== false,
    };
  }

  // ------------------------------------------------------------------ overview
  const SWITCHES = [
    { key: 'signup_enabled', title: 'Sign-up open', desc: 'People can add themselves to the show.' },
    { key: 'track_upload_enabled', title: 'Uploads open', desc: 'People can upload or replace their backing track.', needsStage: true },
    { key: 'live_display_enabled', title: 'Live screen visible', desc: 'The audience screen at /live shows the show.' },
  ];

  function renderBanner() {
    const banner = el('overview-wizard-banner');
    if (!banner) return;
    banner.classList.toggle('hidden', settings().setup_completed === true);
  }

  function renderSwitches() {
    const box = el('overview-switches');
    if (!box) return;
    const s = settings();
    box.innerHTML = SWITCHES.filter((sw) => !(sw.needsStage && s.stage_performances_enabled === false)).map((sw) => {
      const on = s[sw.key] !== false;
      return `<div class="admin-switch-row">
        <div><span class="t" id="sw-label-${sw.key}">${esc(sw.title)}</span><span class="d">${esc(sw.desc)}</span></div>
        <button type="button" role="switch" class="sw" data-key="${sw.key}" aria-checked="${on}" aria-labelledby="sw-label-${sw.key}"></button></div>`;
    }).join('');
    box.querySelectorAll('.sw').forEach((btn) => btn.addEventListener('click', async () => {
      const key = btn.dataset.key;
      const next = btn.getAttribute('aria-checked') !== 'true';
      btn.disabled = true;
      try {
        await api('/api/admin/settings', sendJson('PUT', { [key]: next }));
        btn.setAttribute('aria-checked', String(next));
        toast(`${SWITCHES.find((x) => x.key === key).title}: ${next ? 'on' : 'off'}`);
        if (typeof window.loadSettings === 'function') await window.loadSettings();
      } catch (e) {
        toast(e.message, true);
      } finally {
        btn.disabled = false;
      }
    }));
  }

  async function renderTotals() {
    const box = el('overview-totals');
    if (!box) return;
    const [summary, perfs, payments] = await Promise.all([
      api('/api/admin/summary').catch(() => null),
      api('/api/admin/participants').catch(() => null),
      api('/api/admin/payments').catch(() => null),
    ]);
    if (!summary && !perfs) { box.innerHTML = '<p class="al-empty">Totals are not available right now.</p>'; return; }
    const t = totalsFrom(summary, perfs, payments);
    const showStage = settings().stage_performances_enabled !== false;
    const cards = [];
    if (showStage) {
      cards.push(['Acts', t.acts]);
      cards.push(['Tracks ready', `${t.tracksReady}/${t.tracksTotal}`]);
    }
    if (settings().food_signup_enabled !== false) cards.push(['Dishes taken', `${t.dishesTaken}/${t.dishesTotal}`]);
    if (showStage && t.paymentsOn) cards.push(['Paid', `${t.paid}/${t.paidTotal}`]);
    box.innerHTML = cards.map(([label, value]) => `<div class="admin-total"><strong>${esc(value)}</strong><span>${esc(label)}</span></div>`).join('');
  }

  let presets = [];
  let pendingPreset = null;

  async function renderPresets() {
    const row = el('overview-presets');
    if (!row) return;
    if (!presets.length) { try { presets = await api('/api/admin/presets'); } catch (e) { row.innerHTML = '<p class="al-empty">Presets are not available right now.</p>'; return; } }
    const active = settings().active_preset || '';
    row.innerHTML = presets.map((p) => `<button type="button" class="admin-chip" data-preset="${esc(p.id)}" aria-pressed="${pendingPreset === p.id}">${esc(p.name)}${active === p.id ? ' (current)' : ''}</button>`).join('');
    row.querySelectorAll('.admin-chip').forEach((b) => b.addEventListener('click', () => { pendingPreset = b.dataset.preset; renderPresets(); renderPresetPreview(); }));
  }

  function renderPresetPreview() {
    const box = el('overview-preset-preview');
    const p = presets.find((x) => x.id === pendingPreset);
    if (!box) return;
    if (!p) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    const rows = p.changes.length
      ? p.changes.map((c) => `<li class="flex items-center justify-between gap-3 py-1.5 border-b border-slate-800/70"><span class="text-slate-300">${esc(c.label)}</span><span class="font-mono text-[11px]"><span class="text-slate-500">${esc(c.from)}</span> &rarr; <span class="text-orange-300 font-bold">${esc(c.to)}</span></span></li>`).join('')
      : '<li class="py-2 text-emerald-300">Everything already matches this preset.</li>';
    box.innerHTML = `<h4 class="text-sm font-bold text-white">${esc(p.name)}: what will change</h4>
      <ul class="text-xs">${rows}</ul>
      <div class="flex gap-2"><button type="button" id="ov-preset-cancel" class="admin-btn admin-btn-secondary">Cancel</button>
      <button type="button" id="ov-preset-apply" class="admin-btn admin-btn-primary" ${p.changes.length ? '' : 'disabled'}>Apply ${esc(p.name)}</button></div>`;
    el('ov-preset-cancel').onclick = () => { pendingPreset = null; renderPresets(); renderPresetPreview(); };
    el('ov-preset-apply').onclick = async () => {
      try {
        await api('/api/admin/apply-preset', sendJson('POST', { preset: p.id }));
        toast(`"${p.name}" applied`);
        pendingPreset = null;
        presets = [];
        if (typeof window.loadSettings === 'function') await window.loadSettings();
        await refreshOverview();
        if (typeof window.loadReadiness === 'function') window.loadReadiness();
      } catch (e) { toast(e.message, true); }
    };
  }

  async function refreshOverview() {
    renderBanner();
    renderSwitches();
    await Promise.all([renderTotals(), renderPresets()]);
    renderPresetPreview();
  }

  // ------------------------------------------------------------------ lineup
  async function loadLineup() {
    const list = el('lineup-list');
    const incoming = el('lineup-incoming');
    if (!list) return;
    try {
      const perfs = sortLineup(await api('/api/admin/participants'));
      if (!perfs.length) {
        list.innerHTML = '<p class="al-empty">No acts yet. They appear here as people sign up.</p>';
      } else {
        list.innerHTML = perfs.map((p) => {
          const b = trackBadge(p);
          return `<div class="al-row" data-entry="${esc(p.entry_id)}">
            <span class="al-num">${esc(p.sequence_order == null ? '-' : p.sequence_order)}</span>
            <div class="al-main"><b>${esc(p.performer_name)}${p.partner_name ? ' &amp; ' + esc(p.partner_name) : ''}</b><small>${esc(p.song_title || 'No song title yet')}${p.performance_type ? ' · ' + esc(p.performance_type) : ''}</small></div>
            <span class="al-badge ${b.cls}">${esc(b.label)}</span>
            <button type="button" class="admin-btn admin-btn-secondary lineup-restore" data-entry="${esc(p.entry_id)}" aria-label="Restore previous track for ${esc(p.performer_name)}">Restore previous track</button>
            <span class="al-msg hidden" role="status"></span></div>`;
        }).join('');
        list.querySelectorAll('.lineup-restore').forEach((btn) => btn.addEventListener('click', () => restoreTrack(btn)));
      }
    } catch (e) {
      list.innerHTML = `<p class="al-empty">Could not load the lineup: ${esc(e.message)}</p>`;
    }
    if (incoming) {
      try {
        const data = await api('/api/admin/incoming');
        const files = (data && data.files) || [];
        incoming.innerHTML = files.length
          ? files.map((f) => `<div class="al-row"><div class="al-main"><b>${esc(f.name)}</b><small>${esc(fmtBytes(f.size))} · ${esc(f.modified || '')}</small></div><span class="al-badge al-wait">Not attached to an act</span></div>`).join('')
          : '<p class="al-empty">No unmatched files. Everything that arrived is attached to an act.</p>';
      } catch (e) {
        incoming.innerHTML = `<p class="al-empty">Could not check for unmatched files: ${esc(e.message)}</p>`;
      }
    }
  }

  async function restoreTrack(btn) {
    const row = btn.closest('.al-row');
    const msg = row.querySelector('.al-msg');
    btn.disabled = true;
    try {
      await api(`/api/admin/tracks/${encodeURIComponent(btn.dataset.entry)}/restore`, sendJson('POST'));
      toast('Previous track restored');
      await loadLineup();
    } catch (e) {
      msg.textContent = e.status === 404 ? 'There is no earlier track saved for this act.' : e.message;
      msg.classList.remove('hidden');
      btn.disabled = false;
    }
  }

  // ------------------------------------------------------------------ system
  async function loadEvents() {
    const box = el('system-events');
    if (!box) return;
    try {
      const data = await api('/api/admin/events');
      const nice = (v) => (typeof window.cleanEventName === 'function' ? window.cleanEventName(v) : v);
      box.innerHTML = data.events.map((e) => `<div class="al-row"><div class="al-main"><b>${esc(nice(e.name))}</b><small>${esc(e.id)}${e.start_time ? ' · ' + esc(e.start_time) : ''} · ${esc(e.performances)} acts · ${e.media_files ? esc(e.media_files) + ' media files (' + esc(fmtBytes(e.media_bytes)) + ')' : 'no media'}</small></div>${e.active ? '<span class="al-badge al-ready">Active</span>' : ''}</div>`).join('')
        || '<p class="al-empty">No events yet.</p>';
    } catch (e) {
      box.innerHTML = `<p class="al-empty">Could not load events: ${esc(e.message)}</p>`;
    }
  }

  function snapshotRow(s, restorable) {
    return `<div class="al-row"><div class="al-main"><b>${esc(s.name)}</b><small>${esc(fmtBytes(s.size))} · ${esc(s.modified || '')}</small></div>
      <a class="admin-btn admin-btn-secondary" href="/api/admin/snapshots/${encodeURIComponent(s.name)}/download" download aria-label="Download ${esc(s.name)}">Download</a>
      ${restorable ? `<button type="button" class="admin-btn admin-btn-danger snap-restore" data-name="${esc(s.name)}">Restore...</button>` : ''}</div>`;
  }

  async function loadSnapshots() {
    const box = el('system-snapshots');
    if (!box) return;
    try {
      const data = await api('/api/admin/snapshots');
      const snaps = data.snapshots || [];
      const pre = data.pre_migration || [];
      box.innerHTML = (snaps.length ? snaps.map((s) => snapshotRow(s, true)).join('') : '<p class="al-empty">No snapshots yet. One is saved automatically every few minutes while people use the app.</p>')
        + (pre.length ? `<h4 class="text-xs font-bold uppercase tracking-wider text-slate-400 pt-2">Saved before an app update</h4>${pre.map((s) => snapshotRow(s, true)).join('')}` : '');
      box.querySelectorAll('.snap-restore').forEach((b) => b.addEventListener('click', () => askRestore(b.dataset.name)));
    } catch (e) {
      box.innerHTML = `<p class="al-empty">Could not load snapshots: ${esc(e.message)}</p>`;
    }
  }

  function askRestore(name) {
    const box = el('snapshot-restore-box');
    if (!box) return;
    box.classList.remove('hidden');
    box.innerHTML = `<h4 id="snapshot-restore-title" class="text-sm font-bold text-rose-200">Restore ${esc(name)}?</h4>
      <p class="text-xs text-slate-300">This replaces all current sign-ups, potluck, payments and settings with the snapshot. A safety copy of today's data is saved first, so you can undo it.</p>
      <div class="al-confirm-row"><input id="snap-confirm" aria-label="Type RESTORE to confirm" placeholder="Type RESTORE to confirm" autocomplete="off">
        <button type="button" id="snap-cancel" class="admin-btn admin-btn-secondary">Cancel</button>
        <button type="button" id="snap-go" class="admin-btn admin-btn-danger" disabled>Restore snapshot</button></div>
      <p id="snap-msg" class="text-xs text-rose-300 hidden" role="alert"></p>`;
    const input = el('snap-confirm');
    const go = el('snap-go');
    input.addEventListener('input', () => { go.disabled = !confirmMatches(input.value, 'RESTORE'); });
    el('snap-cancel').onclick = () => { box.classList.add('hidden'); box.innerHTML = ''; };
    go.onclick = async () => {
      if (!confirmMatches(input.value, 'RESTORE')) return;
      go.disabled = true;
      try {
        const res = await api(`/api/admin/snapshots/${encodeURIComponent(name)}/restore`, sendJson('POST'));
        toast(`Restored ${name}. Safety copy: ${res.safety_snapshot}`);
        box.classList.add('hidden');
        box.innerHTML = '';
        if (typeof window.loadAllAdminData === 'function') await window.loadAllAdminData();
        await loadSnapshots();
      } catch (e) {
        const m = el('snap-msg');
        m.textContent = e.message;
        m.classList.remove('hidden');
        go.disabled = false;
      }
    };
    input.focus();
  }

  async function loadSystem() {
    await Promise.all([loadEvents(), loadSnapshots()]);
  }

  // ------------------------------------------------------------------ wiring
  const loaders = { overview: refreshOverview, lineup: loadLineup, system: loadSystem };

  function bind() {
    el('lineup-refresh')?.addEventListener('click', loadLineup);
    el('system-snapshots-refresh')?.addEventListener('click', loadSnapshots);
    el('system-manage-events')?.addEventListener('click', () => el('manage-events-btn')?.click());
    document.addEventListener('etm:admin-tab', (ev) => { const f = loaders[ev.detail.tab]; if (f) f(); });
    document.addEventListener('etm:settings-loaded', () => { renderBanner(); renderSwitches(); });
    if (typeof window.loadAllAdminData === 'function') {
      const original = window.loadAllAdminData;
      window.loadAllAdminData = async function () {
        const out = await original.apply(this, arguments);
        const tab = (typeof currentAdminTab !== 'undefined' && currentAdminTab) || 'overview';
        if (loaders[tab]) loaders[tab]();
        return out;
      };
    }
  }

  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', bind);
  window.AdminDash = { fmtBytes, trackBadge, sortLineup, confirmMatches, totalsFrom };
})();
