// Venue /live screen view: SSE + poll + etm-live BroadcastChannel feed one render path.
// Public screen: small-screen guest navigation, no admin calls, no ages, stage notes or contact numbers.
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
  let postEventQrUrl = '';
  let lastServerOk = 0;
  let lastChannelAt = 0;

  function currentMode() {
    return L.selectState(state.status, Date.now(), targetStartTime.getTime());
  }

  function safeHttpUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return '';
    try {
      const url = new URL(value.trim());
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
      return url.href;
    } catch (_) { return ''; }
  }

  function renderEventDetails(data) {
    const doorsTime = typeof data.doors_open_time === 'string' ? data.doors_open_time.trim() : '';
    $('doors-open-time').textContent = doorsTime;
    const url = safeHttpUrl(data.post_event_link_url);
    const qr = $('post-event-qr');
    if (!url) {
      qr.innerHTML = '';
      postEventQrUrl = '';
      return;
    }
    if (url === postEventQrUrl) return;
    try {
      qr.innerHTML = window.EtmQr.toSvg(url, {label: 'QR code for event photos and feedback'});
      postEventQrUrl = url;
    } catch (_) {
      qr.innerHTML = '';
      postEventQrUrl = '';
    }
  }

  function pad2(n) { return String(n).padStart(2, '0'); }
  function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }

  function setBadge(mode) {
    const badge = $('live-badge'), text = $('live-badge-text');
    if (!badge) return;
    const data = state.status || {};
    const done = (data.performed || []).length;
    const total = Number(data.total_count) || 0;
    const live = total >= done && total > 0 ? `Live \u00b7 ${done} of ${total} performed` : 'Live';
    const map = {
      prestart: ['chip wait', 'Starting soon'],
      live: ['chip live', live],
      ended: ['chip ended', 'Show ended'],
      off: ['chip wait', 'Off'],
    };
    const [cls, label] = map[mode] || map.live;
    badge.className = cls;
    text.textContent = label;
  }

  // "Show starts at 5:00 PM", or with the day when it is not today.
  function startLabel() {
    const t = targetStartTime;
    const time = t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const sameDay = t.toDateString() === new Date().toDateString();
    return sameDay ? `Show starts at ${time}` : `Show starts ${t.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} \u00b7 ${time}`;
  }

  function setInfoStrip(mode, data) {
    const strip = $('live-info-strip');
    let label = '', text = '';
    if (mode === 'prestart') {
      const n = Number(data.total_count) || 0;
      if (n) { label = 'Lineup'; text = `${plural(n, 'act', 'acts')} on the program.`; }
    } else if (mode === 'ended') {
      label = 'See you next year'; text = 'Thank you to our performers, sponsors and volunteers.';
    }
    $('live-info-label').textContent = label;
    $('live-info-text').textContent = text;
    strip.classList.toggle('hidden', !text);
  }

  function applyMode() {
    const mode = currentMode();
    const data = state.status || {};
    const show = (id, on) => { const el = $(id); if (el) el.classList.toggle('hidden', !on); };
    document.body.dataset.mode = mode;
    show('live-inactive-card', mode === 'off');
    show('ended-card', mode === 'ended');
    show('live-active-content', mode !== 'off');
    show('up-next-section', mode === 'live' && (data.up_next || []).length > 0);
    show('countdown-card', mode === 'prestart');
    show('doors-open-pill', mode === 'prestart' && Boolean(String(data.doors_open_time || '').trim()));
    show('post-event-qr-wrap', mode === 'ended' && Boolean(postEventQrUrl));
    show('signup-qr-wrap', data.signups_open === true);  // no sign-up QR once registration is closed
    show('now-performing-card', mode === 'live');
    const label = $('section-status-text');
    if (label) label.textContent = mode === 'prestart' ? 'Stage Countdown' : 'Now on Stage';
    setBadge(mode);
    setInfoStrip(mode, data);
    const clock = $('live-clock');
    if (clock) clock.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

    if (mode === 'prestart') {
      const p = L.countdownParts(targetStartTime.getTime() - Date.now());
      $('cd-days').textContent = pad2(p.days);
      $('cd-hours').textContent = pad2(p.hours);
      $('cd-mins').textContent = pad2(p.mins);
      $('cd-secs').textContent = pad2(p.secs);
      show('cd-days-tile', p.days > 0);
      show('cd-days-sep', p.days > 0);
      $('countdown-datetime-display').textContent = startLabel();
    }
    if (mode === 'ended') {
      const n = (data.performed || []).length;
      $('ended-count').textContent = n ? `${plural(n, 'act', 'acts')}, one great night.` : 'One great night.';
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

  // Song first (board order); an act without a song title leads with the performer.
  function actTitle(item) { return item.song_title || L.actName(item); }
  function actSub(item) {
    const who = item.song_title ? L.actName(item) : '';
    return [who, item.performance_type].filter(Boolean).join(' \u00b7 ');
  }
  function actMeta(item) {
    return [item.performance_type, item.movie_name ? `from the film ${item.movie_name}` : ''].filter(Boolean).join(' \u00b7 ');
  }
  function titleHtml(item) {
    return `<span class="${L.nameClasses(true)}">${esc(actTitle(item))}</span>`;
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

    const clean = window.cleanEventName || (v => v);
    const title = clean(data.header_brand_title || 'Event');
    $('live-event-title').textContent = title;
    document.title = `Live Stage Program - ${title}`;
    $('live-event-subtitle').textContent = clean(data.header_brand_subtitle || data.event_subtitle || 'Musical Night');
    $('ended-event').textContent = title;
    $('prestart-event-name').textContent = clean(data.event_name || '');
    $('prestart-event-sub').textContent = clean(data.event_subtitle || '');
    renderEventDetails(data);
    if (data.event_start_time_iso) {
      const parsed = new Date(data.event_start_time_iso);
      if (!isNaN(parsed.getTime())) targetStartTime = parsed;
    }
    $('ended-title').textContent = 'Thank you for coming';
    $('live-sync-timestamp').textContent = lastServerOk ? `Synced ${timeAgo(lastServerOk)}` : 'Following the console';

    // Now performing: the song leads, then who sings it, then type and film. No age badges, no stage notes.
    const np = data.now_performing;
    const nowCard = $('now-performing-card');
    const songEl = $('now-song-title');
    if (np) {
      const acoustic = L.isAcousticAct(np);
      const song = np.song_title || '';
      $('now-acoustic-badge').classList.toggle('hidden', !acoustic);
      $('now-seq-badge').textContent = pad2(np.sequence_order || 0);
      $('now-seq-wrap').classList.remove('hidden');
      songEl.textContent = song;
      nowCard.classList.toggle('is-long', song.length > 22 || L.actName(np).length > 30);
      nowCard.classList.toggle('no-song', !song);
      $('now-performer-name').textContent = L.actName(np);
      $('now-meta').textContent = actMeta(np);
    } else {
      $('now-acoustic-badge').classList.add('hidden');
      $('now-seq-badge').textContent = '--';
      $('now-seq-wrap').classList.add('hidden');
      songEl.textContent = '';
      nowCard.classList.remove('is-long');
      nowCard.classList.add('no-song');
      $('now-performer-name').innerHTML = '<span class="lv-waiting">Waiting for the next performance...</span>';
      $('now-meta').textContent = 'Stage in preparation';
    }

    // Up next (the server sends at most two ready acts)
    const upNext = (data.up_next || []).slice(0, 2);
    $('up-next-container').innerHTML = upNext.map((item, idx) => `
      <div class="next-card${idx === 0 ? ' is-first' : ''}">
        <div class="tag">${idx === 0 ? 'Up next' : 'Then'} &middot; ${esc(pad2(item.sequence_order || 0))}</div>
        <div class="nm">${titleHtml(item)}</div>
        <p class="sg"><span class="${L.nameClasses(true)}">${esc(actSub(item))}</span></p>
      </div>`).join('');

    // Upcoming queue
    const upcoming = data.upcoming || [];
    $('upcoming-section').classList.toggle('hidden', upcoming.length === 0);
    $('upcoming-count').textContent = `${upcoming.length} scheduled`;
    $('upcoming-list').innerHTML = upcoming.map(item => `
      <div class="qrow">
        <span class="n">${esc(pad2(item.sequence_order || 0))}</span>
        <div class="body">
          <div class="nm">${titleHtml(item)}</div>
          <div class="sg"><span class="${L.nameClasses(true)}">${esc(actSub(item))}</span></div>
        </div>
      </div>`).join('');

    // Completed
    const performed = data.performed || [];
    $('completed-section').classList.toggle('hidden', performed.length === 0);
    $('completed-header-text').textContent = `Completed Performances (${performed.length})`;
    $('completed-list-container').innerHTML = performed.map(item => `
      <div class="qrow">
        <span class="n">${esc(pad2(item.sequence_order || 0))}</span>
        <div class="body"><div class="nm">${titleHtml(item)}</div><div class="sg"><span class="${L.nameClasses(true)}">${esc(actSub(item))}</span></div></div>
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
    const grid = $('live-active-content'), box = $('hero-gallery');
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

  function createMediaElement(url) {
    const isVideo = /\.(mp4|webm)(?:[?#].*)?$/i.test(String(url));
    const media = $(isVideo ? 'carousel-video' : 'carousel-img');
    const other = $(isVideo ? 'carousel-img' : 'carousel-video');
    if (other) { if (other.pause) other.pause(); other.hidden = true; other.style.opacity = '0'; other.removeAttribute('src'); }
    media.hidden = false;
    media.style.opacity = '0';
    if (isVideo) {
      media.onloadeddata = () => {
        media.style.opacity = '1';
        const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!reduced && media.play) { const playback = media.play(); if (playback && playback.catch) playback.catch(() => {}); }
      };
    } else {
      media.onload = () => { media.style.opacity = '1'; };
    }
    media.onerror = () => { media.style.opacity = '0'; };
    media.src = url;
    if (!isVideo && media.complete && media.naturalWidth > 0) {
      media.style.opacity = '1';
    }
  }

  function showSlide(i) {
    if (!galleryImages.length) return;
    const dots = $('gallery-dots');
    if (dots) dots.innerHTML = galleryImages.map((_, k) => `<span class="${k === i ? 'on' : ''}"></span>`).join('');
    setTimeout(() => createMediaElement(galleryImages[i]), 300);
  }

  // TV: when the lineup is longer than its panel, drift it upward slowly and loop. Off for reduced motion,
  // on small screens (they scroll by hand) and while a pointer or focus is inside the panel.
  function startUpcomingScroll() {
    const box = $('upcoming-scroll');
    const still = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
    const wide = window.matchMedia ? window.matchMedia('(min-width: 1000px)') : { matches: true };
    let hold = 0, paused = false;
    box.addEventListener('mouseenter', () => { paused = true; });
    box.addEventListener('mouseleave', () => { paused = false; });
    box.addEventListener('focusin', () => { paused = true; });
    box.addEventListener('focusout', () => { paused = false; });
    setInterval(() => {
      if (paused || still.matches || !wide.matches || box.scrollHeight <= box.clientHeight + 2) return;
      if (hold > 0) { hold--; return; }
      if (box.scrollTop + box.clientHeight >= box.scrollHeight - 1) { box.scrollTop = 0; hold = 60; return; }
      box.scrollTop += 1;
      if (box.scrollTop <= 0) hold = 60;
    }, 50);
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
    // Footer QR for the sign-up link (>= 56 px; the size follows the screen state in live.css).
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

    startUpcomingScroll();
    if (window.EtmWakeLock) window.EtmWakeLock.start();
  });
})();
