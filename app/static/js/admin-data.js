/**
 * Admin "Spreadsheet" viewer (tabs follow the event type, search, downloads) and the "Payments" checklist.
 * Loaded after admin-settings.js.
 */
(function () {
  'use strict';

  const esc = (v) => (window.escapeHtml ? window.escapeHtml(v) : String(v));
  const toast = (m, err) => (typeof showToast === 'function' ? showToast(m, err) : console.log(m));
  const api = async (path, opts) => {
    const res = await fetch(path, opts);
    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) throw new Error((data && data.detail) || `Request failed (${res.status})`);
    return data;
  };

  // ------------------------------------------------------------------ spreadsheet viewer
  let sheet = null;          // last /api/admin/data payload
  let activeTab = null;
  let query = '';

  async function loadSheet(showSpinner) {
    const table = document.getElementById('sheet-table');
    if (!table) return;
    if (showSpinner) table.innerHTML = '<tbody><tr><td class="p-6 text-center text-slate-500">Loading the latest data...</td></tr></tbody>';
    try {
      sheet = await api('/api/admin/data');
    } catch (e) { toast(e.message, true); return; }
    if (!sheet.tables.find((t) => t.id === activeTab)) activeTab = sheet.tables[0] && sheet.tables[0].id;
    // payments only make sense when there is a stage show
    document.getElementById('tab-btn-payments')?.classList.toggle('hidden', !sheet.kind.stage);
    const sub = document.getElementById('sheet-sub');
    if (sub) sub.textContent = `${(window.cleanEventName ? window.cleanEventName(sheet.event_name) : sheet.event_name) || sheet.event_id}: refreshed ${new Date().toLocaleTimeString()}. ${sheet.kind.stage ? '' : 'Potluck-only event, so only the potluck sheet is shown.'}`;
    renderSheet();
    renderDownloadMenu();
  }

  function renderSheet() {
    if (!sheet) return;
    const tabs = document.getElementById('sheet-tabs');
    tabs.innerHTML = sheet.tables.map((t) => `<button type="button" data-t="${esc(t.id)}" class="sheet-tab px-3.5 py-1.5 rounded-xl text-xs font-bold border transition ${t.id === activeTab ? 'bg-emerald-600 text-white border-emerald-500' : 'bg-slate-950 text-slate-300 border-slate-700 hover:text-white'}">${esc(t.title)} <span class="opacity-70 font-mono">${t.count}</span></button>`).join('');
    tabs.querySelectorAll('.sheet-tab').forEach((b) => b.addEventListener('click', () => { activeTab = b.dataset.t; query = ''; document.getElementById('sheet-search').value = ''; renderSheet(); renderDownloadMenu(); }));

    const t = sheet.tables.find((x) => x.id === activeTab);
    const table = document.getElementById('sheet-table');
    if (!t) { table.innerHTML = '<tbody><tr><td class="p-6 text-center text-slate-500">Nothing to show yet.</td></tr></tbody>'; return; }
    const q = query.trim().toLowerCase();
    const rows = q ? t.rows.filter((r) => Object.values(r).some((v) => String(v).toLowerCase().includes(q))) : t.rows;
    const head = `<thead class="bg-slate-950 text-slate-400 uppercase text-[10px] font-semibold sticky top-0 z-10"><tr><th class="px-2.5 py-2.5 border-r border-slate-800 text-right w-10">#</th>${t.columns.map((c) => `<th class="px-3 py-2.5 border-r border-slate-800 whitespace-nowrap">${esc(c)}</th>`).join('')}</tr></thead>`;
    const body = rows.length
      ? rows.map((r, i) => `<tr class="${i % 2 ? 'bg-slate-900/40' : ''} hover:bg-slate-800/50"><td class="px-2.5 py-2 border-r border-slate-800/70 text-right text-slate-600 font-mono">${i + 1}</td>${t.columns.map((c) => {
          const v = r[c]; const isNum = typeof v === 'number';
          return `<td class="px-3 py-2 border-r border-slate-800/70 ${isNum ? 'text-right font-mono' : ''} max-w-[22rem] truncate" title="${esc(v)}">${esc(v)}</td>`;
        }).join('')}</tr>`).join('')
      : `<tr><td colspan="${t.columns.length + 1}" class="p-8 text-center text-slate-500">${q ? 'No rows match your search.' : 'No rows yet.'}</td></tr>`;
    table.innerHTML = head + `<tbody>${body}</tbody>`;
    document.getElementById('sheet-note').textContent = t.note || '';
    document.getElementById('sheet-count').textContent = `${rows.length}${q ? ` of ${t.count}` : ''} row${rows.length === 1 ? '' : 's'}`;
  }

  function renderDownloadMenu() {
    const menu = document.getElementById('sheet-download-menu');
    if (!menu || !sheet) return;
    const tabTitle = (sheet.tables.find((t) => t.id === activeTab) || {}).title || 'this tab';
    const labels = { xlsx: ['Excel workbook (.xlsx)', 'All tabs in one file'], csv: ['CSV (.csv)', `Just "${tabTitle}"`], tsv: ['TSV (.tsv)', `Just "${tabTitle}"`], json: ['JSON (.json)', `Just "${tabTitle}"`], zip: ['CSV bundle (.zip)', 'One CSV per tab'] };
    menu.innerHTML = Object.keys(sheet.formats).map((f) => `<a href="/api/admin/data/download?format=${f}&sheet=${encodeURIComponent(activeTab || '')}" class="block px-3 py-2 rounded-xl hover:bg-slate-800 text-xs"><span class="font-bold text-white">${esc(labels[f][0])}</span><span class="block text-[11px] text-slate-400">${esc(labels[f][1])}</span></a>`).join('');
  }

  function bindSheet() {
    document.getElementById('sheet-search')?.addEventListener('input', (e) => { query = e.target.value; renderSheet(); });
    document.getElementById('sheet-refresh')?.addEventListener('click', () => loadSheet(true));
    const menu = document.getElementById('sheet-download-menu');
    document.getElementById('sheet-download-btn')?.addEventListener('click', (e) => { e.stopPropagation(); menu.classList.toggle('hidden'); });
    document.addEventListener('click', (e) => { if (menu && !menu.contains(e.target)) menu.classList.add('hidden'); });
    document.getElementById('tab-btn-sheet')?.addEventListener('click', () => loadSheet(!sheet));
  }

  // ------------------------------------------------------------------ payments
  let pay = { singers: [], original: {}, changes: {}, filter: 'all', q: '' };

  async function loadPayments() {
    let data;
    try { data = await api('/api/admin/payments'); } catch (e) { toast(e.message, true); return; }
    pay.singers = data.singers;
    pay.original = Object.fromEntries(data.singers.map((s) => [s.participant_id, { paid: s.paid, note: s.payment_note || '' }]));
    pay.changes = {};
    renderPayments();
  }

  const current = (s) => (pay.changes[s.participant_id] ? { ...pay.original[s.participant_id], ...pay.changes[s.participant_id] } : pay.original[s.participant_id]);

  function renderPayments() {
    const body = document.getElementById('pay-body');
    if (!body) return;
    const q = pay.q.trim().toLowerCase();
    const shown = pay.singers.filter((s) => {
      const c = current(s);
      if (pay.filter === 'paid' && !c.paid) return false;
      if (pay.filter === 'unpaid' && c.paid) return false;
      return !q || s.name.toLowerCase().includes(q);
    });
    body.innerHTML = shown.length ? shown.map((s) => {
      const c = current(s);
      const changed = !!pay.changes[s.participant_id];
      return `<tr class="${changed ? 'bg-amber-500/5' : ''}">
        <td class="px-3.5 py-2.5"><input type="checkbox" class="pay-check w-4 h-4 accent-emerald-500" data-id="${esc(s.participant_id)}" ${c.paid ? 'checked' : ''}></td>
        <td class="px-3.5 py-2.5 font-semibold ${c.paid ? 'text-emerald-300' : 'text-white'}">${esc(s.name)}${s.paid_at && !changed && c.paid ? `<span class="ml-2 text-[10px] text-slate-500 font-normal">${esc(s.paid_at.slice(0, 10))}</span>` : ''}</td>
        <td class="px-3.5 py-2.5 text-slate-400">${esc(s.age_group || '')}</td>
        <td class="px-3.5 py-2.5 text-slate-400 max-w-[18rem] truncate" title="${esc(s.songs.join('; '))}">${esc(s.songs.join('; '))}</td>
        <td class="px-3.5 py-2.5"><input type="text" maxlength="200" data-id="${esc(s.participant_id)}" value="${esc(c.note)}" placeholder="e.g. Zelle" class="pay-note w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-white"></td></tr>`;
    }).join('') : `<tr><td colspan="5" class="p-8 text-center text-slate-500">${pay.singers.length ? 'No one matches.' : 'No singers registered yet.'}</td></tr>`;

    body.querySelectorAll('.pay-check').forEach((el) => el.addEventListener('change', () => setChange(el.dataset.id, { paid: el.checked })));
    body.querySelectorAll('.pay-note').forEach((el) => el.addEventListener('change', () => setChange(el.dataset.id, { note: el.value })));

    const paidNow = pay.singers.filter((s) => current(s).paid).length;
    const total = pay.singers.length;
    document.getElementById('pay-summary').textContent = `${paidNow} of ${total} paid`;
    document.getElementById('pay-bar').style.width = total ? `${Math.round((paidNow / total) * 100)}%` : '0%';
    const n = Object.keys(pay.changes).length;
    document.getElementById('pay-dirty').textContent = n ? `${n} unsaved change${n === 1 ? '' : 's'}` : 'No unsaved changes';
    document.getElementById('pay-save').disabled = !n;
    document.getElementById('pay-discard').disabled = !n;
    const all = document.getElementById('pay-all');
    all.checked = shown.length > 0 && shown.every((s) => current(s).paid);
  }

  function setChange(id, patch) {
    const base = pay.original[id];
    const next = { ...(pay.changes[id] || {}), ...patch };
    const same = (next.paid === undefined || next.paid === base.paid) && (next.note === undefined || next.note === base.note);
    if (same) delete pay.changes[id]; else pay.changes[id] = next;
    renderPayments();
  }

  function bindPayments() {
    document.getElementById('tab-btn-payments')?.addEventListener('click', loadPayments);
    document.getElementById('pay-search')?.addEventListener('input', (e) => { pay.q = e.target.value; renderPayments(); });
    document.querySelectorAll('.pay-filter').forEach((b) => b.addEventListener('click', () => {
      pay.filter = b.dataset.f;
      document.querySelectorAll('.pay-filter').forEach((x) => { x.className = `pay-filter px-3 py-1.5 rounded-lg text-xs font-bold ${x === b ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'}`; });
      renderPayments();
    }));
    document.getElementById('pay-all')?.addEventListener('change', (e) => {
      const q = pay.q.trim().toLowerCase();
      pay.singers.filter((s) => (pay.filter === 'all' || (pay.filter === 'paid') === current(s).paid) && (!q || s.name.toLowerCase().includes(q)))
        .forEach((s) => { const base = pay.original[s.participant_id]; const next = { ...(pay.changes[s.participant_id] || {}), paid: e.target.checked }; if (next.paid === base.paid && (next.note === undefined || next.note === base.note)) delete pay.changes[s.participant_id]; else pay.changes[s.participant_id] = next; });
      renderPayments();
    });
    document.getElementById('pay-discard')?.addEventListener('click', () => { pay.changes = {}; renderPayments(); });
    document.getElementById('pay-save')?.addEventListener('click', async () => {
      const updates = Object.entries(pay.changes).map(([participant_id, c]) => ({ participant_id, paid: c.paid !== undefined ? c.paid : pay.original[participant_id].paid, note: c.note !== undefined ? c.note : undefined }));
      const btn = document.getElementById('pay-save');
      btn.disabled = true;
      try {
        const res = await api('/api/admin/payments', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ updates }) });
        toast(`Saved. ${res.paid} of ${res.total} have paid.`);
        await loadPayments();
        sheet = null; // spreadsheet view will refetch with the Paid column
      } catch (e) { toast(e.message, true); btn.disabled = false; }
    });
    window.addEventListener('beforeunload', (e) => { if (Object.keys(pay.changes).length) { e.preventDefault(); e.returnValue = ''; } });
  }

  // ------------------------------------------------------------------ boot
  document.addEventListener('DOMContentLoaded', () => {
    bindSheet();
    bindPayments();
    if (typeof window.loadAllAdminData === 'function') {
      const original = window.loadAllAdminData;
      window.loadAllAdminData = async function () {
        await original.apply(this, arguments);
        // Logging in to the admin page refreshes the export files and the viewer (also decides whether Payments applies)
        loadSheet(false);
      };
    }
  });
})();
