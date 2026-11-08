/**
 * Admin destinations built on top of the existing tabs: Overview (totals, show-day switches, preset quick switch,
 * wizard banner), Lineup (running order, track status, unmatched files, restore previous track) and
 * System (events, database snapshots with typed confirmation, clear-media confirmation, offline ZIP).
 * Loaded last. Uses globals from admin-settings.js (adminSettings, loadSettings, showToast, showAdminTab).
 */
(function () {
  'use strict';

  const escRaw = (v) => (typeof window.escapeHtml === 'function' ? window.escapeHtml(v) : String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const esc = (v) => escRaw(v == null ? '' : String(v)); // String() so a count of 0 still prints
  const toast = (m, err) => (typeof window.showToast === 'function' ? window.showToast(m, err) : console.log(m));
  const settings = () => (typeof adminSettings !== 'undefined' && adminSettings) || {};
  const el = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);
  const setSub = (t) => { if (typeof window.setAdminPageSub === 'function') window.setAdminPageSub(t); };
  const currentTab = () => (typeof currentAdminTab !== 'undefined' && currentAdminTab) || 'overview';

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

  /** Track state shown per act: ready, acoustic (no track needed) or waiting. cls is an .ad-pill modifier. */
  function trackBadge(perf) {
    const st = String((perf && perf.track_status) || '').toLowerCase();
    if (st === 'acoustic') return { cls: 'line', label: 'No track needed', ready: true };
    if (st === 'uploaded' || st === 'ready' || (perf && perf.track_file && st !== 'pending')) return { cls: 'ok', label: 'Ready', ready: true };
    return { cls: 'warn', label: 'Needs track', ready: false };
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

  /** "19 solo, 3 duets, 2 groups" from the acts' performance types. */
  function typeBreakdown(perfs) {
    const counts = {};
    (perfs || []).forEach((p) => { const t = String(p.performance_type || '').trim(); if (t) counts[t] = (counts[t] || 0) + 1; });
    return Object.keys(counts).map((t) => {
      const n = counts[t];
      const w = t.toLowerCase();
      return `${n} ${n === 1 || /o$|solo/.test(w) ? w : w + 's'}`;
    }).join(', ');
  }

  function fmtDuration(d) {
    if (d == null || d === '') return '--:--';
    if (typeof d === 'number' || /^\d+(\.\d+)?$/.test(String(d))) {
      const s = Math.round(Number(d));
      return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }
    return String(d);
  }

  function fmtWhen(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  /** Whole days until the event start ("MM-DD-YYYY HH:MMAM"), or null when it cannot be read. */
  function daysUntil(start, now) {
    const m = /^(\d{2})-(\d{2})-(\d{4})/.exec(String(start || '').trim());
    if (!m) return null;
    const target = new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
    const today = now || new Date();
    const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return Math.round((target - base) / 86400000);
  }

  function publicName(name) {
    const parts = String(name || '').trim().split(/\s+/);
    return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0] || '';
  }

  // ------------------------------------------------------------------ overview
  const SWITCHES = [
    { key: 'signup_enabled', title: 'Sign-up open', desc: 'People can add themselves to the show.' },
    { key: 'track_upload_enabled', title: 'Track uploads open', desc: 'People can upload or replace their backing track.', needsStage: true },
    { key: 'live_display_enabled', title: 'Live screen visible', desc: 'The audience screen at /live shows the show.' },
  ];

  function renderBanner() {
    const banner = el('overview-wizard-banner');
    if (!banner) return;
    banner.classList.toggle('hidden', settings().setup_completed === true);
  }

  function renderOverviewSub() {
    if (currentTab() !== 'overview') return;
    const n = daysUntil(settings().event_start_time || settings().event_date_time);
    if (n == null) { setSub(''); return; }
    if (n > 1) setSub(`${n} days to go.`);
    else if (n === 1) setSub('1 day to go.');
    else if (n === 0) setSub('The event is today.');
    else setSub('The event date has passed.');
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
    if (!summary && !perfs) { box.innerHTML = '<p class="ad-empty">Totals are not available right now.</p>'; return; }
    const t = totalsFrom(summary, perfs, payments);
    const showStage = settings().stage_performances_enabled !== false;
    const card = (label, value, of, sub) => `<div class="ad-stat"><span class="l">${esc(label)}</span><strong>${esc(value)}${of != null ? `<i> / ${esc(of)}</i>` : ''}</strong>${sub ? `<span class="s">${esc(sub)}</span>` : ''}</div>`;
    const cards = [];
    if (showStage) {
      cards.push(card('Acts', t.acts, null, typeBreakdown(perfs)));
      const need = t.tracksTotal - t.tracksReady;
      cards.push(card('Tracks ready', t.tracksReady, t.tracksTotal, need > 0 ? `${need} act${need === 1 ? '' : 's'} still need${need === 1 ? 's' : ''} one` : 'Every act has a track'));
    }
    if (settings().food_signup_enabled !== false) {
      const open = Math.max(0, t.dishesTotal - t.dishesTaken);
      cards.push(card('Dishes claimed', t.dishesTaken, t.dishesTotal, `${open} slot${open === 1 ? '' : 's'} open`));
    }
    if (showStage && t.paymentsOn) {
      const unpaid = Math.max(0, t.paidTotal - t.paid);
      cards.push(card('Paid', t.paid, t.paidTotal, `${unpaid} singer${unpaid === 1 ? '' : 's'} not paid`));
    }
    box.innerHTML = cards.join('');
  }

  let presets = [];
  let pendingPreset = null;

  async function renderPresets() {
    const row = el('overview-presets');
    if (!row) return;
    if (!presets.length) { try { presets = await api('/api/admin/presets'); } catch (e) { row.innerHTML = '<p class="ad-empty">Presets are not available right now.</p>'; return; } }
    const active = settings().active_preset || '';
    row.innerHTML = presets.map((p) => `<button type="button" class="admin-chip" data-preset="${esc(p.id)}" data-current="${active === p.id}" aria-pressed="${pendingPreset === p.id}">${esc(p.name)}${active === p.id ? '<span class="sr-only"> (current)</span>' : ''}</button>`).join('');
    row.querySelectorAll('.admin-chip').forEach((b) => b.addEventListener('click', () => { pendingPreset = b.dataset.preset; renderPresets(); renderPresetPreview(); }));
  }

  function renderPresetPreview() {
    const box = el('overview-preset-preview');
    const p = presets.find((x) => x.id === pendingPreset);
    if (!box) return;
    if (!p) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    const rows = p.changes.length
      ? p.changes.map((c) => `<li><span>${esc(c.label)}</span><span><span class="from">${esc(c.from)}</span> &rarr; <span class="to">${esc(c.to)}</span></span></li>`).join('')
      : '<li>Everything already matches this preset.</li>';
    box.innerHTML = `<h4>${esc(p.name)}: what will change</h4>
      <ul>${rows}</ul>
      <div class="ad-btn-row"><button type="button" id="ov-preset-cancel" class="admin-btn admin-btn-secondary">Cancel</button>
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
    renderOverviewSub();
    renderSwitches();
    await Promise.all([renderTotals(), renderPresets()]);
    renderPresetPreview();
  }

  // ------------------------------------------------------------------ lineup
  const ICON_RESTORE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"/></svg>';
  let lineupAll = [];
  let lineupFilter = 'all';
  let lineupQuery = '';

  function lineupVisible() {
    const q = lineupQuery.trim().toLowerCase();
    return lineupAll.filter((p) => {
      if (lineupFilter === 'need' && trackBadge(p).ready) return false;
      if (lineupFilter === 'video' && String(p.media_type || '').toLowerCase() !== 'video') return false;
      if (!q) return true;
      return [p.performer_name, p.partner_name, p.song_title, p.entry_id].some((v) => String(v || '').toLowerCase().includes(q));
    });
  }

  function renderLineupFilters() {
    const box = el('lineup-filters');
    if (!box) return;
    const need = lineupAll.filter((p) => !trackBadge(p).ready).length;
    const video = lineupAll.filter((p) => String(p.media_type || '').toLowerCase() === 'video').length;
    const chip = (id, label, n) => `<button type="button" class="admin-chip" data-lf="${id}" aria-pressed="${lineupFilter === id}">${label} <span class="n">${n}</span></button>`;
    box.innerHTML = chip('all', 'All', lineupAll.length) + chip('need', 'Needs track', need) + chip('video', 'Video', video);
    box.querySelectorAll('[data-lf]').forEach((b) => b.addEventListener('click', () => { lineupFilter = b.dataset.lf; renderLineupFilters(); renderLineupRows(); }));
  }

  function renderLineupRows() {
    const list = el('lineup-list');
    const foot = el('lineup-foot');
    if (!list) return;
    const rows = lineupVisible();
    if (!lineupAll.length) {
      list.removeAttribute('role');
      list.innerHTML = '<p class="ad-empty">No acts yet. They appear here as people sign up.</p>';
      if (foot) foot.textContent = '';
      return;
    }
    if (!rows.length) {
      list.removeAttribute('role');
      list.innerHTML = '<p class="ad-empty">No acts match this filter.</p>';
    } else {
      list.setAttribute('role', 'table');
      const head = `<div role="row" class="ad-tr head"><span role="columnheader">No.</span><span role="columnheader">Entry</span><span role="columnheader">Performer(s)</span><span role="columnheader">Song</span><span role="columnheader">Type</span><span role="columnheader">Track</span><span role="columnheader">Media</span><span role="columnheader">Time</span><span role="columnheader" class="acts">Actions</span></div>`;
      list.innerHTML = head + rows.map((p) => {
        const b = trackBadge(p);
        const playing = p.performance_status === 'On Stage';
        const who = p.performer_name + (p.partner_name ? ` & ${p.partner_name}` : '');
        const sub = p.public_first_name_only ? `Public: ${publicName(p.performer_name)}` : '';
        const media = p.media_type ? String(p.media_type).charAt(0).toUpperCase() + String(p.media_type).slice(1) : '-';
        return `<div role="row" class="ad-tr ${playing ? 'play' : b.ready ? '' : 'need'}" data-entry="${esc(p.entry_id)}">
          <span role="cell" data-c="n" class="mono">${esc(p.sequence_order == null ? '-' : String(p.sequence_order).padStart(2, '0'))}</span>
          <span role="cell" data-c="id" class="mono">${esc(p.entry_id)}</span>
          <span role="cell" data-c="who" class="who"><b title="${esc(who)}">${esc(who)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>
          <span role="cell" data-c="song" class="song">${esc(p.song_title || 'No song title yet')}</span>
          <span role="cell" data-c="type" class="dim">${esc(p.performance_type || '')}</span>
          <span role="cell" data-c="track"><span class="ad-pill ${playing ? 'accent' : b.cls}">${playing ? 'Now playing' : esc(b.label)}</span></span>
          <span role="cell" data-c="media" class="dim">${esc(media)}</span>
          <span role="cell" data-c="time" class="mono">${esc(fmtDuration(p.duration))}</span>
          <span role="cell" data-c="acts" class="acts">
            <button type="button" class="ad-icon-btn lineup-restore" data-entry="${esc(p.entry_id)}" aria-label="Restore previous track for ${esc(p.performer_name)}" title="Restore previous track from archive">${ICON_RESTORE}</button>
            <button type="button" class="admin-btn admin-btn-sm admin-btn-secondary lineup-replace-trigger" data-entry="${esc(p.entry_id)}" aria-label="Replace track for ${esc(p.performer_name)}">Replace</button><input class="sr-only lineup-file" type="file" accept="audio/*,video/mp4,video/webm" data-entry="${esc(p.entry_id)}" tabindex="-1" aria-hidden="true">
            <button type="button" class="admin-btn admin-btn-sm admin-btn-danger lineup-delete" data-entry="${esc(p.entry_id)}">Delete</button>
          </span>
          <span class="al-msg sub-msg hidden" role="status"></span></div>`;
      }).join('');
      list.querySelectorAll('.lineup-restore').forEach((btn) => btn.addEventListener('click', () => restoreTrack(btn)));
      list.querySelectorAll('.lineup-file').forEach((input) => input.addEventListener('change', () => replaceTrack(input)));
      list.querySelectorAll('.lineup-replace-trigger').forEach((button) => button.addEventListener('click', () => {
        const input = Array.from(list.querySelectorAll('.lineup-file')).find((item) => item.dataset.entry === button.dataset.entry);
        input?.click();
      }));
      list.querySelectorAll('.lineup-delete').forEach((button) => button.addEventListener('click', () => deleteAct(button)));
    }
    if (foot) foot.textContent = `Showing ${rows.length} of ${lineupAll.length} act${lineupAll.length === 1 ? '' : 's'}.`;
  }

  async function loadLineup() {
    const list = el('lineup-list');
    const incoming = el('lineup-incoming');
    if (!list) return;
    try {
      lineupAll = sortLineup(await api('/api/admin/participants'));
      const need = lineupAll.filter((p) => !trackBadge(p).ready).length;
      if (currentTab() === 'lineup') {
        setSub(`${lineupAll.length} act${lineupAll.length === 1 ? '' : 's'} in the running order. ${lineupAll.length - need} ${lineupAll.length - need === 1 ? 'has' : 'have'} a track${need ? `, ${need} still need${need === 1 ? 's' : ''} one` : ''}.`);
      }
      renderLineupFilters();
      renderLineupRows();
    } catch (e) {
      list.removeAttribute('role');
      list.innerHTML = `<p class="ad-empty">Could not load the lineup: ${esc(e.message)}</p>`;
    }
    const count = el('lineup-incoming-count');
    if (incoming) {
      try {
        const data = await api('/api/admin/incoming');
        const files = (data && data.files) || [];
        if (count) { count.textContent = String(files.length); count.classList.toggle('hidden', !files.length); }
        incoming.innerHTML = files.length
          ? files.map((f) => `<div class="ad-file"><b>${esc(f.name)}</b><small>${esc(fmtBytes(f.size))}${f.modified ? ' &middot; ' + esc(fmtWhen(f.modified)) : ''}</small><span><span class="ad-pill warn">Not attached to an act</span></span><div class="ad-btn-row"><select class="ad-select lineup-match-act" aria-label="Choose act for ${esc(f.name)}"><option value="">Choose an act</option>${lineupAll.map((p) => `<option value="${esc(p.entry_id)}">${esc(p.entry_id)} · ${esc(p.performer_name)} — ${esc(p.song_title || 'Untitled')}</option>`).join('')}</select><button type="button" class="admin-btn admin-btn-sm admin-btn-primary lineup-match" data-filename="${esc(f.name)}">Match to act</button></div></div>`).join('')
          : '<p class="ad-empty">No unmatched files. Everything that arrived is attached to an act.</p>';
      } catch (e) {
        incoming.innerHTML = `<p class="ad-empty">Could not check for unmatched files: ${esc(e.message)}</p>`;
      }
      incoming?.querySelectorAll('.lineup-match').forEach((button) => button.addEventListener('click', () => matchIncoming(button)));
    }
  }

  async function replaceTrack(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    input.disabled = true;
    try {
      const body = new FormData();
      body.append('file', file);
      await api(`/api/admin/acts/${encodeURIComponent(input.dataset.entry)}/track`, { method: 'POST', body });
      toast('Track replaced');
      await loadLineup();
    } catch (e) { toast(`Could not replace track: ${e.message}`, true); }
    finally { input.disabled = false; input.value = ''; }
  }

  async function deleteAct(button) {
    const id = button.dataset.entry;
    const typed = window.prompt(`Type DELETE to remove ${id} and archive its track.`);
    if (!confirmMatches(typed, 'DELETE')) return;
    button.disabled = true;
    try {
      await api(`/api/admin/acts/${encodeURIComponent(id)}`, { method: 'DELETE' });
      toast(`${id} deleted; track archived`);
      await loadLineup();
    } catch (e) { toast(`Could not delete ${id}: ${e.message}`, true); button.disabled = false; }
  }

  async function matchIncoming(button) {
    const file = button.dataset.filename;
    const select = button.parentElement.querySelector('.lineup-match-act');
    if (!select || !select.value) { toast('Choose an act first', true); return; }
    button.disabled = true;
    try {
      await api(`/api/admin/acts/${encodeURIComponent(select.value)}/match`, sendJson('POST', { filename: file }));
      toast(`Matched ${file}`);
      await loadLineup();
    } catch (e) { toast(`Could not match file: ${e.message}`, true); button.disabled = false; }
  }

  async function addAct(event) {
    event.preventDefault();
    const form = el('lineup-add-form');
    const submit = form.querySelector('[type="submit"]');
    const message = el('lineup-add-message');
    message.classList.add('hidden');
    submit.disabled = true;
    try {
      await api('/api/admin/acts', sendJson('POST', {
        performer_name: el('lineup-add-performer').value.trim(),
        song_title: el('lineup-add-song').value.trim(),
        performance_type: el('lineup-add-type').value,
        partner_name: el('lineup-add-partner').value.trim() || null,
      }));
      form.reset(); form.classList.add('hidden');
      el('lineup-add-act').setAttribute('aria-expanded', 'false');
      toast('Act added');
      await loadLineup();
    } catch (e) {
      message.textContent = `Could not add act: ${e.message}`;
      message.classList.remove('hidden');
    } finally { submit.disabled = false; }
  }

  async function saveLineupOrder() {
    const button = el('lineup-save-order');
    button.disabled = true;
    try { await api('/api/push-sequence', { method: 'POST' }); toast('Running order saved'); await loadLineup(); }
    catch (e) { toast(`Could not save order: ${e.message}`, true); }
    finally { button.disabled = false; }
  }

  async function restoreTrack(btn) {
    const row = btn.closest('[role="row"]');
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

  // ------------------------------------------------------------------ system: events
  let eventsState = null;
  const niceName = (v) => (typeof window.cleanEventName === 'function' ? window.cleanEventName(v) : v);

  async function loadEvents() {
    const box = el('system-events');
    if (!box) return;
    try {
      eventsState = await api('/api/admin/events');
      const canSwitch = eventsState.switching_enabled !== false;
      const newBtn = el('system-new-event');
      if (newBtn) newBtn.disabled = !canSwitch;
      box.innerHTML = eventsState.events.map((e) => `<div class="ad-event ${e.active ? 'active' : ''}" data-event="${esc(e.id)}">
        <div class="ad-event-h"><div><b>${esc(niceName(e.name))}</b><small>${esc(e.id)}${e.start_time ? ' &middot; ' + esc(e.start_time) : ' &middot; no date set'}</small></div>
          <span class="ad-pill ${e.active ? 'accent' : ''}">${e.active ? 'Active' : 'Not active'}</span></div>
        <dl class="ad-event-stats">
          <div><dt>Acts</dt><dd>${esc(e.performances)}</dd></div>
          <div><dt>Dishes</dt><dd>${esc(e.potluck_taken)}/${esc(e.potluck_total)}</dd></div>
          <div><dt>Paid</dt><dd>${esc(e.paid || 0)}/${esc(e.singers != null ? e.singers : e.participants)}</dd></div>
          <div><dt>Disk</dt><dd>${esc(e.media_files ? fmtBytes(e.media_bytes) : '0 MB')}</dd></div>
          <div><dt>Last use</dt><dd>${esc(e.last_activity || 'never')}</dd></div></dl>
        <div class="ad-event-acts">
          ${e.active ? '<button type="button" class="admin-btn admin-btn-sm admin-btn-quiet" disabled>Current</button>'
            : `<button type="button" class="admin-btn admin-btn-sm admin-btn-primary ev-switch" data-id="${esc(e.id)}" ${canSwitch ? '' : 'disabled title="Multiple events are off: EVENT_DIR pins a single folder."'}>Switch</button>`}
          <button type="button" class="admin-btn admin-btn-sm admin-btn-danger push ev-clear-sys" data-id="${esc(e.id)}" ${e.media_files ? '' : 'disabled title="No audio or video to clear"'}>Clear media</button>
        </div></div>`).join('') || '<p class="ad-empty">No events yet.</p>';
      box.querySelectorAll('.ev-switch').forEach((b) => b.addEventListener('click', () => switchEvent(b.dataset.id)));
      box.querySelectorAll('.ev-clear-sys').forEach((b) => b.addEventListener('click', () => openClearDialog(b.dataset.id, b)));
    } catch (e) {
      box.innerHTML = `<p class="ad-empty">Could not load events: ${esc(e.message)}</p>`;
    }
  }

  async function switchEvent(id) {
    const ev = eventsState && eventsState.events.find((e) => e.id === id);
    if (!window.confirm(`Switch to "${ev ? niceName(ev.name) : id}"?\n\nSign-up, the live screen, the console and every other page will show that event right away.`)) return;
    try {
      await api(`/api/admin/events/${encodeURIComponent(id)}/activate`, sendJson('POST'));
      toast('Switched event');
      setTimeout(() => location.reload(), 400);
    } catch (e) { toast(e.message, true); }
  }

  // ------------------------------------------------------------------ system: clear media dialog
  const SVG_X = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  const SVG_OK = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const SVG_BIN = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>';
  let clearReturn = null;

  function closeClearDialog() {
    const wrap = el('clear-media-dialog');
    if (!wrap) return;
    wrap.classList.add('hidden');
    wrap.innerHTML = '';
    const back = clearReturn && document.contains(clearReturn) ? clearReturn : document.querySelector('#system-events button:not([disabled])');
    clearReturn = null;
    if (back && back.focus) back.focus();
  }

  function openClearDialog(id, trigger) {
    const ev = eventsState && eventsState.events.find((e) => e.id === id);
    const wrap = el('clear-media-dialog');
    if (!ev || !wrap) return;
    clearReturn = trigger || null;
    const keep = ['Sign-ups and acts', 'Potluck menu and dish claims', 'Payments', 'Settings and event details'];
    wrap.innerHTML = `<div class="ad-dialog" role="alertdialog" aria-modal="true" aria-labelledby="cm-title" aria-describedby="cm-desc">
      <div class="ad-dialog-h"><span class="ad-dialog-ico">${SVG_BIN}</span><div><h2 id="cm-title" tabindex="-1">Clear media for ${esc(niceName(ev.name))}?</h2><p id="cm-desc">This cannot be undone. Take an export first if unsure.${ev.active ? ' This is the active event.' : ''}</p></div></div>
      <div class="ad-split">
        <div class="del"><h3>Will be deleted</h3>
          <div class="ad-li"><span class="i">${SVG_X}</span><div><b>Audio and video files</b><small>In tracks (including the archive) and incoming. ${esc(ev.media_files)} file${ev.media_files === 1 ? '' : 's'}, ${esc(fmtBytes(ev.media_bytes))}.</small></div></div>
          <div class="ad-li"><span class="i">${SVG_X}</span><div><b>Track links on each act</b><small>Acts show No track again.</small></div></div>
          <span class="tot">${esc(ev.media_files)} file${ev.media_files === 1 ? '' : 's'} &middot; ${esc(fmtBytes(ev.media_bytes))}</span></div>
        <div class="keep"><h3>Will be kept</h3>
          ${keep.map((k) => `<div class="ad-li"><span class="i">${SVG_OK}</span><div><b>${k}</b></div></div>`).join('')}</div>
      </div>
      <p class="ad-card-s">Copies in a browser's offline vault or in a cloud sync target are not touched.</p>
      <label class="ad-field"><span>Type the event id <strong>${esc(id)}</strong> to confirm</span>
        <input type="text" id="cm-confirm" class="ad-input" placeholder="${esc(id)}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      <p id="cm-err" class="ad-err hidden" role="alert"></p>
      <div class="ad-dialog-foot"><button type="button" id="cm-cancel" class="admin-btn admin-btn-secondary">Cancel</button>
        <button type="button" id="cm-go" class="admin-btn admin-btn-solid-danger" disabled>Clear media</button></div></div>`;
    wrap.classList.remove('hidden');
    const dlg = wrap.querySelector('.ad-dialog');
    const input = el('cm-confirm');
    const go = el('cm-go');
    input.addEventListener('input', () => { go.disabled = !confirmMatches(input.value, id); });
    el('cm-cancel').onclick = closeClearDialog;
    wrap.onclick = (e) => { if (e.target === wrap) closeClearDialog(); };
    dlg.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); closeClearDialog(); return; }
      if (e.key !== 'Tab') return;
      const f = Array.from(dlg.querySelectorAll('button, input')).filter((x) => !x.disabled);
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    go.onclick = async () => {
      if (!confirmMatches(input.value, id)) return;
      go.disabled = true;
      try {
        const res = await api(`/api/admin/events/${encodeURIComponent(id)}/clear-media`, sendJson('POST', { confirm: input.value.trim() }));
        toast(`Deleted ${res.files_deleted} file(s), freed ${fmtBytes(res.bytes_freed)}`);
        closeClearDialog();
        await loadEvents();
        document.querySelector('#system-events button:not([disabled])')?.focus();
        if (typeof window.loadReadiness === 'function') window.loadReadiness();
      } catch (e) {
        const m = el('cm-err');
        m.textContent = e.message;
        m.classList.remove('hidden');
        go.disabled = false;
      }
    };
    input.focus();
  }

  // ------------------------------------------------------------------ system: snapshots
  function snapshotRow(s, latest) {
    return `<div class="ad-snap"><div><b>${esc(s.name)}</b><small>${esc(fmtWhen(s.modified))} &middot; ${esc(fmtBytes(s.size))}</small></div>
      ${latest ? '<span class="ad-pill ok">Latest</span>' : ''}
      <a class="admin-btn admin-btn-sm admin-btn-secondary" href="/api/admin/snapshots/${encodeURIComponent(s.name)}/download" download aria-label="Download ${esc(s.name)}">Download</a>
      <button type="button" class="admin-btn admin-btn-sm admin-btn-danger snap-restore" data-name="${esc(s.name)}" aria-label="Restore ${esc(s.name)}">Restore...</button></div>`;
  }

  async function loadSnapshots() {
    const box = el('system-snapshots');
    if (!box) return;
    try {
      const data = await api('/api/admin/snapshots');
      const snaps = data.snapshots || [];
      const pre = data.pre_migration || [];
      box.innerHTML = (snaps.length ? snaps.map((s, i) => snapshotRow(s, i === 0)).join('') : '<p class="ad-empty">No snapshots yet. One is saved automatically every few minutes while people use the app.</p>')
        + (pre.length ? `<h4 class="ad-h4">Saved before an app update</h4>${pre.map((s) => snapshotRow(s, false)).join('')}` : '');
      box.querySelectorAll('.snap-restore').forEach((b) => b.addEventListener('click', () => askRestore(b.dataset.name)));
    } catch (e) {
      box.innerHTML = `<p class="ad-empty">Could not load snapshots: ${esc(e.message)}</p>`;
    }
  }

  function askRestore(name) {
    const box = el('snapshot-restore-box');
    if (!box) return;
    box.classList.remove('hidden');
    box.innerHTML = `<h4 id="snapshot-restore-title">Restore ${esc(name)}?</h4>
      <p>This replaces all current sign-ups, potluck, payments and settings with the snapshot. A safety copy of today's data is saved first, so you can undo it.</p>
      <div class="ad-confirm-row"><input id="snap-confirm" aria-label="Type RESTORE to confirm" placeholder="Type RESTORE to confirm" autocomplete="off">
        <button type="button" id="snap-cancel" class="admin-btn admin-btn-secondary">Cancel</button>
        <button type="button" id="snap-go" class="admin-btn admin-btn-solid-danger" disabled>Restore snapshot</button></div>
      <p id="snap-msg" class="ad-err hidden" role="alert"></p>`;
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
    el('lineup-save-order')?.addEventListener('click', saveLineupOrder);
    el('lineup-add-act')?.addEventListener('click', () => { const form = el('lineup-add-form'); form.classList.toggle('hidden'); el('lineup-add-act').setAttribute('aria-expanded', String(!form.classList.contains('hidden'))); if (!form.classList.contains('hidden')) el('lineup-add-performer').focus(); });
    el('lineup-add-cancel')?.addEventListener('click', () => { el('lineup-add-form').classList.add('hidden'); el('lineup-add-act').setAttribute('aria-expanded', 'false'); });
    el('lineup-add-form')?.addEventListener('submit', addAct);
    el('lineup-search')?.addEventListener('input', (e) => { lineupQuery = e.target.value; renderLineupRows(); });
    el('system-snapshots-refresh')?.addEventListener('click', loadSnapshots);
    el('system-manage-events')?.addEventListener('click', () => el('manage-events-btn')?.click());
    el('system-new-event')?.addEventListener('click', () => el('new-event-btn')?.click());
    document.addEventListener('etm:admin-tab', (ev) => { const f = loaders[ev.detail.tab]; if (f) f(); });
    document.addEventListener('etm:settings-loaded', () => { renderBanner(); renderSwitches(); renderOverviewSub(); });
    if (typeof window.loadAllAdminData === 'function') {
      const original = window.loadAllAdminData;
      window.loadAllAdminData = async function () {
        const out = await original.apply(this, arguments);
        const tab = currentTab();
        if (loaders[tab]) loaders[tab]();
        return out;
      };
    }
  }

  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', bind);
  window.adOpenClearDialog = openClearDialog;  // also used by the Manage events modal
  window.AdminDash = { fmtBytes, trackBadge, sortLineup, confirmMatches, totalsFrom, typeBreakdown, daysUntil, fmtDuration };
})();
