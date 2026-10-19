/**
 * Admin event switcher: pick the active event, create a new one, see every past event, free disk space by
 * clearing an event's audio/video. Loaded after admin-settings.js.
 */
(function () {
  'use strict';

  const esc = (v) => (window.escapeHtml ? window.escapeHtml(v) : String(v));
  const nice = (v) => (window.cleanEventName ? window.cleanEventName(v) : String(v));
  const toast = (m, err) => (typeof showToast === 'function' ? showToast(m, err) : console.log(m));
  const api = async (path, opts) => {
    const res = await fetch(path, opts);
    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) throw new Error((data && data.detail) || `Request failed (${res.status})`);
    return data;
  };
  const post = (path, body) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const fmtBytes = (b) => (b >= 1073741824 ? `${(b / 1073741824).toFixed(1)} GB` : b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`);
  const show = (id) => document.getElementById(id)?.classList.remove('hidden');
  const hide = (id) => document.getElementById(id)?.classList.add('hidden');

  let state = null;

  async function load() {
    try { state = await api('/api/admin/events'); } catch (e) { return; }
    const bar = document.getElementById('event-bar');
    if (!bar) return;
    bar.classList.remove('hidden');
    const sel = document.getElementById('event-select');
    sel.innerHTML = state.events.map((e) => `<option value="${esc(e.id)}" ${e.active ? 'selected' : ''}>${esc(nice(e.name))}${e.start_time ? ' · ' + esc(e.start_time) : ''}</option>`).join('');
    sel.disabled = !state.switching_enabled;
    document.getElementById('new-event-btn').disabled = !state.switching_enabled;
    document.getElementById('new-event-btn').title = state.switching_enabled ? '' : 'Multiple events are off: EVENT_DIR pins a single folder.';
    renderManage();
    if (window.lucide) lucide.createIcons();
  }

  function renderManage() {
    const body = document.getElementById('events-table-body');
    if (!body || !state) return;
    body.innerHTML = state.events.map((e) => `
      <tr class="${e.active ? 'bg-orange-500/5' : ''}">
        <td class="px-3 py-3"><div class="font-bold text-white flex items-center gap-2">${esc(nice(e.name))}${e.active ? '<span class="px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[9px]">ACTIVE</span>' : ''}</div>
          <div class="text-slate-500 font-mono text-[10px]">${esc(e.id)}${e.start_time ? ' · ' + esc(e.start_time) : ''}</div></td>
        <td class="px-3 py-3 text-slate-300">${e.performances}<span class="text-slate-500"> · ${e.participants} people</span></td>
        <td class="px-3 py-3 text-slate-300">${e.potluck_taken}/${e.potluck_total}</td>
        <td class="px-3 py-3 text-slate-300">${e.paid || 0}</td>
        <td class="px-3 py-3 text-slate-300">${e.media_files ? `${e.media_files} files · ${fmtBytes(e.media_bytes)}` : '<span class="text-slate-500">none</span>'}</td>
        <td class="px-3 py-3 text-slate-400">${esc(e.last_activity || '')}</td>
        <td class="px-3 py-3 text-right whitespace-nowrap">
          <button type="button" class="ev-activate px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold border border-slate-700 disabled:opacity-40" data-id="${esc(e.id)}" ${e.active || !state.switching_enabled ? 'disabled' : ''}>Make active</button>
          <button type="button" class="ev-clear px-3 py-1.5 rounded-lg bg-rose-900/40 hover:bg-rose-900/70 text-rose-200 font-bold border border-rose-500/30 disabled:opacity-40" data-id="${esc(e.id)}" ${e.media_files ? '' : 'disabled'}>Clear media</button>
        </td></tr>`).join('') || '<tr><td colspan="7" class="p-6 text-center text-slate-500">No events yet.</td></tr>';
    body.querySelectorAll('.ev-activate').forEach((b) => b.addEventListener('click', () => switchTo(b.dataset.id)));
    body.querySelectorAll('.ev-clear').forEach((b) => b.addEventListener('click', () => askClear(b.dataset.id)));
  }

  async function switchTo(id) {
    const ev = state.events.find((e) => e.id === id);
    if (!window.confirm(`Switch to "${ev ? nice(ev.name) : id}"?\n\nSign-up, the live screen, the console and every other page will show that event right away.`)) { await load(); return; }
    try {
      await post(`/api/admin/events/${encodeURIComponent(id)}/activate`);
      toast('Switched event');
      setTimeout(() => location.reload(), 400);
    } catch (e) { toast(e.message, true); load(); }
  }

  function askClear(id) {
    const ev = state.events.find((e) => e.id === id);
    const box = document.getElementById('clear-media-box');
    box.classList.remove('hidden');
    box.innerHTML = `
      <div class="font-bold text-rose-200 text-sm">Clear media for "${esc(nice(ev.name))}"?</div>
      <p class="text-slate-300">This permanently deletes <strong>${ev.media_files} audio/video file(s) (${fmtBytes(ev.media_bytes)})</strong> from this event's <code>tracks/</code>, <code>tracks/_archive/</code> and <code>incoming/</code> folders.
      Sign-ups, potluck, payments and settings are <strong>kept</strong>. Acts will show "no track" again.${ev.active ? ' <strong>This is the active event.</strong>' : ''}</p>
      <p class="text-slate-500">Copies in a browser's offline vault or in a cloud sync target are not touched.</p>
      <div class="flex flex-col sm:flex-row gap-2 sm:items-center">
        <input id="clear-confirm" placeholder="Type ${esc(id)} to confirm" class="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono">
        <button type="button" id="clear-cancel" class="px-4 py-2 rounded-xl bg-slate-800 text-slate-200 font-bold border border-slate-700">Cancel</button>
        <button type="button" id="clear-go" class="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold disabled:opacity-40" disabled>Delete media</button>
      </div>`;
    const input = document.getElementById('clear-confirm');
    const go = document.getElementById('clear-go');
    input.addEventListener('input', () => { go.disabled = input.value.trim() !== id; });
    document.getElementById('clear-cancel').onclick = () => box.classList.add('hidden');
    go.onclick = async () => {
      go.disabled = true;
      try {
        const res = await post(`/api/admin/events/${encodeURIComponent(id)}/clear-media`, { confirm: input.value.trim() });
        toast(`Deleted ${res.files_deleted} file(s), freed ${fmtBytes(res.bytes_freed)}`);
        box.classList.add('hidden');
        await load();
      } catch (e) { toast(e.message, true); go.disabled = false; }
    };
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function openNew() {
    const copy = document.getElementById('ne-copy');
    copy.innerHTML = `<option value="current">The current event (rules, switches, potluck menu)</option><option value="none">Blank (defaults, no potluck menu)</option>` +
      state.events.filter((e) => !e.active).map((e) => `<option value="${esc(e.id)}">${esc(nice(e.name))}</option>`).join('');
    ['ne-name', 'ne-start', 'ne-venue'].forEach((i) => { document.getElementById(i).value = ''; });
    hide('ne-error');
    show('new-event-modal');
    document.getElementById('ne-name').focus();
  }

  async function create() {
    const err = document.getElementById('ne-error');
    err.classList.add('hidden');
    const btn = document.getElementById('ne-create');
    btn.disabled = true;
    try {
      await post('/api/admin/events', {
        name: document.getElementById('ne-name').value,
        start_time: document.getElementById('ne-start').value.trim(),
        venue: document.getElementById('ne-venue').value.trim(),
        copy_from: document.getElementById('ne-copy').value,
        activate: document.getElementById('ne-activate').checked,
      });
      toast('Event created');
      try { sessionStorage.removeItem('wizard_dismissed'); } catch (e) { /* ignore */ }
      setTimeout(() => location.reload(), 400);
    } catch (e) {
      err.textContent = e.message;
      err.classList.remove('hidden');
      btn.disabled = false;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('event-select')?.addEventListener('change', (e) => switchTo(e.target.value));
    document.getElementById('new-event-btn')?.addEventListener('click', openNew);
    document.getElementById('ne-create')?.addEventListener('click', create);
    document.getElementById('manage-events-btn')?.addEventListener('click', async () => { await load(); show('manage-events-modal'); if (window.lucide) lucide.createIcons(); });
    document.querySelectorAll('[data-close-modal]').forEach((b) => b.addEventListener('click', () => { hide('new-event-modal'); hide('manage-events-modal'); }));
    if (typeof window.loadAllAdminData === 'function') {
      const original = window.loadAllAdminData;
      window.loadAllAdminData = async function () {
        await original.apply(this, arguments);
        load();
      };
    }
  });
})();
