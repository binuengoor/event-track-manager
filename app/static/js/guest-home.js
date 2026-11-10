/* Guest home (/): event details from /api/event-info, the countdown with its live and ended states,
 * the call-to-action buttons that follow the event's feature flags, the potluck food preview,
 * the organizer's general notes and the sponsor reel (event gallery images). Markup: landing.html. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var targetEventDate = null;
  var eventDurationMs = 5 * 3600 * 1000;
  var flags = {};
  var heroStatus = '';
  var state = '';          // upcoming | live | ended

  function setText(id, text) { var n = $(id); if (n) n.textContent = text; }
  function show(id, on) { var n = $(id); if (n) n.hidden = !on; }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function isVideoUrl(url) { return /\.(mp4|webm)(?:[?#].*)?$/i.test(String(url)); }
  function createMediaElement(url) {
    var media = document.createElement(isVideoUrl(url) ? 'video' : 'img');
    if (media.tagName.toLowerCase() === 'video') {
      media.muted = true; media.loop = true; media.playsInline = true; media.autoplay = false; media.preload = 'metadata';
      media.setAttribute('aria-label', 'Highlight video');
    } else {
      media.alt = altFromUrl(url); media.loading = 'lazy'; media.decoding = 'async';
    }
    media.src = url;
    return media;
  }

  // "5:00 PM - 9:00 PM" style ranges give the event window (default 5 hours).
  function parseRangeDurationMs(range) {
    var m = String(range).match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?\s*(?:-|–|—|to)\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i);
    if (!m) return null;
    var to24 = function (h, min, ap) { h = parseInt(h, 10) % 12; if (/pm/i.test(ap)) h += 12; return h * 60 + parseInt(min || '0', 10); };
    var endAp = m[6];
    var start = to24(m[1], m[2], m[3] || endAp);
    var end = to24(m[4], m[5], endAp);
    if (end <= start) end += 24 * 60;
    return (end - start) * 60000;
  }

  // ---------------------------------------------------------------- theme switch
  function bindThemeToggle() {
    var btn = $('theme-toggle-btn');
    if (!btn) return;
    if (!window.etmTheme) { btn.hidden = true; return; }
    var names = { system: 'Auto', light: 'Light', dark: 'Dark' };
    var paint = function () {
      var c = window.etmTheme.get();
      setText('theme-toggle-label', names[c]);
      var label = 'Colour theme: ' + names[c] + '. Activate to change.';
      btn.setAttribute('aria-label', label);
      btn.title = label;
    };
    btn.addEventListener('click', function () { window.etmTheme.cycle(); paint(); });
    paint();
  }

  // ---------------------------------------------------------------- status, copy and buttons
  function renderStatusPill() {
    var pill = $('status-pill');
    if (!pill) return;
    pill.setAttribute('data-state', state === 'live' ? 'live' : state === 'ended' ? 'ended' : 'ready');
    setText('status-pill-text', state === 'live' ? 'LIVE ON STAGE' : state === 'ended' ? 'EVENT ENDED' : (heroStatus || 'Stage Ready'));
    // Not a stage event: no "on stage" wording for the live state.
    if (state === 'live' && flags.stage === false) setText('status-pill-text', 'HAPPENING NOW');
  }

  function renderCtas() {
    var potluck = flags.stage === false;
    var performOn = !potluck && flags.signup !== false;
    var dishOn = flags.food !== false;
    var ended = state === 'ended';
    var live = state === 'live';

    var liveCta = live && !potluck && flags.live !== false;
    show('card-live', liveCta);

    var signup = $('card-signup');
    var dish = $('card-dish');
    var closed = false;
    if (ended) {
      show('card-signup', false); show('card-dish', false);
    } else if (performOn) {
      setText('card-signup-title', 'Sign up to perform');
      signup.setAttribute('href', '/signup');
      show('card-signup', true);
      show('card-dish', dishOn);
      if (liveCta) { signup.className = 'gh-btn gh-btn-outline'; } else { signup.className = 'gh-btn gh-btn-primary'; }
      dish.className = 'gh-btn gh-btn-outline';
    } else if (dishOn) {
      setText('card-signup-title', 'Bring a dish');
      signup.setAttribute('href', '/signup?choice=dish');
      signup.className = liveCta ? 'gh-btn gh-btn-outline' : 'gh-btn gh-btn-primary';
      show('card-signup', true);
      show('card-dish', false);
    } else {
      show('card-signup', false); show('card-dish', false);
      closed = true;
    }
    show('signup-closed-note', closed && !ended);
    var payBtn = $('card-payment');
    if (payBtn) {
      if (flags.paymentUrl && flags.paymentOn && !ended) {
        payBtn.setAttribute('href', flags.paymentUrl);
        show('card-payment', true);
      } else {
        show('card-payment', false);
      }
    }
    show('card-schedule', ended && flags.dashboard !== false);
    setText('card-schedule-title', potluck ? 'See the food board' : 'See the Schedule');
  }

  function setState(next) {
    if (next === state) return;
    state = next;
    var card = $('countdown-card');
    if (card) card.setAttribute('data-state', state);
    document.documentElement.setAttribute('data-event-state', state);
    var potluck = flags.stage === false;
    if (state === 'ended') {
      setText('countdown-heading-badge', 'Event ended');
      setText('countdown-status-title', 'Thanks for coming');
      setText('countdown-status-sub', potluck
        ? 'The event has wrapped up. See you at the next one.'
        : 'The program has wrapped up. Browse the final running order on the Schedule, and see you at the next one.');
    } else if (state === 'live') {
      setText('countdown-heading-badge', 'Live now');
      setText('countdown-status-title', potluck ? 'The event is on' : 'The program is live');
      setText('countdown-status-sub', potluck
        ? 'Everyone is gathering. Check the food board to see what is on the table.'
        : 'Performances are underway. Open Live to see who is on stage.');
      setText('countdown-chip', 'Live now');
    } else {
      setText('countdown-heading-badge', 'Countdown');
      setText('countdown-status-title', 'The music begins soon');
      setText('countdown-status-sub', '');
    }
    renderStatusPill();
    renderCtas();
  }

  function chipText(days, hours, mins) {
    if (days >= 1) return 'in ' + days + (days === 1 ? ' day' : ' days');
    if (hours >= 1) return 'in ' + hours + ' h ' + mins + ' min';
    return 'in ' + Math.max(1, mins) + ' min';
  }

  function updateCountdown() {
    if (!targetEventDate) return;
    var diffMs = targetEventDate.getTime() - Date.now();
    if (diffMs <= -eventDurationMs) { setState('ended'); return; }
    if (diffMs <= 0) { setState('live'); return; }
    setState('upcoming');
    var total = Math.floor(diffMs / 1000);
    var days = Math.floor(total / 86400);
    var hours = Math.floor((total % 86400) / 3600);
    var mins = Math.floor((total % 3600) / 60);
    setText('cd-days', pad2(days));
    setText('cd-hours', pad2(hours));
    setText('cd-mins', pad2(mins));
    setText('cd-secs', pad2(total % 60));
    setText('countdown-chip', chipText(days, hours, mins));
    setText('countdown-status-sub', '');
  }

  // ---------------------------------------------------------------- event details
  function applyInfo(info) {
    flags = {
      stage: info.stage_performances_enabled,
      signup: info.signup_enabled,
      food: info.food_signup_enabled,
      dashboard: info.dashboard_enabled,
      live: info.live_display_enabled,
      paymentUrl: info.payment_url,
      paymentOn: info.payment_enabled !== false,
    };
    document.body.setAttribute('data-mode', flags.stage === false ? 'potluck' : 'stage');

    if (info.poster_url) {
      var isVideo = isVideoUrl(info.poster_url);
      var poster = $(isVideo ? 'event-poster-video' : 'event-poster-img');
      var otherPoster = $(isVideo ? 'event-poster-img' : 'event-poster-video');
      if (otherPoster) { if (otherPoster.pause) otherPoster.pause(); otherPoster.style.display = 'none'; otherPoster.hidden = true; }
      poster.hidden = false;
      poster.onload = poster.onloadeddata = function () {
        poster.style.display = '';
        $('hero').setAttribute('data-poster', 'img');
      };
      poster.onerror = function () { poster.style.display = 'none'; $('hero').setAttribute('data-poster', 'none'); };
      poster.src = info.poster_url;
      if (isVideo && !reduceMotion && poster.play) {
        var playback = poster.play();
        if (playback && playback.catch) playback.catch(function () {});
      }
    }

    if (info.event_start_time_iso) {
      var parsed = new Date(info.event_start_time_iso);
      if (!isNaN(parsed.getTime())) targetEventDate = parsed;
    }
    if (targetEventDate) {
      setText('event-datetime-text', targetEventDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }));
      setText('event-time-range-text', targetEventDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }));
    }
    if (info.time_range) {
      setText('event-time-range-text', info.time_range);
      eventDurationMs = parseRangeDurationMs(info.time_range) || eventDurationMs;
    }

    if (info.header_brand_title) {
      setText('nav-event-title', info.header_brand_title);
      document.title = info.event_name || info.header_brand_title;
    }
    if (info.header_brand_subtitle) setText('nav-event-subtitle', info.header_brand_subtitle);
    var name = info.event_name || info.app_title;
    if (name) setText('event-title-display', window.cleanEventName ? window.cleanEventName(name) : name);
    setText('event-subtitle-display', info.app_subtitle || '');

    if (info.venue) {
      var parts = info.venue.split(',');
      setText('venue-name-text', parts[0].trim());
      var rest = parts.slice(1).join(',').trim();
      setText('venue-sub-text', rest ? ', ' + rest : '');
      $('venue-link').href = 'https://maps.google.com/?q=' + encodeURIComponent(info.venue);
    } else {
      show('venue-link', false);
    }

    if (info.hero_tag_primary) setText('hero-primary-tag-text', info.hero_tag_primary);
    else show('hero-primary-tag', false);
    heroStatus = info.hero_tag_status || '';

    renderNotes(info.general_notes);
  }

  function renderNotes(notes) {
    if (!notes || !notes.trim()) return;
    var html;
    if (window.marked && typeof window.marked.parse === 'function') {
      html = window.marked.parse(notes, { breaks: true, gfm: true });
    } else {
      html = notes.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n\n/g, '<br><br>').replace(/\n/g, '<br>');
    }
    $('general-notes-content').innerHTML = html;
    show('general-notes-card', true);
  }

  // ---------------------------------------------------------------- potluck food preview
  async function loadFoodPreview() {
    if (flags.stage !== false || flags.food === false) return;
    try {
      var res = await fetch('/api/dashboard/food');
      if (!res.ok) return;
      var data = await res.json();
      var items = data.items || [];
      if (data.enabled === false || !items.length) return;
      setText('food-preview-count', data.taken_items + '/' + data.total_items + ' taken');
      var pct = data.total_items ? Math.round(100 * data.taken_items / data.total_items) : 0;
      var bar = $('food-preview-bar');
      bar.firstElementChild.style.width = pct + '%';
      bar.setAttribute('aria-label', data.taken_items + ' of ' + data.total_items + ' dishes taken');
      var list = $('food-preview-list');
      list.textContent = '';
      var shown = items.filter(function (i) { return !i.is_taken; }).slice(0, 2)
        .concat(items.filter(function (i) { return i.is_taken; }).slice(0, 2)).slice(0, 4);
      shown.forEach(function (item) {
        var li = document.createElement('li');
        li.className = 'gh-dish';
        var text = document.createElement('div');
        text.className = 'gh-dish-text';
        var nm = document.createElement('span');
        nm.className = 'gh-dish-name';
        nm.textContent = item.name;
        var sub = document.createElement('span');
        sub.className = 'gh-dish-sub';
        sub.textContent = item.is_taken ? [item.signer_name, item.dish_description].filter(Boolean).join(' · ') : 'Open slot';
        text.append(nm, sub);
        var right;
        if (item.is_taken) {
          right = document.createElement('span');
          right.className = 'gh-tag';
          right.textContent = 'Taken';
        } else {
          right = document.createElement('a');
          right.className = 'gh-btn gh-btn-small';
          right.href = '/my-entry?food_item=' + encodeURIComponent(item.item_id);
          right.textContent = 'Open';
          right.setAttribute('aria-label', 'Open slot: ' + item.name);
        }
        li.append(text, right);
        list.appendChild(li);
      });
      show('food-preview', true);
    } catch (e) { /* the page works without the preview */ }
  }

  // ---------------------------------------------------------------- sponsor reel
  function altFromUrl(url) {
    var file = decodeURIComponent(String(url).split('/').pop() || '').replace(/\.[a-z0-9]+$/i, '');
    return file.replace(/[-_]+/g, ' ').trim() || 'Highlight';
  }

  async function loadSponsors() {
    var images = [];
    try {
      var res = await fetch('/api/live-status');
      if (res.ok) images = (await res.json()).gallery_images || [];
    } catch (e) { return; }
    if (!images.length) return;

    var track = $('sponsor-track');
    var reel = $('sponsor-reel');
    var loads = images.map(function (url) {
      var li = document.createElement('li');
      var media = createMediaElement(url);
      li.appendChild(media);
      track.appendChild(li);
      return new Promise(function (ok) {
        media.onload = media.onloadeddata = function () {
          if (media.tagName.toLowerCase() === 'video' && media.play && !reduceMotion) {
            var playback = media.play();
            if (playback && playback.catch) playback.catch(function () {});
          }
          ok();
        };
        media.onerror = ok;
      });
    });
    show('sponsors', true);
    await Promise.all(loads);

    var toggle = $('sponsors-toggle');
    if (images.length && !reduceMotion) {
      // Repeat the items if needed so the track comfortably spans the viewport.
      while (track.children.length < 30 && track.scrollWidth <= reel.clientWidth + 20) {
        images.forEach(function (url) {
          var li = document.createElement('li');
          var media = createMediaElement(url);
          li.appendChild(media);
          track.appendChild(li);
        });
      }
      // Seamless loop: a second, hidden copy follows the first.
      var half = track.scrollWidth;
      Array.prototype.slice.call(track.children).forEach(function (li) {
        var copy = li.cloneNode(true);
        copy.setAttribute('aria-hidden', 'true');
        if (copy.firstElementChild.tagName.toLowerCase() === 'img') copy.firstElementChild.alt = '';
        track.appendChild(copy);
      });
      track.style.setProperty('--reel-shift', '-' + (half + 10) + 'px');
      track.style.setProperty('--reel-time', Math.max(12, Math.round(half / 40)) + 's');
      reel.classList.add('is-marquee');
      reel.removeAttribute('tabindex');
      toggle.hidden = false;
      toggle.addEventListener('click', function () {
        var paused = reel.classList.toggle('is-paused');
        toggle.textContent = paused ? 'Play' : 'Pause';
        toggle.setAttribute('aria-pressed', String(paused));
      });
    } else if (track.scrollWidth <= reel.clientWidth + 4) {
      reel.removeAttribute('tabindex');
    }
  }

  // ---------------------------------------------------------------- start
  async function init() {
    bindThemeToggle();
    try {
      var res = await fetch('/api/event-info');
      if (res.ok) applyInfo(await res.json());
    } catch (e) { console.warn('Could not fetch event info:', e); }
    if (!targetEventDate) {
      // No start time on record: show the page without a countdown.
      $('countdown-tiles').hidden = true;
      show('countdown-chip', false);
      state = 'upcoming';
      renderStatusPill();
      renderCtas();
    } else {
      updateCountdown();
      setInterval(updateCountdown, 1000);
    }
    loadFoodPreview();
    loadSponsors();
  }
  init();
})();
