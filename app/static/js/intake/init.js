// Event info, performance list, food catalog, others-songs rendering.
// Classic script: shares globals with the other intake files (see load order in the page).

async function initEventInfo() {
  try {
    const res = await fetch('/api/event-info');
    if (res.ok) {
      const data = await res.json();
      window.eventInfo = data;
      if (data.header_brand_title) {
        const titleEl = document.getElementById('event-title');
        if (titleEl) titleEl.textContent = data.header_brand_title;
        document.title = data.stage_performances_enabled === false
          ? `${data.header_brand_title} - My dish`
          : `${data.header_brand_title} - My entry`;
      }
      if (data.header_brand_subtitle) {
        const subEl = document.getElementById('event-subtitle');
        if (subEl) subEl.textContent = data.header_brand_subtitle;
      }

      if (data.stage_performances_enabled === false) {
        const hubTitle = document.getElementById('performer-hub-title');
        if (hubTitle) hubTitle.textContent = "My dish";
        const hubDesc = document.getElementById('performer-hub-desc');
        if (hubDesc) hubDesc.textContent = "Pick your name to see, change or release your dish.";
        const selectLabel = document.getElementById('performer-select-label-text');
        if (selectLabel) selectLabel.textContent = "Your name";
        const potluckNotice = document.getElementById('potluck-only-event-notice');
        if (potluckNotice) potluckNotice.classList.remove('hidden');
        const othersSection = document.getElementById('others-songs-section');
        if (othersSection) othersSection.classList.add('hidden');
      }

      if (window.adaptNavigationForEventConfig) {
        window.adaptNavigationForEventConfig(data);
      }

      // Only offer the track formats this event accepts (audio, video, or both)
      if (Array.isArray(data.allowed_media)) allowedMedia = data.allowed_media;
      if (Array.isArray(data.allowed_media) && data.allowed_media.length === 1) {
        const only = data.allowed_media[0];
        const audioBtn = document.getElementById('type-audio-btn');
        const videoBtn = document.getElementById('type-video-btn');
        (only === 'audio' ? videoBtn : audioBtn)?.classList.add('hidden');
        audioBtn?.parentElement?.classList.add('is-single');
        if (typeof setMediaType === 'function') setMediaType(only);
      }

      if (data.external_link_url) {
        externalLinkUrl = data.external_link_url;
      }
      if (data.payment_url) {
        const payLink = document.getElementById('payment-page-link');
        const payPlaceholder = document.getElementById('payment-page-placeholder');
        if (payLink) {
          payLink.href = data.payment_url;
          payLink.classList.remove('hidden');
        }
        if (payPlaceholder) {
          payPlaceholder.classList.add('hidden');
        }
      }
      // Limits and accepted types come from the admin settings (fall back to the documented defaults).
      const audioLimit = Number(data.max_audio_upload_mb);
      const videoLimit = Number(data.max_video_upload_mb);
      maxAudioMb = audioLimit > 0 ? audioLimit : 200;
      maxVideoMb = videoLimit > 0 ? videoLimit : 500;
      if (Array.isArray(data.allowed_extensions) && data.allowed_extensions.length) {
        allowedExts = data.allowed_extensions.map(e => String(e).replace(/^\./, '').toLowerCase());
      } else {
        allowedExts = DEFAULT_ALLOWED_EXTS.slice();
      }
      setMediaType(currentMediaType);

      // Fetch last sync timestamp in the background (non-blocking)
      fetch('/api/live-status')
        .then(r => r.ok ? r.json() : null)
        .then(liveData => {
          if (liveData && typeof updateIntakeSyncBadge === 'function') {
            updateIntakeSyncBadge(liveData.last_synced_at);
          }
        })
        .catch(() => {});
    }
  } catch (e) {
    console.warn('Could not load event info:', e);
  }
}

