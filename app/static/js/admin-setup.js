/**
 * Admin extras: data-driven presets with a change preview, the allowed-track-types control,
 * potluck "paste your menu" quick add, and the first-run setup wizard.
 * Loaded after admin-settings.js and uses its globals (adminSettings, showToast, loadSettings, ...).
 */
(function () {
  'use strict';

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

  const ICON = (name, size = 18) => `<i data-lucide="${esc(name)}" width="${size}" height="${size}" aria-hidden="true"></i>`;

  function renderPresets() {
    const grid = document.getElementById('preset-grid');
    if (!grid) return;
    const active = (typeof adminSettings !== 'undefined' && adminSettings && adminSettings.active_preset) || '';
    grid.innerHTML = presets.map((p, index) => `
      <button type="button" role="radio" class="preset-card as-type-card" aria-checked="${selectedPreset === p.id}" tabindex="${selectedPreset === p.id || (!selectedPreset && index === 0) ? '0' : '-1'}" data-preset="${esc(p.id)}">
        <span class="as-type-top"><span class="as-type-icon">${ICON(p.icon)}</span><span class="as-type-name">${esc(p.name)}</span>${active === p.id ? '<span class="as-badge accent">Current</span>' : ''}</span>
        <span class="as-type-tag">${esc(p.tagline)}</span>
      </button>`).join('');
    if (window.lucide) lucide.createIcons();
    const selectPreset = (presetId) => {
      selectedPreset = presetId;
      renderPresets();
      renderPreview();
      const again = Array.from(grid.querySelectorAll('.preset-card')).find((card) => card.dataset.preset === selectedPreset);
      if (again) again.focus();
      document.getElementById('preset-preview')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };
    grid.querySelectorAll('.preset-card').forEach((btn) => {
      btn.addEventListener('click', () => selectPreset(btn.dataset.preset));
      btn.addEventListener('keydown', (event) => {
        const cards = Array.from(grid.querySelectorAll('.preset-card'));
        const current = cards.indexOf(btn);
        let next = current;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (current + 1) % cards.length;
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (current - 1 + cards.length) % cards.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = cards.length - 1;
        else return;
        event.preventDefault();
        selectPreset(cards[next].dataset.preset);
      });
    });
  }

  function renderPreview() {
    const box = document.getElementById('preset-preview');
    const p = presets.find((x) => x.id === selectedPreset);
    if (!box || !p) return;
    box.classList.remove('hidden');
    const rows = p.changes.length
      ? p.changes.map((c) => `<li><span>${esc(c.label)}</span><span><span class="from">${esc(c.from)}</span><span class="as-hidden-label"> changes to </span><span class="arrow" aria-hidden="true"> &rarr; </span><strong class="to">${esc(c.to)}</strong></span></li>`).join('')
      : '<li><span class="none">Everything already matches this preset.</span></li>';
    box.innerHTML = `
      <h2 class="as-preview-title">Change preview: ${esc(p.name)}</h2>
      <p class="as-help">Nothing is applied until you confirm. No data is ever deleted by a preset.</p>
      <ul class="as-changes">${rows}</ul>
      <div class="as-actions">
        <button type="button" id="preset-apply" class="as-btn as-btn-primary grow" ${p.changes.length ? '' : 'disabled'}>Apply preset</button>
        <button type="button" id="preset-cancel" class="as-btn">Cancel</button>
      </div>`;
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
      `<button type="button" class="food-template-btn ap-pill" data-t="${esc(k)}">${esc(labels[k] || k)}</button>`).join('');
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
  const WIZARD_STEP = { type: 1, basics: 2, food: 3, rules: 4, done: 5 };
  let wizardSaveQueue = Promise.resolve();
  let wizardSaveTimer = null;
  let wizardSaveVersion = 0;
  let wizardSaveErrorShown = false;
  let wizardEventId = null;

  function wizardStepNumber() { return WIZARD_STEP[wiz.steps[wiz.step]] || 1; }
  function progressText(step) {
    const safeStep = Math.max(1, Math.min(5, Number(step) || 1));
    return `Step ${safeStep} of 5, ${safeStep * 20}%`;
  }

  function syncWizardOverview() {
    const banner = document.getElementById('overview-wizard-banner');
    const progress = document.getElementById('overview-wizard-progress');
    const s = (typeof adminSettings !== 'undefined' && adminSettings) || {};
    const step = Number(s.wizard_step);
    const d = s.wizard_draft;
    const hasDraft = d && typeof d === 'object' && (
      d.preset !== 'musical_night' || Object.keys(d.basics || {}).length > 0 || Boolean(d.food) ||
      Object.keys(d.rules || {}).length > 0 || Number(s.wizard_step) !== 1
    );
    const show = s.setup_completed !== true && hasDraft && Number.isInteger(step) && step >= 1 && step <= 5;
    if (banner) banner.classList.toggle('hidden', !show);
    if (progress) progress.textContent = show ? `Saved at ${progressText(step)}.` : '';
  }

  function wizardDraft() {
    return { preset: wiz.preset, basics: { ...wiz.basics }, food: String(wiz.food || ''), rules: { ...wiz.rules } };
  }

  function persistWizardState() {
    if (wizardSaveTimer !== null) { clearTimeout(wizardSaveTimer); wizardSaveTimer = null; }
    const version = ++wizardSaveVersion;
    const eventId = wizardEventId;
    const settings = { wizard_step: wizardStepNumber(), wizard_draft: wizardDraft() };
    wizardSaveQueue = wizardSaveQueue.catch(() => false).then(async () => {
      if (!eventId || eventId !== wizardEventId) return false;
      try {
        await api('/api/admin/settings', jsonOpts('PUT', { settings, expected_event_id: eventId }));
        if (version === wizardSaveVersion) {
          adminSettings = { ...((typeof adminSettings !== 'undefined' && adminSettings) || {}), ...settings };
          wizardSaveErrorShown = false;
          syncWizardOverview();
        }
        return true;
      } catch (e) {
        if (version === wizardSaveVersion && !wizardSaveErrorShown) {
          wizardSaveErrorShown = true;
          showToast(`Setup progress was not saved: ${e.message}`, true);
        }
        return false;
      }
    });
    return wizardSaveQueue;
  }

  function scheduleWizardSave() {
    if (wizardSaveTimer !== null) clearTimeout(wizardSaveTimer);
    wizardSaveTimer = setTimeout(() => { wizardSaveTimer = null; persistWizardState(); }, 400);
  }

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

  const STEP_LABEL = { type: 'Type', basics: 'Basics', food: 'Potluck', rules: 'Rules', done: 'Review' };
  const CHECK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  function field(id, label, value, ph = '', cls = '') {
    return `<div class="as-field"><label for="${id}" class="as-label">${label}</label><input id="${id}" value="${esc(value || '')}" placeholder="${esc(ph)}" class="as-input ${cls}"></div>`;
  }

  function stepper(id, label, value, min, max) {
    return `<div class="as-field"><label for="${id}" class="as-label">${label}</label>
      <div class="as-stepper"><button type="button" class="as-step-btn" data-step-target="${id}" data-step="-1" aria-label="Decrease ${esc(label)}">&#8722;</button>
      <input id="${id}" type="number" min="${min}" max="${max}" value="${esc(value)}" inputmode="numeric">
      <button type="button" class="as-step-btn" data-step-target="${id}" data-step="1" aria-label="Increase ${esc(label)}">+</button></div></div>`;
  }

  function renderWizard() {
    wiz.steps = wizardSteps();
    const kind = wiz.steps[wiz.step];
    const body = document.getElementById('wizard-body');
    document.getElementById('wizard-dots').innerHTML = wiz.steps.map((k, i) => {
      const state = i < wiz.step ? 'done' : (i === wiz.step ? 'current' : '');
      const line = i > 0 ? `<li class="as-step-line ${i <= wiz.step ? 'done' : ''}" aria-hidden="true"></li>` : '';
      return `${line}<li class="as-step ${state}" ${state === 'current' ? 'aria-current="step"' : ''}><span class="as-step-dot">${state === 'done' ? CHECK : i + 1}</span><span class="as-step-label">${STEP_LABEL[k]}${state === 'done' ? '<span class="as-hidden-label"> (done)</span>' : ''}</span></li>`;
    }).join('');
    document.getElementById('wizard-sub').textContent = `Setup wizard \u00b7 ${progressText(wizardStepNumber())}`;
    document.getElementById('wizard-back').classList.toggle('invisible', wiz.step === 0);
    const next = document.getElementById('wizard-next');
    const following = wiz.steps[wiz.step + 1];
    next.textContent = kind === 'done' ? 'Finish' : (following === 'done' ? 'Review' : `Next: ${STEP_LABEL[following]}`);
    const s = (typeof adminSettings !== 'undefined' && adminSettings) || {};

    if (kind === 'type') {
      document.getElementById('wizard-title').textContent = 'What kind of event is this?';
      body.innerHTML = `<div class="as-type-grid" role="group" aria-label="Event type">${presets.filter((p) => p.id !== 'freeze' && p.id !== 'rehearsal').map((p) => `
        <button type="button" class="wiz-type as-type-card" aria-pressed="${wiz.preset === p.id}" data-id="${esc(p.id)}">
          <span class="as-type-top"><span class="as-type-icon">${ICON(p.icon)}</span><span class="as-type-name">${esc(p.name)}</span></span>
          <span class="as-type-tag">${esc(p.tagline)}</span></button>`).join('')}</div>`;
      body.querySelectorAll('.wiz-type').forEach((b) => b.addEventListener('click', () => {
        wiz.preset = b.dataset.id; renderWizard(); persistWizardState();
        document.querySelector(`#wizard-body [data-id="${wiz.preset}"]`)?.focus();
      }));
    } else if (kind === 'basics') {
      document.getElementById('wizard-title').textContent = 'The basics';
      body.innerHTML = `<p class="as-dialog-sub" style="margin:0">Guests see these on the home page. You can change them later in Setup &amp; Rules.</p>
        ${field('wz-name', 'Event name', wiz.basics.event_name ?? s.event_name, 'Summer Talent Night')}
        ${field('wz-sub', 'Tagline / date line', wiz.basics.event_subtitle ?? s.event_subtitle, 'Community showcase \u2022 June 14')}
        <div class="as-row2">
          ${field('wz-start', 'Start (MM-DD-YYYY HH:MMAM)', wiz.basics.event_start_time ?? s.event_start_time, '06-14-2026 06:00PM', 'as-mono')}
          ${field('wz-range', 'Time range', wiz.basics.event_time_range ?? s.event_time_range, '6:00 PM - 9:00 PM EDT')}
        </div>
        ${field('wz-venue', 'Venue', wiz.basics.event_venue ?? s.event_venue, 'Community Hall, 12 Main St')}`;
    } else if (kind === 'food') {
      document.getElementById('wizard-title').textContent = 'Potluck menu';
      body.innerHTML = `<p class="as-dialog-sub" style="margin:0">Paste your menu, or start from a template. One item per line, <code class="as-code">Group:</code> to start a group, <code class="as-code">x3</code> for several slots. You can skip this and add items later.</p>
        <div class="as-chips">${Object.keys(foodTemplates).map((k) => `<button type="button" class="wiz-food-t as-btn as-btn-sm" data-t="${esc(k)}">${esc(k)}</button>`).join('')}</div>
        <div class="as-field"><label for="wz-food" class="as-label">Menu, one item per line</label><textarea id="wz-food" rows="9" class="as-textarea as-mono">${esc(wiz.food)}</textarea></div>`;
      body.querySelectorAll('.wiz-food-t').forEach((b) => b.addEventListener('click', () => { document.getElementById('wz-food').value = foodTemplates[b.dataset.t]; }));
    } else if (kind === 'rules') {
      document.getElementById('wizard-title').textContent = 'Sign-up rules';
      const preset = presets.find((x) => x.id === wiz.preset);
      const defaults = wiz.rules.max_performances_per_participant != null ? wiz.rules : { max_performances_per_participant: s.max_performances_per_participant || 2, max_solo_per_participant: s.max_solo_per_participant ?? 1, allowed_media: s.allowed_media || ['audio', 'video'] };
      body.innerHTML = `<div class="as-row2">
        ${stepper('wz-max', 'Songs per person (at most)', defaults.max_performances_per_participant, 1, 20)}
        ${stepper('wz-solo', 'Of those, solos (at most)', defaults.max_solo_per_participant, 0, 20)}</div>
        <fieldset class="as-fieldset"><legend class="as-label">Backing tracks people can upload</legend><div class="as-chips">
          <label class="as-check"><input type="checkbox" id="wz-audio" ${defaults.allowed_media.includes('audio') ? 'checked' : ''}><span>Audio</span></label>
          <label class="as-check"><input type="checkbox" id="wz-video" ${defaults.allowed_media.includes('video') ? 'checked' : ''}><span>Video</span></label></div></fieldset>
        <p class="as-help">Preset "${esc(preset ? preset.name : '')}" sets sensible defaults; change them here if you like.</p>`;
    } else {
      document.getElementById('wizard-title').textContent = 'Ready to go';
      const p = presets.find((x) => x.id === wiz.preset);
      const foodCount = (wiz.food || '').split('\n').filter((l) => l.trim() && !l.trim().endsWith(':')).length;
      body.innerHTML = `<div class="as-summary">
        <div class="as-summary-row"><span>Event type</span><strong>${esc(p ? p.name : '')}</strong></div>
        <div class="as-summary-row"><span>Name</span><strong>${esc(wiz.basics.event_name || s.event_name || '')}</strong></div>
        ${wiz.rules.max_performances_per_participant != null ? `<div class="as-summary-row"><span>Songs per person</span><strong>${wiz.rules.max_performances_per_participant} (${wiz.rules.max_solo_per_participant} solo)</strong></div>` : ''}
        ${foodCount ? `<div class="as-summary-row"><span>Potluck items to add</span><strong>${foodCount} lines</strong></div>` : ''}</div>
        <p class="as-dialog-sub" style="margin:0">Finish applies the preset, saves these details, and opens your event. Share <code class="as-code">/signup</code> with participants.</p>`;
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
      const progressSaved = await persistWizardState();
      if (!progressSaved) throw new Error('Setup progress could not be saved. Try again before finishing.');
      await api('/api/admin/apply-preset', jsonOpts('POST', { preset: wiz.preset, expected_event_id: wizardEventId }));
      const settingsPayload = { setup_completed: true, wizard_step: 5, wizard_draft: wizardDraft() };
      Object.entries(wiz.basics).forEach(([k, v]) => { if (v) settingsPayload[k] = v; });
      if (wiz.rules.max_performances_per_participant != null) Object.assign(settingsPayload, wiz.rules);
      if ((wiz.food || '').trim()) await api('/api/admin/food-items/bulk', jsonOpts('POST', { text: wiz.food, expected_event_id: wizardEventId }));
      await api('/api/admin/settings', jsonOpts('PUT', { settings: settingsPayload, expected_event_id: wizardEventId }));
      adminSettings = { ...((typeof adminSettings !== 'undefined' && adminSettings) || {}), ...settingsPayload };
      closeWizard(false);
      showToast('Event set up. Share /signup with participants.');
      if (typeof loadAllAdminData === 'function') await loadAllAdminData();
    } catch (e) {
      showToast(e.message, true);
    } finally {
      btn.disabled = false;
    }
  }

  function openWizard() {
    const s = (typeof adminSettings !== 'undefined' && adminSettings) || {};
    wizardEventId = s.active_event_id || null;
    const draft = s.setup_completed === true ? null : s.wizard_draft;
    if (draft && typeof draft === 'object') {
      const knownPreset = presets.some((p) => p.id === draft.preset && !['freeze', 'rehearsal'].includes(p.id));
      wiz.preset = knownPreset ? draft.preset : 'musical_night';
      wiz.basics = draft.basics && typeof draft.basics === 'object' ? { ...draft.basics } : {};
      wiz.food = typeof draft.food === 'string' ? draft.food : '';
      wiz.rules = draft.rules && typeof draft.rules === 'object' ? { ...draft.rules } : {};
    } else {
      wiz.preset = 'musical_night'; wiz.basics = {}; wiz.food = ''; wiz.rules = {};
    }
    wiz.steps = wizardSteps();
    const requestedStep = Math.max(1, Math.min(5, Number(s.wizard_step) || 1));
    let idx = wiz.steps.findIndex((step) => WIZARD_STEP[step] === requestedStep);
    if (idx < 0) idx = wiz.steps.reduce((last, step, i) => WIZARD_STEP[step] <= requestedStep ? i : last, 0);
    wiz.step = draft ? idx : 0;
    document.getElementById('setup-wizard').classList.remove('hidden');
    renderWizard();
    persistWizardState();
    focusWizardTitle();
  }
  function focusWizardTitle() { document.getElementById('wizard-title')?.focus(); }
  function closeWizard(save = true) {
    if (save) {
      try { collectStep(); } catch (e) { /* Current controls may not be mounted during boot. */ }
      persistWizardState();
    }
    document.getElementById('setup-wizard').classList.add('hidden');
    try { sessionStorage.setItem('wizard_dismissed', '1'); } catch (e) { /* ignore */ }
    syncWizardOverview();
  }

  function bindWizard() {
    document.getElementById('open-wizard-btn')?.addEventListener('click', openWizard);
    document.getElementById('overview-wizard-resume')?.addEventListener('click', openWizard);
    document.getElementById('wizard-close')?.addEventListener('click', closeWizard);
    document.getElementById('wizard-skip')?.addEventListener('click', closeWizard);
    document.addEventListener('etm:settings-loaded', syncWizardOverview);
    document.getElementById('wizard-body')?.addEventListener('input', () => {
      collectStep();
      scheduleWizardSave();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !document.getElementById('setup-wizard')?.classList.contains('hidden')) closeWizard();
    });
    document.addEventListener('click', (e) => {
      const b = e.target.closest ? e.target.closest('[data-step-target]') : null;
      const inp = b && document.getElementById(b.dataset.stepTarget);
      if (!inp) return;
      const min = inp.min !== '' ? Number(inp.min) : -Infinity;
      const max = inp.max !== '' ? Number(inp.max) : Infinity;
      let v = parseInt(inp.value, 10);
      if (Number.isNaN(v)) v = Number.isFinite(min) ? min : 0;
      inp.value = Math.min(max, Math.max(min, v + Number(b.dataset.step)));
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    });
    document.getElementById('wizard-back')?.addEventListener('click', () => { collectStep(); wiz.step = Math.max(0, wiz.step - 1); renderWizard(); persistWizardState(); focusWizardTitle(); });
    document.getElementById('wizard-next')?.addEventListener('click', async () => {
      collectStep();
      if (wiz.steps[wiz.step] === 'done') { await finishWizard(); return; }
      wiz.step = Math.min(wiz.steps.length - 1, wiz.step + 1);
      renderWizard();
      persistWizardState();
      focusWizardTitle();
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
  // Where each check is fixed: a tab id, or "wizard". Checks fixed outside the app (PIN in .env) have no link.
  const FIX_TARGET = {
    storage: ['system', 'Open System'], disk: ['system', 'Open System'], db_integrity: ['system', 'Open System'],
    ffmpeg: ['system', 'Open System'], ffprobe: ['system', 'Open System'], downloader: ['system', 'Open System'],
    acts: ['lineup', 'Open Lineup'], songs: ['lineup', 'Open Lineup'], tracks: ['lineup', 'Open Lineup'],
    track_files: ['lineup', 'Open Lineup'], incoming: ['lineup', 'Match files in Lineup'],
    backup: ['backup', 'Open Backups'], wizard: ['wizard', 'Resume setup'],
  };
  window.readinessFixTarget = (id) => FIX_TARGET[id] || null;

  async function loadReadiness() {
    const card = document.getElementById('readiness-card');
    if (!card) return;
    let data;
    try { data = await api('/api/admin/readiness'); } catch (e) {
      card.innerHTML = '<p class="ad-card-s">Could not check readiness right now. It will retry in a minute.</p>';
      return;
    }
    window.__readinessData = data;
    renderReadiness(data);
    document.dispatchEvent(new CustomEvent('etm:readiness', { detail: data }));
  }

  // Overview shows what needs attention plus a couple of passing checks; "Show all" expands the full checklist.
  let readinessFull = false;
  function renderReadiness(data) {
    const card = document.getElementById('readiness-card');
    if (!card || !data) return;
    const issues = data.counts.warn + data.counts.error;
    const label = { ok: 'OK', warn: 'To fix', error: 'Fix now', info: 'Info' };
    const glyph = { ok: '✓', warn: '!', error: '✕', info: 'i' };
    const order = { error: 0, warn: 1, info: 2, ok: 3 };
    const checks = data.checks.slice().sort((x, y) => order[x.status] - order[y.status]);
    const shown = readinessFull ? checks : checks.filter((c) => c.status === 'error' || c.status === 'warn').concat(checks.filter((c) => c.status === 'ok').slice(0, issues ? 2 : 3));
    const pill = issues ? `<span class="ad-pill ${data.counts.error ? 'err' : 'warn'}">${issues} to fix</span>` : '<span class="ad-pill ok">All good</span>';
    card.classList.toggle('is-full', readinessFull);
    card.innerHTML = `
      <div class="ad-card-h" role="status"><h2 class="ad-card-t" id="ov-ready-title">Ready for doors?</h2>${pill}</div>
      <ul class="rd-list">${shown.map((c) => {
        const fix = FIX_TARGET[c.id];
        return `<li class="rd-row">
          <span class="rd-ico rd-${esc(c.status)}" role="img" aria-label="${esc(label[c.status] || c.status)}">${glyph[c.status] || 'i'}</span>
          <div class="rd-main"><span class="rd-label">${esc(c.label)}</span><span class="rd-detail">${esc(c.detail)}</span>
            ${readinessFull && c.fix ? `<span class="rd-fix"><strong>Fix:</strong> ${esc(c.fix)}</span>` : ''}</div>
          ${fix && c.status !== 'ok' ? `<button type="button" class="rd-link" data-fix="${esc(fix[0])}">${esc(fix[1])}</button>` : ''}
          ${readinessFull ? `<span class="rd-status rd-${esc(c.status)}">${esc(label[c.status] || c.status)}</span>` : ''}</li>`;
      }).join('')}</ul>
      ${checks.length > shown.length || readinessFull ? `<button type="button" id="readiness-toggle" class="rd-link rd-more" aria-expanded="${readinessFull}">${readinessFull ? 'Show fewer checks' : `Show all ${checks.length} checks`}</button>` : ''}`;
    card.querySelectorAll('[data-fix]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.fix === 'wizard') openWizard();
      else if (typeof window.showAdminTab === 'function') window.showAdminTab(b.dataset.fix);
    }));
    document.getElementById('readiness-toggle')?.addEventListener('click', () => { readinessFull = !readinessFull; renderReadiness(data); document.getElementById('readiness-toggle')?.focus(); });
  }

  window.loadReadiness = loadReadiness;

  // ------------------------------------------------------------------ boot
  async function initExtras() {
    loadReadiness();
    if (!window.__readinessTimer) window.__readinessTimer = setInterval(loadReadiness, 60000);
    syncAllowedMediaUI();
    await loadPresets();
    syncWizardOverview();
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
