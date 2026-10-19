/**
 * Admin extras: data-driven presets with a change preview, the allowed-track-types control,
 * potluck "paste your menu" quick add, and the first-run setup wizard.
 * Loaded after admin-settings.js and uses its globals (adminSettings, showToast, loadSettings, ...).
 */
(function () {
  'use strict';

  const ACCENTS = {
    orange: 'bg-orange-500/20 text-orange-400', indigo: 'bg-indigo-500/20 text-indigo-400', emerald: 'bg-emerald-500/20 text-emerald-400',
    sky: 'bg-sky-500/20 text-sky-400', pink: 'bg-pink-500/20 text-pink-400', purple: 'bg-purple-500/20 text-purple-400',
    amber: 'bg-amber-500/20 text-amber-400', rose: 'bg-rose-500/20 text-rose-400',
  };
  const esc = (v) => (window.escapeHtml ? window.escapeHtml(v) : String(v));
  const api = async (path, opts) => {
    const res = await fetch(path, opts);
    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) throw new Error((data && data.detail) || `Request failed (${res.status})`);
    return data;
  };
  const jsonOpts = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  let presets = [];
  let selectedPreset = null;
  let foodTemplates = {};

  // ------------------------------------------------------------------ allowed media
  window.readAllowedMedia = function () {
    const out = [];
    if (document.getElementById('allowed-media-audio')?.checked) out.push('audio');
    if (document.getElementById('allowed-media-video')?.checked) out.push('video');
    return out.length ? out : ['audio', 'video'];
  };
  function syncAllowedMediaUI() {
    const allowed = (typeof adminSettings !== 'undefined' && adminSettings && adminSettings.allowed_media) || ['audio', 'video'];
    const a = document.getElementById('allowed-media-audio');
    const v = document.getElementById('allowed-media-video');
    if (a) a.checked = allowed.includes('audio');
    if (v) v.checked = allowed.includes('video');
  }

  // ------------------------------------------------------------------ presets
  async function loadPresets() {
    try {
      presets = await api('/api/admin/presets');
    } catch (e) { return; }
    renderPresets();
  }

  function renderPresets() {
    const grid = document.getElementById('preset-grid');
    if (!grid) return;
    const active = (typeof adminSettings !== 'undefined' && adminSettings && adminSettings.active_preset) || '';
    grid.innerHTML = presets.map((p) => `
      <button type="button" class="preset-card p-3.5 rounded-2xl text-left transition border ${selectedPreset === p.id ? 'bg-slate-800 border-orange-500/60' : 'bg-slate-950 hover:bg-slate-800/80 border-slate-800'}" data-preset="${esc(p.id)}">
        <div class="flex items-start gap-3">
          <div class="w-9 h-9 rounded-xl ${ACCENTS[p.accent] || ACCENTS.orange} flex items-center justify-center shrink-0"><i data-lucide="${esc(p.icon)}" class="w-4 h-4"></i></div>
          <div class="min-w-0">
            <h4 class="text-xs font-bold text-white flex items-center gap-1.5">${esc(p.name)}${active === p.id ? '<span class="px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[9px]">CURRENT</span>' : ''}</h4>
            <p class="text-[11px] text-slate-400 leading-snug mt-0.5">${esc(p.tagline)}</p>
          </div>
        </div>
      </button>`).join('');
    if (window.lucide) lucide.createIcons();
    grid.querySelectorAll('.preset-card').forEach((btn) => btn.addEventListener('click', () => {
      selectedPreset = btn.dataset.preset;
      renderPresets();
      renderPreview();
    }));
  }

  function renderPreview() {
    const box = document.getElementById('preset-preview');
    const p = presets.find((x) => x.id === selectedPreset);
    if (!box || !p) return;
    box.classList.remove('hidden');
    const rows = p.changes.length
      ? p.changes.map((c) => `<li class="flex items-center justify-between gap-3 py-1.5 border-b border-slate-800/70 last:border-0"><span class="text-slate-300">${esc(c.label)}</span><span class="font-mono text-[11px]"><span class="text-slate-500">${esc(c.from)}</span> <span class="text-slate-600">→</span> <span class="text-orange-300 font-bold">${esc(c.to)}</span></span></li>`).join('')
      : '<li class="py-2 text-emerald-300">Everything already matches this preset.</li>';
    box.innerHTML = `
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <h4 class="text-sm font-bold text-white">${esc(p.name)}: what will change</h4>
        <div class="flex gap-2">
          <button type="button" id="preset-cancel" class="px-3 py-1.5 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold">Cancel</button>
          <button type="button" id="preset-apply" class="px-4 py-1.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold shadow" ${p.changes.length ? '' : 'disabled'}>Apply preset</button>
        </div>
      </div>
      <ul class="text-xs">${rows}</ul>`;
    document.getElementById('preset-cancel').onclick = () => { selectedPreset = null; box.classList.add('hidden'); renderPresets(); };
    document.getElementById('preset-apply').onclick = async () => {
      try {
        await api('/api/admin/apply-preset', jsonOpts('POST', { preset: p.id }));
        showToast(`"${p.name}" applied`);
        selectedPreset = null;
        box.classList.add('hidden');
        await refreshAll();
      } catch (e) { showToast(e.message, true); }
    };
  }

  async function refreshAll() {
    if (typeof loadSettings === 'function') await loadSettings();
    syncAllowedMediaUI();
    await loadPresets();
  }

  // ------------------------------------------------------------------ potluck quick add
  async function initFoodQuickAdd() {
    const holder = document.getElementById('food-template-buttons');
    if (!holder) return;
    try { foodTemplates = await api('/api/admin/food-templates'); } catch (e) { return; }
    const labels = { indian: 'Indian potluck', bbq: 'BBQ', thanksgiving: 'Thanksgiving', simple: 'Simple (4 mains, 4 sides...)' };
    holder.innerHTML = Object.keys(foodTemplates).map((k) =>
      `<button type="button" class="food-template-btn px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold border border-slate-700" data-t="${esc(k)}">${esc(labels[k] || k)}</button>`).join('');
    holder.querySelectorAll('.food-template-btn').forEach((b) => b.addEventListener('click', () => {
      document.getElementById('bulk-food-text').value = foodTemplates[b.dataset.t];
    }));
    document.getElementById('bulk-food-submit').onclick = async () => {
      const text = document.getElementById('bulk-food-text').value;
      try {
        const res = await api('/api/admin/food-items/bulk', jsonOpts('POST', { text }));
        showToast(`Added ${res.added} item(s)` + (res.skipped.length ? `, skipped ${res.skipped.length} duplicate(s)` : ''));
        document.getElementById('bulk-food-text').value = '';
        if (typeof loadFoodGroups === 'function') await loadFoodGroups();
        if (typeof loadFoodItems === 'function') await loadFoodItems();
      } catch (e) { showToast(e.message, true); }
    };
  }

  // ------------------------------------------------------------------ setup wizard
  const wiz = { step: 0, preset: 'musical_night', basics: {}, food: '', rules: {}, steps: [] };

  function wizardSteps() {
    const p = presets.find((x) => x.id === wiz.preset);
    const foodOn = wiz.preset === 'potluck' || wiz.preset === 'musical_night' || wiz.preset === 'acoustic';
    const showOn = wiz.preset !== 'potluck';
    const steps = ['type', 'basics'];
    if (foodOn) steps.push('food');
    if (showOn) steps.push('rules');
    steps.push('done');
    return steps;
  }

  function field(id, label, value, ph = '') {
    return `<label class="block"><span class="block font-semibold text-slate-300 mb-1">${label}</span><input id="${id}" value="${esc(value || '')}" placeholder="${esc(ph)}" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white"></label>`;
  }

  function renderWizard() {
    wiz.steps = wizardSteps();
    const kind = wiz.steps[wiz.step];
    const body = document.getElementById('wizard-body');
    document.getElementById('wizard-dots').innerHTML = wiz.steps.map((_, i) => `<span class="h-1.5 flex-1 rounded-full ${i <= wiz.step ? 'bg-orange-500' : 'bg-slate-700'}"></span>`).join('');
    document.getElementById('wizard-back').classList.toggle('invisible', wiz.step === 0);
    const next = document.getElementById('wizard-next');
    next.textContent = kind === 'done' ? 'Finish' : (wiz.step === wiz.steps.length - 2 ? 'Review' : 'Next');
    const s = (typeof adminSettings !== 'undefined' && adminSettings) || {};

    if (kind === 'type') {
      document.getElementById('wizard-title').textContent = 'What kind of event is this?';
      body.innerHTML = `<div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">${presets.filter((p) => p.id !== 'freeze' && p.id !== 'rehearsal').map((p) => `
        <button type="button" class="wiz-type p-3.5 rounded-2xl text-left border transition ${wiz.preset === p.id ? 'bg-slate-800 border-orange-500/60' : 'bg-slate-950 border-slate-800 hover:bg-slate-800/70'}" data-id="${esc(p.id)}">
          <div class="flex items-start gap-3"><div class="w-9 h-9 rounded-xl ${ACCENTS[p.accent]} flex items-center justify-center shrink-0"><i data-lucide="${esc(p.icon)}" class="w-4 h-4"></i></div>
          <div><h4 class="font-bold text-white text-xs">${esc(p.name)}</h4><p class="text-[11px] text-slate-400 mt-0.5">${esc(p.tagline)}</p></div></div></button>`).join('')}</div>`;
      body.querySelectorAll('.wiz-type').forEach((b) => b.addEventListener('click', () => { wiz.preset = b.dataset.id; renderWizard(); }));
    } else if (kind === 'basics') {
      document.getElementById('wizard-title').textContent = 'The basics';
      body.innerHTML = `<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div class="sm:col-span-2">${field('wz-name', 'Event name', wiz.basics.event_name ?? s.event_name, 'Summer Talent Night')}</div>
        <div class="sm:col-span-2">${field('wz-sub', 'Tagline / date line', wiz.basics.event_subtitle ?? s.event_subtitle, 'Community showcase • June 14')}</div>
        ${field('wz-start', 'Start (MM-DD-YYYY HH:MMAM)', wiz.basics.event_start_time ?? s.event_start_time, '06-14-2026 06:00PM')}
        ${field('wz-range', 'Time range', wiz.basics.event_time_range ?? s.event_time_range, '6:00 PM - 9:00 PM EDT')}
        <div class="sm:col-span-2">${field('wz-venue', 'Venue', wiz.basics.event_venue ?? s.event_venue, 'Community Hall, 12 Main St')}</div></div>`;
    } else if (kind === 'food') {
      document.getElementById('wizard-title').textContent = 'Potluck menu';
      body.innerHTML = `<p class="text-slate-400">Paste your menu, or start from a template. One item per line, <code class="text-emerald-300">Group:</code> to start a group, <code class="text-emerald-300">x3</code> for several slots. You can skip this and add items later.</p>
        <div class="flex flex-wrap gap-1.5">${Object.keys(foodTemplates).map((k) => `<button type="button" class="wiz-food-t px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold border border-slate-700" data-t="${esc(k)}">${esc(k)}</button>`).join('')}</div>
        <textarea id="wz-food" rows="9" class="w-full bg-slate-950 border border-slate-700 rounded-2xl px-3.5 py-3 text-white font-mono">${esc(wiz.food)}</textarea>`;
      body.querySelectorAll('.wiz-food-t').forEach((b) => b.addEventListener('click', () => { document.getElementById('wz-food').value = foodTemplates[b.dataset.t]; }));
    } else if (kind === 'rules') {
      document.getElementById('wizard-title').textContent = 'Sign-up rules';
      const preset = presets.find((x) => x.id === wiz.preset);
      const defaults = wiz.rules.max_performances_per_participant != null ? wiz.rules : { max_performances_per_participant: s.max_performances_per_participant || 2, max_solo_per_participant: s.max_solo_per_participant ?? 1, allowed_media: s.allowed_media || ['audio', 'video'] };
      body.innerHTML = `<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label class="block"><span class="block font-semibold text-slate-300 mb-1">Songs per person (at most)</span><input id="wz-max" type="number" min="1" max="20" value="${defaults.max_performances_per_participant}" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white"></label>
        <label class="block"><span class="block font-semibold text-slate-300 mb-1">Of those, solos (at most)</span><input id="wz-solo" type="number" min="0" max="20" value="${defaults.max_solo_per_participant}" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white"></label></div>
        <div><span class="block font-semibold text-slate-300 mb-1.5">Backing tracks people can upload</span><div class="flex flex-wrap gap-3">
          <label class="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-950 border border-slate-800"><input type="checkbox" id="wz-audio" ${defaults.allowed_media.includes('audio') ? 'checked' : ''}> Audio</label>
          <label class="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-950 border border-slate-800"><input type="checkbox" id="wz-video" ${defaults.allowed_media.includes('video') ? 'checked' : ''}> Video</label></div></div>
        <p class="text-[11px] text-slate-500">Preset "${esc(preset ? preset.name : '')}" sets sensible defaults; change them here if you like.</p>`;
    } else {
      document.getElementById('wizard-title').textContent = 'Ready to go';
      const p = presets.find((x) => x.id === wiz.preset);
      const foodCount = (wiz.food || '').split('\n').filter((l) => l.trim() && !l.trim().endsWith(':')).length;
      body.innerHTML = `<div class="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
        <div class="flex justify-between"><span class="text-slate-400">Event type</span><strong class="text-white">${esc(p ? p.name : '')}</strong></div>
        <div class="flex justify-between"><span class="text-slate-400">Name</span><strong class="text-white text-right">${esc(wiz.basics.event_name || s.event_name || '')}</strong></div>
        ${wiz.rules.max_performances_per_participant != null ? `<div class="flex justify-between"><span class="text-slate-400">Songs per person</span><strong class="text-white">${wiz.rules.max_performances_per_participant} (${wiz.rules.max_solo_per_participant} solo)</strong></div>` : ''}
        ${foodCount ? `<div class="flex justify-between"><span class="text-slate-400">Potluck items to add</span><strong class="text-white">${foodCount} lines</strong></div>` : ''}</div>
        <p class="text-slate-400">Finish applies the preset, saves these details, and opens your event. Share <code class="text-orange-300">/signup</code> with participants.</p>`;
    }
    if (window.lucide) lucide.createIcons();
  }

  function collectStep() {
    const kind = wiz.steps[wiz.step];
    if (kind === 'basics') {
      wiz.basics = {
        event_name: document.getElementById('wz-name').value.trim(),
        event_subtitle: document.getElementById('wz-sub').value.trim(),
        event_start_time: document.getElementById('wz-start').value.trim(),
        event_time_range: document.getElementById('wz-range').value.trim(),
        event_venue: document.getElementById('wz-venue').value.trim(),
      };
    } else if (kind === 'food') {
      wiz.food = document.getElementById('wz-food').value;
    } else if (kind === 'rules') {
      const media = [];
      if (document.getElementById('wz-audio').checked) media.push('audio');
      if (document.getElementById('wz-video').checked) media.push('video');
      wiz.rules = {
        max_performances_per_participant: parseInt(document.getElementById('wz-max').value, 10) || 1,
        max_solo_per_participant: parseInt(document.getElementById('wz-solo').value, 10) || 0,
        allowed_media: media.length ? media : ['audio', 'video'],
      };
    }
  }

  async function finishWizard() {
    const btn = document.getElementById('wizard-next');
    btn.disabled = true;
    try {
      await api('/api/admin/apply-preset', jsonOpts('POST', { preset: wiz.preset }));
      const settingsPayload = { setup_completed: true };
      Object.entries(wiz.basics).forEach(([k, v]) => { if (v) settingsPayload[k] = v; });
      if (wiz.rules.max_performances_per_participant != null) Object.assign(settingsPayload, wiz.rules);
      await api('/api/admin/settings', jsonOpts('PUT', { settings: settingsPayload }));
      if ((wiz.food || '').trim()) await api('/api/admin/food-items/bulk', jsonOpts('POST', { text: wiz.food }));
      closeWizard();
      showToast('Event set up. Share /signup with participants.');
      if (typeof loadAllAdminData === 'function') await loadAllAdminData();
    } catch (e) {
      showToast(e.message, true);
    } finally {
      btn.disabled = false;
    }
  }

  function openWizard() {
    wiz.step = 0;
    document.getElementById('setup-wizard').classList.remove('hidden');
    renderWizard();
  }
  function closeWizard() {
    document.getElementById('setup-wizard').classList.add('hidden');
    try { sessionStorage.setItem('wizard_dismissed', '1'); } catch (e) { /* ignore */ }
  }

  function bindWizard() {
    document.getElementById('open-wizard-btn')?.addEventListener('click', openWizard);
    document.getElementById('wizard-close')?.addEventListener('click', closeWizard);
    document.getElementById('wizard-back')?.addEventListener('click', () => { collectStep(); wiz.step = Math.max(0, wiz.step - 1); renderWizard(); });
    document.getElementById('wizard-next')?.addEventListener('click', async () => {
      collectStep();
      if (wiz.steps[wiz.step] === 'done') { await finishWizard(); return; }
      wiz.step = Math.min(wiz.steps.length - 1, wiz.step + 1);
      renderWizard();
    });
  }

  async function maybeAutoOpenWizard() {
    let dismissed = false;
    try { dismissed = sessionStorage.getItem('wizard_dismissed') === '1'; } catch (e) { /* ignore */ }
    const done = typeof adminSettings !== 'undefined' && adminSettings && adminSettings.setup_completed === true;
    if (dismissed || done) return;
    try {
      const summary = await api('/api/admin/summary');
      if ((summary.total_performances || 0) === 0 && (summary.food_taken || 0) === 0) openWizard();
    } catch (e) { /* ignore */ }
  }

  // ------------------------------------------------------------------ readiness
  let readinessOpen = false;
  async function loadReadiness() {
    const card = document.getElementById('readiness-card');
    if (!card) return;
    let data;
    try { data = await api('/api/admin/readiness'); } catch (e) { return; }
    const tone = { ok: ['border-emerald-500/30', 'text-emerald-300', 'check-circle-2'], warn: ['border-amber-500/40', 'text-amber-300', 'alert-triangle'], error: ['border-rose-500/50', 'text-rose-300', 'x-circle'] }[data.overall];
    const dot = { ok: 'text-emerald-400', warn: 'text-amber-400', error: 'text-rose-400', info: 'text-sky-400' };
    const icon = { ok: 'check', warn: 'alert-triangle', error: 'x-circle', info: 'info' };
    const issues = data.counts.warn + data.counts.error;
    card.className = `rounded-2xl border bg-slate-900/90 overflow-hidden ${tone[0]}`;
    card.innerHTML = `
      <button type="button" id="readiness-toggle" class="w-full px-4 py-3 flex items-center justify-between gap-3 text-left">
        <span class="flex items-center gap-2.5 text-xs font-bold ${tone[1]}"><i data-lucide="${tone[2]}" class="w-4 h-4"></i>
          ${data.overall === 'ok' ? 'Event readiness: all good' : `Event readiness: ${issues} thing${issues === 1 ? '' : 's'} to check`}</span>
        <i data-lucide="${readinessOpen ? 'chevron-up' : 'chevron-down'}" class="w-4 h-4 text-slate-400"></i>
      </button>
      <ul class="${readinessOpen ? '' : 'hidden'} border-t border-slate-800 divide-y divide-slate-800/70 text-xs">
        ${data.checks.map((c) => `<li class="px-4 py-2.5 flex gap-3"><i data-lucide="${icon[c.status]}" class="w-4 h-4 mt-0.5 shrink-0 ${dot[c.status]}"></i>
          <div class="min-w-0"><div class="font-semibold text-white">${esc(c.label)}</div><div class="text-slate-400">${esc(c.detail)}</div>${c.fix ? `<div class="text-slate-500 mt-0.5">Fix: ${esc(c.fix)}</div>` : ''}</div></li>`).join('')}
      </ul>`;
    if (window.lucide) lucide.createIcons();
    document.getElementById('readiness-toggle').onclick = () => { readinessOpen = !readinessOpen; loadReadiness(); };
  }

  // ------------------------------------------------------------------ boot
  async function initExtras() {
    loadReadiness();
    if (!window.__readinessTimer) window.__readinessTimer = setInterval(loadReadiness, 60000);
    syncAllowedMediaUI();
    await loadPresets();
    await initFoodQuickAdd();
    await maybeAutoOpenWizard();
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindWizard();
    if (typeof window.loadAllAdminData === 'function') {
      const original = window.loadAllAdminData;
      window.loadAllAdminData = async function () {
        await original.apply(this, arguments);
        await initExtras();
      };
    }
  });
})();
