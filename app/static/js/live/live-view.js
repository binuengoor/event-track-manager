// Venue /live screen view: SSE + poll + etm-live BroadcastChannel feed one render path.
// Public screen: no navigation, no admin calls, no ages, no stage notes, no contact numbers.
(function () {
  'use strict';
  const L = window.EtmLive;
  const $ = (id) => document.getElementById(id);
  const esc = window.escapeHtml;

  let state = { status: null, announcement: '' };
  let targetStartTime = new Date('2026-09-19T17:00:00-04:00');
  let showCompleted = false;
  let galleryImages = [];
  let galleryIndex = 0;
  let galleryTimer = null;
  let lastServerOk = 0;
  let lastChannelAt = 0;

  function currentMode() {
    return L.selectState(state.status, Date.now(), targetStartTime.getTime());
  }

  function setBadge(mode) {
    const badge = $('live-badge'), text = $('live-badge-text');
    if (!badge) return;
    const map = {
      prestart: ['chip wait', 'COUNTDOWN'],
      live: ['chip live', 'LIVE PROGRAM'],
      ended: ['chip ended', 'SHOW ENDED'],
      off: ['chip wait', 'OFF'],
    };
    const [cls, label] = map[mode] || map.live;
    badge.className = cls;
    text.textContent = label;
  }

  function applyMode() {
    const mode = currentMode();
    const data = state.status || {};
    const show = (id, on) => { const el = $(id); if (el) el.classList.toggle('hidden', !on); };
    show('live-inactive-card', mode === 'off');
    show('ended-card', mode === 'ended');
    show('live-active-content', mode !== 'off' && mode !== 'ended');
    show('countdown-card', mode === 'prestart');
    show('now-performing-card', mode === 'live');
    const label = $('section-status-text');
    if (label) label.textContent = mode === 'prestart' ? 'Stage Countdown' : 'Now on Stage';
    setBadge(mode);

    if (mode === 'prestart') {
      const p = L.countdownParts(targetStartTime.getTime() - Date.now());
      $('cd-days').textContent = String(p.days).padStart(2, '0');
      $('cd-hours').textContent = String(p.hours).padStart(2, '0');
      $('cd-mins').textContent = String(p.mins).padStart(2, '0');
      $('cd-secs').textContent = String(p.secs).padStart(2, '0');
    }
    if (mode === 'ended') {
      const n = (data.performed || []).length;
      $('ended-count').textContent = n ? `${n} ${n === 1 ? 'act' : 'acts'}, one great night.` : 'One great night.';
    }
  }

  function renderAnnouncement() {
    const strip = $('announcement');
    const text = L.cleanAnnouncement(state.announcement);
    strip.textContent = text;
    strip.classList.toggle('hidden', !text);
  }

  function renderSource() {
    const el = $('source-note');
    if (!el) return;
    const viaConsole = lastChannelAt && Date.now() - lastServerOk > 45000;
    el.textContent = viaConsole ? 'Following the console' : '';
  }

  function nameHtml(item, clamp) {
    return `<span class="${L.nameClasses(clamp)}">${esc(L.actName(item))}</span>`;
  }

  function renderLiveStatus(data) {
    const prevAnn = state.announcement;
    state.status = data;
    state.announcement = L.cleanAnnouncement(data.announcement != null ? data.announcement : prevAnn);
    paint();
  }

  function paint() {
    const data = state.status;
    if (!data) return;
    renderAnnouncement();

    const title = data.header_brand_title || 'Event';
    $('live-event-title').textContent = title;
    document.title = `Live Stage Program - ${title}`;
    $('live-event-subtitle').textContent = data.header_brand_subtitle || data.event_subtitle || 'Musical Night';
    if (data.event_start_time_iso) {
      const parsed = new Date(data.event_start_time_iso);
      if (!isNaN(parsed.getTime())) targetStartTime = parsed;
      if (data.event_start_time) $('countdown-datetime-display').textContent = `Scheduled start: ${data.event_start_time}`;
    }
    $('ended-title').textContent = 'Thank you for coming';
    $('live-sync-timestamp').textContent = lastServerOk ? `Synced ${timeAgo(lastServerOk)}` : 'Following the console';

    // Now performing (no age badges, no stage notes)
    const np = data.now_performing;
    if (np) {
      const acoustic = np.track_status === 'Acoustic' || /acoustic/i.test(np.performance_type || '');
      $('now-acoustic-badge').classList.toggle('hidden', !acoustic);
      $('now-seq-badge').textContent = L.seqLabel(np);
      $('now-performer-name').innerHTML = esc(L.actName(np));
      $('now-song-title').textContent = np.song_title ? `"${np.song_title}"` : '';
    } else {
      $('now-acoustic-badge').classList.add('hidden');
      $('now-seq-badge').textContent = '#--';
      $('now-performer-name').innerHTML = '<span class="muted" style="font-weight:400;font-style:italic">Waiting for the next performance...</span>';
      $('now-song-title').textContent = 'Stage in preparation';
    }

    // Up next
    const upNext = data.up_next || [];
    const nextSection = $('up-next-section');
    nextSection.classList.toggle('hidden', upNext.length === 0);
    $('up-next-container').innerHTML = upNext.map((item, idx) => `
      <div class="next-card">
        <div class="tag">${esc(L.seqLabel(item))} &middot; ${idx === 0 ? 'Next' : 'After that'}</div>
        <div class="nm">${nameHtml(item, true)}</div>
        <p class="sg"><span class="${L.nameClasses(true)}">${item.song_title ? `"${esc(item.song_title)}"` : ''}</span></p>
      </div>`).join('');

    // Upcoming queue
    const upcoming = data.upcoming || [];
    $('upcoming-count').textContent = `${upcoming.length} scheduled`;
    $('upcoming-list').innerHTML = upcoming.length ? upcoming.map(item => `
      <div class="qrow">
        <span class="n">${esc(L.seqLabel(item))}</span>
        <div class="body">
          <div class="nm">${nameHtml(item, true)}</div>
          <div class="sg"><span class="${L.nameClasses(true)}">${item.song_title ? `"${esc(item.song_title)}"` : ''}</span></div>
        </div>
        ${item.performance_type ? `<span class="ty">${esc(item.performance_type)}</span>` : ''}
      </div>`).join('') : '<div class="qrow muted">No further performances scheduled</div>';

    // Completed
    const performed = data.performed || [];
    $('completed-section').classList.toggle('hidden', performed.length === 0);
    $('completed-header-text').textContent = `Completed Performances (${performed.length})`;
    $('completed-list-container').innerHTML = performed.map(item => `
      <div class="qrow">
        <span class="n">${esc(L.seqLabel(item))}</span>
        <div class="body"><div class="nm">${nameHtml(item, true)}${item.song_title ? ` - "${esc(item.song_title)}"` : ''}</div></div>
      </div>`).join('');

    updateGallery(data.gallery_images || []);
    applyMode();
    renderSource();
  }

  function timeAgo(ms) {
    const s = Math.floor((Date.now() - ms) / 1000);
    if (s < 15) return 'just now';
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    return m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`;
  }

  function updateGallery(images) {
    const grid = $('hero-section-grid'), box = $('hero-gallery');
    if (!images.length) {
      grid.classList.remove('with-gallery');
      box.classList.add('hidden');
      if (galleryTimer) { clearInterval(galleryTimer); galleryTimer = null; }
      galleryImages = [];
      return;
    }
    const changed = JSON.stringify(galleryImages) !== JSON.stringify(images);
    galleryImages = images;
    grid.classList.add('with-gallery');
    box.classList.remove('hidden');
    if (changed || !galleryTimer) {
      galleryIndex = galleryIndex % images.length;
      showSlide(galleryIndex);
      if (galleryTimer) clearInterval(galleryTimer);
      if (images.length > 1) galleryTimer = setInterval(() => { galleryIndex = (galleryIndex + 1) % galleryImages.length; showSlide(galleryIndex); }, 6000);
    }
  }

  function showSlide(i) {
    const img = $('carousel-img');
    if (!galleryImages.length) return;
    img.style.opacity = '0';
    setTimeout(() => { img.onload = () => { img.style.opacity = '1'; }; img.src = galleryImages[i]; }, 300);
  }

  async function fetchLiveStatus() {
    try {
      const res = await fetch('/api/live-status', { cache: 'no-store' });
      if (!res.ok) throw new Error(`live-status ${res.status}`);
      const data = await res.json();
      lastServerOk = Date.now();
      renderLiveStatus(data);
      if (window.auroraEffect && window.auroraEffect.setActive) window.auroraEffect.setActive(true, 1500);
      return true;
    } catch (e) {
      // Server unreachable: keep the last state; the console channel may still feed us.
      renderSource();
      return false;
    }
  }

  function startChannel() {
    if (typeof BroadcastChannel === 'undefined') return;
    let ch;
    try { ch = new BroadcastChannel('etm-live'); } catch (e) { return; }
    ch.onmessage = (event) => {
      const next = L.applyBroadcast(state, event.data);
      if (next === state) return;
      lastChannelAt = Date.now();
      state = next;
      paint();
    };
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (window.lucide) window.lucide.createIcons();

    // Footer QR for the sign-up link (>= 56 px; 120 px here).
    const url = `${location.origin}/signup`;
    const qrBox = $('signup-qr');
    try {
      qrBox.innerHTML = window.EtmQr.toSvg(url, { label: 'QR code: sign up to perform next time' });
      qrBox.setAttribute('aria-label', 'QR code to sign up');
      $('signup-url').textContent = url.replace(/^https?:\/\//, '');
    } catch (e) {
      qrBox.classList.add('hidden');
    }

    startChannel();
    fetchLiveStatus();
    let pollMs = 20000, pollTimer = setInterval(fetchLiveStatus, pollMs);
    const setPoll = (ms) => { if (ms !== pollMs) { clearInterval(pollTimer); pollMs = ms; pollTimer = setInterval(fetchLiveStatus, ms); } };
    if (window.EventSource) {
      const es = new EventSource('/api/live-stream');
      es.onmessage = () => { setPoll(20000); fetchLiveStatus(); };
      es.onerror = () => setPoll(5000);
    } else {
      setPoll(5000);
    }
    setInterval(applyMode, 1000);
    setInterval(() => { if (state.status) { $('live-sync-timestamp').textContent = lastServerOk ? `Synced ${timeAgo(lastServerOk)}` : 'Following the console'; } renderSource(); }, 5000);

    $('toggle-completed-btn').addEventListener('click', () => {
      showCompleted = !showCompleted;
      $('completed-list-container').classList.toggle('hidden', !showCompleted);
      $('toggle-completed-btn').setAttribute('aria-expanded', String(showCompleted));
    });

    // Plain re-fetch of the public feed; no admin endpoint is ever called from this screen.
    const refreshBtn = $('refresh-data-btn');
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.disabled = true;
      await fetchLiveStatus();
      setTimeout(() => { refreshBtn.disabled = false; }, 500);
    });

    if (window.EtmWakeLock) window.EtmWakeLock.start();
  });
})();