async function loadPerformances() {
  const badge = document.getElementById('performer-count-badge');
  try {
    let sortedPerformers = [];
    const [namesRes, perfsRes] = await Promise.all([
      fetch('/api/performer/names').catch(() => null),
      fetch('/api/performances').catch(() => null)
    ]);

    if (namesRes && namesRes.ok) {
      try { sortedPerformers = await namesRes.json(); } catch (_) {}
    }
    if (perfsRes && perfsRes.ok) {
      performances = await perfsRes.json();
    } else if (!sortedPerformers.length) {
      throw new Error('Failed to load sign-ups');
    }

    if (!sortedPerformers.length) {
      const performerSet = new Set();
      performances.forEach(p => {
        if (p.performer_name) performerSet.add(p.performer_name.trim());
        if (p.partner_name) p.partner_name.split(/\s*(?:&|,|\band\b)\s*/i).filter(Boolean).forEach(name => performerSet.add(name.trim()));
      });
      sortedPerformers = Array.from(performerSet).sort((a, b) => a.localeCompare(b));
    }

    const select = document.getElementById('performer-select');
    const currentSelected = select.value;
    select.innerHTML = '<option value="">Choose your name…</option>';

    sortedPerformers.forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      if (name === currentSelected) opt.selected = true;
      select.appendChild(opt);
    });

    badge.textContent = `${sortedPerformers.length} registered participants`;
    if (window.eventInfo && window.eventInfo.stage_performances_enabled === false) {
      const othersSection = document.getElementById('others-songs-section');
      if (othersSection) othersSection.classList.add('hidden');
    } else {
      renderOthersSongs();
    }
  } catch (err) {
    badge.textContent = 'Error loading names';
    showError(err.message || 'Could not connect to the server. Check your connection and refresh the page.', { title: 'We could not load the names' });
  }
}

async function loadFoodCatalog() {
  try {
    const res = await fetch('/api/signup/config');
    if (res.ok) {
      const data = await res.json();
      allFoodGroups = data.food_groups || [];
      allFoodItems = data.food_items || [];
      foodServingNote = data.food_serving_note || 'Bring one dish to share';
      if (data.max_performances_per_participant) {
        maxPerformancesPerParticipant = parseInt(data.max_performances_per_participant, 10) || 2;
      }
      if (data.max_solo_per_participant !== undefined) {
        maxSoloPerParticipant = parseInt(data.max_solo_per_participant, 10) || 1;
      }
      const noteEl = document.getElementById('food-serving-note-display');
      if (noteEl) noteEl.textContent = foodServingNote;
    }
  } catch (e) {
    console.warn('Could not load food catalog:', e);
  }
}

function isPlaceholderSong(title) {
  if (!title) return true;
  const t = title.trim().toLowerCase();
  if (!t) return true;
  const placeholders = [
    'tbd', 'tba', 'to be decided', 'to be announced',
    'test', 'testing', 'n/a', 'na', 'none', 'unknown',
    'song title missing', 'missing', 'pending', 'null', 'untitled'
  ];
  if (placeholders.includes(t)) return true;
  if (t.includes('song title missing')) return true;
  if (t.includes('(song') && t.includes('missing)')) return true;
  if (/^performance\s*(?:#?\d+)?$/i.test(t)) return true;
  if (/^song\s*(?:#?\d+)?$/i.test(t)) return true;
  return false;
}

function isSongTitleMissing(song) {
  if (!song) return true;
  return Boolean(song.is_song_name_missing) || isPlaceholderSong(song.song_title);
}

function renderOthersSongs(filterQuery = '') {
  const listEl = document.getElementById('others-songs-list');
  if (!listEl) return;

  const validSongs = performances.filter(p => p.song_title && !isSongTitleMissing(p));
  const filtered = filterQuery
    ? validSongs.filter(p =>
        p.song_title.toLowerCase().includes(filterQuery.toLowerCase()) ||
        p.performer_name.toLowerCase().includes(filterQuery.toLowerCase()) ||
        (p.partner_name && p.partner_name.toLowerCase().includes(filterQuery.toLowerCase()))
      )
    : validSongs;

  if (filtered.length === 0) {
    listEl.innerHTML = '<p class="me-empty">No matching songs found.</p>';
    return;
  }

  listEl.innerHTML = filtered.map(p => `
    <div class="me-other">
      <div class="me-other-text">
        <span class="me-other-title">${escapeHtml(p.song_title)}</span>
        <span class="me-other-who">${escapeHtml(p.performer_name)}${p.partner_name ? ' & ' + escapeHtml(p.partner_name) : ''}</span>
      </div>
      ${renderTypePill(p.performance_type)}
    </div>
  `).join('');
}
