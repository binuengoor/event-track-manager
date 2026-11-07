// My entry (guest): edit acts, upload a track or paste a link, manage a dish.
const NAME_KEY = 'etm_guest_name';
const VIDEO_EXTS = ['mp4', 'webm', 'mov', 'mkv', 'm4v', 'avi'];
const DEFAULT_ALLOWED_EXTS = ['mp3', 'wav', 'm4a', 'mp4', 'webm'];
const LINK_HOSTS = ['soundcloud.com', 'on.soundcloud.com', 'youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'];
let maxAudioMb = 200;
let maxVideoMb = 500;
let allowedExts = DEFAULT_ALLOWED_EXTS.slice();
let allowedMedia = null; // from /api/event-info allowed_media
let activeXhr = null;
let lastSubmitFailed = false;
let performances = [];
let selectedPerformer = null;
let selectedEntry = null;
let currentMethod = 'file'; // 'file' or 'youtube'
let currentMediaType = 'audio'; // 'audio' or 'video'
let sheetUrl = '';
let performerFoodSignup = null;
let allFoodGroups = [];
let allFoodItems = [];
let foodServingNote = 'Bring one dish to share';
let pendingDeepLinkFoodItem = null;
let maxPerformancesPerParticipant = 2;
let maxSoloPerParticipant = 1;

document.addEventListener('DOMContentLoaded', async () => {
  await initEventInfo();
  await loadPerformances();
  await loadFoodCatalog();
  setupEventListeners();
  setupAddPerformanceModal();
  handleUrlQueryParams();
});

function handleUrlQueryParams() {
  const params = new URLSearchParams(window.location.search);
  const nameParam = params.get('name') || params.get('performer');
  const foodParam = params.get('food_item');

  if (foodParam) {
    pendingDeepLinkFoodItem = foodParam;
  }

  if (nameParam) {
    const select = document.getElementById('performer-select');
    // Try exact or case-insensitive match
    for (let i = 0; i < select.options.length; i++) {
      if (select.options[i].value.toLowerCase() === nameParam.toLowerCase()) {
        select.selectedIndex = i;
        selectedPerformer = select.options[i].value;
        handlePerformerSelected(selectedPerformer);
        break;
      }
    }
  }

  if (pendingDeepLinkFoodItem && !selectedPerformer) {
    // Show banner or focus performer select
    const hint = document.getElementById('food-cta-section');
    hint.classList.remove('hidden');
    hint.innerHTML = `
      <div class="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between text-xs text-amber-300">
        <span>Please choose your name from Step 1 above to sign up for this dish.</span>
      </div>
    `;
  }
}

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
        audioBtn?.parentElement?.classList.replace('grid-cols-2', 'grid-cols-1');
        if (typeof setMediaType === 'function') setMediaType(only);
      }

      if (data.sheet_url) {
        sheetUrl = data.sheet_url;
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

      // Fetch last sync timestamp
      try {
        const liveRes = await fetch('/api/live-status');
        if (liveRes.ok) {
          const liveData = await liveRes.json();
          updateIntakeSyncBadge(liveData.last_synced_at);
        }
      } catch (e) {
        console.warn('Could not fetch live sync status:', e);
      }
    }
  } catch (e) {
    console.warn('Could not load event info:', e);
  }
}

async function loadPerformances() {
  const badge = document.getElementById('performer-count-badge');
  try {
    let sortedPerformers = [];
    try {
      const namesRes = await fetch('/api/performer/names');
      if (namesRes.ok) {
        sortedPerformers = await namesRes.json();
      }
    } catch (e) {}

    const res = await fetch('/api/performances');
    if (res.ok) {
      performances = await res.json();
    } else if (!sortedPerformers.length) {
      throw new Error('Failed to load sign-ups');
    }

    if (!sortedPerformers.length) {
      const performerSet = new Set();
      performances.forEach(p => {
        if (p.performer_name) performerSet.add(p.performer_name.trim());
        if (p.partner_name) performerSet.add(p.partner_name.trim());
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
    showError(err.message || 'Could not connect to database backend');
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
    listEl.innerHTML = '<p class="text-xs text-slate-500 py-2">No matching songs found.</p>';
    return;
  }

  listEl.innerHTML = filtered.map(p => `
    <div class="flex items-center justify-between p-2.5 rounded-xl bg-slate-900 border border-slate-800/80 text-xs">
      <div class="truncate mr-2">
        <span class="font-semibold text-white">${escapeHtml(p.song_title)}</span>
        <span class="text-slate-400 block text-[11px]">${escapeHtml(p.performer_name)}${p.partner_name ? ' & ' + escapeHtml(p.partner_name) : ''}</span>
      </div>
      <div class="shrink-0 flex items-center gap-1.5">
        ${renderTypePill(p.performance_type)}
      </div>
    </div>
  `).join('');
}

function setupEventListeners() {
  const performerSelect = document.getElementById('performer-select');
  performerSelect.addEventListener('change', (e) => {
    selectedPerformer = e.target.value;
    handlePerformerSelected(selectedPerformer);
  });

  // Search others' songs
  const searchInput = document.getElementById('others-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      renderOthersSongs(e.target.value);
    });
  }

  // Refresh Data buttons
  const refreshBtn = document.getElementById('refresh-data-btn');
  if (refreshBtn) refreshBtn.addEventListener('click', handleRefreshClick);

  // Media Type Switching (Audio MP3 vs Video MP4 with Lyrics)
  const typeAudioBtn = document.getElementById('type-audio-btn');
  const typeVideoBtn = document.getElementById('type-video-btn');
  if (typeAudioBtn) {
    typeAudioBtn.addEventListener('click', () => setMediaType('audio'));
  }
  if (typeVideoBtn) {
    typeVideoBtn.addEventListener('click', () => setMediaType('video'));
  }

  // Tab switching
  const tabFile = document.getElementById('tab-file');
  const tabYoutube = document.getElementById('tab-youtube');
  const filePane = document.getElementById('file-upload-pane');
  const ytPane = document.getElementById('youtube-upload-pane');

  tabFile.addEventListener('click', () => {
    currentMethod = 'file';
    tabFile.className = 'py-2 rounded-lg bg-orange-500 text-white font-semibold flex items-center justify-center gap-2 transition shadow';
    tabYoutube.className = 'py-2 rounded-lg text-slate-400 hover:text-slate-200 font-medium flex items-center justify-center gap-2 transition';
    filePane.classList.remove('hidden');
    ytPane.classList.add('hidden');
    updateSubmitButtonText();
    if (window.lucide) lucide.createIcons();
  });

  tabYoutube.addEventListener('click', () => {
    currentMethod = 'youtube';
    tabYoutube.className = 'py-2 rounded-lg bg-orange-500 text-white font-semibold flex items-center justify-center gap-2 transition shadow';
    tabFile.className = 'py-2 rounded-lg text-slate-400 hover:text-slate-200 font-medium flex items-center justify-center gap-2 transition';
    ytPane.classList.remove('hidden');
    filePane.classList.add('hidden');
    updateSubmitButtonText();
    if (window.lucide) lucide.createIcons();
  });

  // File drop zone
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('audio-file-input');

  dropZone.addEventListener('click', () => {
    if (selectedEntry && isSongTitleMissing(selectedEntry)) {
      openEditSongModal(selectedEntry);
      showToast('Please specify your song title before uploading a track.', 'error');
      return;
    }
    fileInput.click();
  });
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('border-orange-500', 'bg-orange-500/5');
  });
  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('border-orange-500', 'bg-orange-500/5');
  });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('border-orange-500', 'bg-orange-500/5');
    if (selectedEntry && isSongTitleMissing(selectedEntry)) {
      openEditSongModal(selectedEntry);
      showToast('Please specify your song title before uploading a track.', 'error');
      return;
    }
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      fileInput.files = e.dataTransfer.files;
      handleFileSelected(fileInput.files[0]);
    }
  });
  fileInput.addEventListener('change', () => {
    if (selectedEntry && isSongTitleMissing(selectedEntry)) {
      fileInput.value = '';
      openEditSongModal(selectedEntry);
      showToast('Please specify your song title before uploading a track.', 'error');
      return;
    }
    if (fileInput.files && fileInput.files[0]) {
      handleFileSelected(fileInput.files[0]);
    }
  });

  document.getElementById('retry-upload-btn')?.addEventListener('click', () => {
    handleFormSubmit({ preventDefault() {} });
  });
  document.getElementById('cancel-upload-btn')?.addEventListener('click', () => {
    if (activeXhr) activeXhr.abort();
  });

  const alertAddTitleBtn = document.getElementById('alert-add-title-btn');
  if (alertAddTitleBtn) {
    alertAddTitleBtn.addEventListener('click', () => {
      if (selectedEntry) openEditSongModal(selectedEntry);
    });
  }

  // Form submit
  document.getElementById('intake-form').addEventListener('submit', handleFormSubmit);

  // Upload another
  document.getElementById('upload-another-btn').addEventListener('click', () => {
    document.getElementById('success-card').classList.add('hidden');
    document.getElementById('intake-form').classList.remove('hidden');
    document.getElementById('audio-file-input').value = '';
    document.getElementById('youtube-url-input').value = '';
    document.getElementById('file-info-bar').classList.add('hidden');
    if (selectedPerformer) {
      handlePerformerSelected(selectedPerformer);
    }
  });

  // Edit song modal events
  setupEditModalEvents();

  // Rename performer modal events
  setupRenamePerformerModal();

  // Food selector events
  setupFoodSelectorEvents();

  // Acoustic toggle buttons
  const markAcousticBtn = document.getElementById('mark-acoustic-btn');
  if (markAcousticBtn) {
    markAcousticBtn.addEventListener('click', async () => {
      if (!selectedEntry) return;
      try {
        const res = await fetch(`/api/signup/performance/${selectedEntry.entry_id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ track_status: 'Acoustic' })
        });
        if (res.ok) {
          await loadPerformances();
          if (selectedPerformer) handlePerformerSelected(selectedPerformer);
        }
      } catch (e) {
        alert('Could not update to Acoustic status');
      }
    });
  }

  const switchTrackBtn = document.getElementById('switch-to-track-btn');
  if (switchTrackBtn) {
    switchTrackBtn.addEventListener('click', async () => {
      if (!selectedEntry) return;
      try {
        const res = await fetch(`/api/signup/performance/${selectedEntry.entry_id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ track_status: 'Pending' })
        });
        if (res.ok) {
          await loadPerformances();
          if (selectedPerformer) handlePerformerSelected(selectedPerformer);
        }
      } catch (e) {
        alert('Could not switch to track upload');
      }
    });
  }
}

function findDuplicateSong(title, currentEntryId = null) {
  if (!title || isPlaceholderSong(title)) return null;
  const cleanTitle = title.trim().toLowerCase();
  if (cleanTitle.length < 3) return null;

  for (const p of performances) {
    if (currentEntryId && p.entry_id === currentEntryId) continue;
    if (isSongTitleMissing(p)) continue;
    const existingTitle = (p.song_title || '').trim();
    if (isPlaceholderSong(existingTitle)) continue;

    const existingLower = existingTitle.toLowerCase();
    if (existingLower === cleanTitle || 
        (cleanTitle.length >= 4 && (existingLower.includes(cleanTitle) || cleanTitle.includes(existingLower)))) {
      return p;
    }
  }
  return null;
}

function getRegisteredPerformersList(excludeName = '') {
  const s = new Set();
  performances.forEach(p => {
    if (p.performer_name && p.performer_name.trim()) s.add(p.performer_name.trim());
    if (p.partner_name && p.partner_name.trim()) s.add(p.partner_name.trim());
  });
  return Array.from(s)
    .filter(n => !excludeName || n.toLowerCase() !== excludeName.toLowerCase())
    .sort((a, b) => a.localeCompare(b));
}

function setupPartnerAutocomplete(inputEl, dupBoxEl, listEl, getExcludedNames) {
  if (!inputEl || !dupBoxEl || !listEl) return;
  inputEl.addEventListener('input', () => {
    const val = inputEl.value.trim().toLowerCase();
    if (val.length < 3) {
      dupBoxEl.classList.add('hidden');
      return;
    }
    const excluded = (getExcludedNames ? getExcludedNames() : []).map(x => x.toLowerCase());
    const candidates = getRegisteredPerformersList().filter(name => !excluded.includes(name.toLowerCase()));
    const matches = candidates.filter(name => {
      const n = name.toLowerCase();
      return n === val || n.startsWith(val) || n.includes(val);
    });

    if (matches.length > 0) {
      listEl.innerHTML = '';
      matches.forEach(m => {
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs shadow transition';
        pill.textContent = m;
        pill.addEventListener('click', () => {
          inputEl.value = m;
          dupBoxEl.classList.add('hidden');
          inputEl.dispatchEvent(new Event('change'));
        });
        listEl.appendChild(pill);
      });
      dupBoxEl.classList.remove('hidden');
    } else {
      dupBoxEl.classList.add('hidden');
    }
  });
}

function setupGroupAutocomplete(inputEl, dupBoxEl, listEl, getExcludedNames) {
  if (!inputEl || !dupBoxEl || !listEl) return;
  inputEl.addEventListener('input', () => {
    const rawVal = inputEl.value;
    const parts = rawVal.split(',');
    const activePart = parts[parts.length - 1].trim().toLowerCase();
    if (activePart.length < 3) {
      dupBoxEl.classList.add('hidden');
      return;
    }

    const alreadyEntered = parts.slice(0, -1).map(p => p.trim().toLowerCase());
    const excluded = [...(getExcludedNames ? getExcludedNames() : []), ...alreadyEntered].map(x => x.toLowerCase());
    const candidates = getRegisteredPerformersList().filter(name => !excluded.includes(name.toLowerCase()));
    const matches = candidates.filter(name => {
      const n = name.toLowerCase();
      return n === activePart || n.startsWith(activePart) || n.includes(activePart);
    });

    if (matches.length > 0) {
      listEl.innerHTML = '';
      matches.forEach(m => {
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs shadow transition';
        pill.textContent = m;
        pill.addEventListener('click', () => {
          parts[parts.length - 1] = ' ' + m;
          inputEl.value = parts.map(p => p.trim()).filter(Boolean).join(', ') + ', ';
          dupBoxEl.classList.add('hidden');
          inputEl.focus();
        });
        listEl.appendChild(pill);
      });
      dupBoxEl.classList.remove('hidden');
    } else {
      dupBoxEl.classList.add('hidden');
    }
  });
}

function setupSongDuplicateWarning(inputEl, warningBoxEl, getExcludeEntryId) {
  if (!inputEl || !warningBoxEl) return;
  inputEl.addEventListener('input', () => {
    const val = inputEl.value.trim();
    const excludeId = getExcludeEntryId ? getExcludeEntryId() : null;
    const dup = findDuplicateSong(val, excludeId);
    if (dup) {
      const singer = dup.partner_name 
        ? `${escapeHtml(dup.performer_name)} & ${escapeHtml(dup.partner_name)}` 
        : escapeHtml(dup.performer_name);
      warningBoxEl.innerHTML = `
        <div class="flex items-start gap-2">
          <i data-lucide="alert-circle" class="w-4 h-4 text-amber-400 shrink-0 mt-0.5"></i>
          <div>
            <span class="font-bold text-amber-300">Song already chosen:</span>
            <span>"<strong>${escapeHtml(dup.song_title)}</strong>" has already been selected by <strong>${singer}</strong> (${escapeHtml(dup.performance_type || 'Solo')}).</span>
          </div>
        </div>
      `;
      warningBoxEl.classList.remove('hidden');
      if (window.lucide) lucide.createIcons();
    } else {
      warningBoxEl.classList.add('hidden');
      warningBoxEl.innerHTML = '';
    }
  });
}

function setupRenamePerformerModal() {
  const modal = document.getElementById('rename-performer-modal');
  const openBtn = document.getElementById('edit-performer-name-btn');
  const closeBtn = document.getElementById('close-rename-modal-btn');
  const cancelBtn = document.getElementById('cancel-rename-btn');
  const form = document.getElementById('rename-performer-form');
  const nameInput = document.getElementById('new-performer-name-input');
  const errorMsg = document.getElementById('rename-error-msg');
  const saveBtn = document.getElementById('save-rename-btn');

  if (!modal || !openBtn || !form) return;

  const hideModal = () => {
    modal.classList.add('hidden');
    if (errorMsg) {
      errorMsg.classList.add('hidden');
      errorMsg.textContent = '';
    }
  };

  openBtn.addEventListener('click', () => {
    if (!selectedPerformer) return;
    nameInput.value = selectedPerformer;
    errorMsg.classList.add('hidden');
    errorMsg.textContent = '';
    modal.classList.remove('hidden');
    nameInput.focus();
    if (window.lucide) lucide.createIcons();
  });

  closeBtn?.addEventListener('click', hideModal);
  cancelBtn?.addEventListener('click', hideModal);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const newName = nameInput.value.trim();
    if (!newName || newName.length < 2) {
      errorMsg.textContent = 'Name must be at least 2 characters.';
      errorMsg.classList.remove('hidden');
      return;
    }

    if (newName.toLowerCase() === selectedPerformer.toLowerCase()) {
      hideModal();
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    errorMsg.classList.add('hidden');

    try {
      const res = await fetch('/api/performer/rename', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          old_name: selectedPerformer,
          new_name: newName
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Could not rename performer');
      }

      hideModal();
      selectedPerformer = newName;
      await loadPerformances();
      const select = document.getElementById('performer-select');
      if (select) select.value = newName;
      await handlePerformerSelected(newName);
      showToast(`✓ Participant renamed to ${newName}`);
    } catch (err) {
      errorMsg.textContent = err.message || 'Error renaming participant';
      errorMsg.classList.remove('hidden');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Name';
    }
  });
}

function setupEditModalEvents() {
  const modal = document.getElementById('edit-song-modal');
  const closeBtn = document.getElementById('close-edit-modal-btn');
  const cancelBtn = document.getElementById('cancel-edit-btn');
  const form = document.getElementById('edit-song-form');
  const perfTypeSelect = document.getElementById('edit-perf-type');

  const hideModal = () => modal.classList.add('hidden');
  closeBtn.addEventListener('click', hideModal);
  cancelBtn.addEventListener('click', hideModal);

  perfTypeSelect.addEventListener('change', (e) => {
    const val = e.target.value;
    document.getElementById('edit-partner-row').classList.toggle('hidden', val !== 'Duet');
    document.getElementById('edit-partner-phone-row')?.classList.toggle('hidden', val !== 'Duet');
    document.getElementById('edit-group-members-row').classList.toggle('hidden', val !== 'Group');
  });

  setupPartnerAutocomplete(
    document.getElementById('edit-partner-name'),
    document.getElementById('edit-partner-dup-box'),
    document.getElementById('edit-partner-matched-list'),
    () => selectedPerformer ? [selectedPerformer] : []
  );

  setupGroupAutocomplete(
    document.getElementById('edit-group-members'),
    document.getElementById('edit-group-dup-box'),
    document.getElementById('edit-group-matched-list'),
    () => selectedPerformer ? [selectedPerformer] : []
  );

  setupSongDuplicateWarning(
    document.getElementById('edit-song-title'),
    document.getElementById('edit-song-dup-warning'),
    () => document.getElementById('edit-entry-id').value
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const entryId = document.getElementById('edit-entry-id').value;
    const songTitle = document.getElementById('edit-song-title').value.trim();
    const perfType = document.getElementById('edit-perf-type').value;
    const partnerName = document.getElementById('edit-partner-name').value.trim();
    const groupMembers = document.getElementById('edit-group-members').value.trim();
    const ytUrl = document.getElementById('edit-youtube-url').value.trim();
    const movieName = document.getElementById('edit-movie-name')?.value.trim() || '';
    const stageNotes = document.getElementById('edit-stage-notes')?.value.trim() || '';

    const isAcousticChecked = document.getElementById('edit-acoustic-check')?.checked;
    const partnerPhone = document.getElementById('edit-partner-phone')?.value.trim() || '';

    if (perfType === 'Duet' && partnerPhone && partnerPhone.replace(/\D/g, '').length < 10) {
      alert('Please enter a valid 10-digit phone number for the partner.');
      return;
    }

    const saveBtn = document.getElementById('save-edit-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
      const res = await fetch(`/api/signup/performance/${entryId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          song_title: songTitle,
          performance_type: perfType,
          partner_name: perfType === 'Duet' ? partnerName : '',
          partner_phone: perfType === 'Duet' ? partnerPhone : '',
          group_members: perfType === 'Group' ? groupMembers : '',
          movie_name: movieName,
          stage_notes: stageNotes,
          youtube_url: ytUrl,
          track_status: isAcousticChecked ? 'Acoustic' : (selectedEntry && selectedEntry.track_status === 'Acoustic' ? 'Pending' : undefined)
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Could not update performance');
      }

      hideModal();
      await loadPerformances();
      if (selectedPerformer) {
        handlePerformerSelected(selectedPerformer);
      }
    } catch (err) {
      alert(err.message || 'Error updating song details');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Changes';
    }
  });
}

function openEditSongModal(song) {
  document.getElementById('edit-entry-id').value = song.entry_id;
  const isPlaceholder = isPlaceholderSong(song.song_title);
  const songTitleInput = document.getElementById('edit-song-title');
  songTitleInput.value = isPlaceholder ? '' : (song.song_title || '');
  
  const perfTypeSelect = document.getElementById('edit-perf-type');
  if (perfTypeSelect) {
    const allowDuets = !window.performerProfileData || window.performerProfileData.allow_duets !== false;
    const duetOpt = perfTypeSelect.querySelector('option[value="Duet"]');
    const groupOpt = perfTypeSelect.querySelector('option[value="Group"]');
    if (duetOpt) duetOpt.disabled = !allowDuets;
    if (groupOpt) groupOpt.disabled = !allowDuets;
  }
  perfTypeSelect.value = song.performance_type || 'Solo';
  document.getElementById('edit-partner-name').value = song.partner_name || '';
  const partnerPhoneInput = document.getElementById('edit-partner-phone');
  if (partnerPhoneInput) {
    partnerPhoneInput.value = song.partner_phone || '';
  }
  const partnerPhoneRow = document.getElementById('edit-partner-phone-row');
  if (partnerPhoneRow) {
    if (song.performance_type === 'Duet') {
      partnerPhoneRow.classList.remove('hidden');
    } else {
      partnerPhoneRow.classList.add('hidden');
    }
  }
  document.getElementById('edit-group-members').value = song.group_members || '';
  document.getElementById('edit-youtube-url').value = song.youtube_url || '';

  const movieNameInput = document.getElementById('edit-movie-name');
  if (movieNameInput) {
    movieNameInput.value = song.movie_name || '';
  }

  const stageNotesInput = document.getElementById('edit-stage-notes');
  if (stageNotesInput) {
    stageNotesInput.value = song.stage_notes || '';
  }

  const acousticCheck = document.getElementById('edit-acoustic-check');
  if (acousticCheck) {
    acousticCheck.checked = song.track_status === 'Acoustic';
  }

  const songDupWarn = document.getElementById('edit-song-dup-warning');
  if (songDupWarn) { songDupWarn.classList.add('hidden'); songDupWarn.innerHTML = ''; }
  const partnerDup = document.getElementById('edit-partner-dup-box');
  if (partnerDup) partnerDup.classList.add('hidden');
  const groupDup = document.getElementById('edit-group-dup-box');
  if (groupDup) groupDup.classList.add('hidden');

  document.getElementById('edit-partner-row').classList.toggle('hidden', perfTypeSelect.value !== 'Duet');
  document.getElementById('edit-group-members-row').classList.toggle('hidden', perfTypeSelect.value !== 'Group');

  document.getElementById('edit-song-modal').classList.remove('hidden');
  setTimeout(() => {
    if (songTitleInput) {
      songTitleInput.focus();
      if (songTitleInput.value) songTitleInput.select();
    }
  }, 100);
  if (window.lucide) lucide.createIcons();
}

function setupFoodSelectorEvents() {
  const selectorCard = document.getElementById('food-selector-card');
  const closeBtn = document.getElementById('close-food-selector-btn');
  const cancelBtn = document.getElementById('cancel-food-btn');
  const saveBtn = document.getElementById('save-food-btn');

  const hideSelector = () => selectorCard.classList.add('hidden');
  closeBtn.addEventListener('click', hideSelector);
  cancelBtn.addEventListener('click', hideSelector);

  saveBtn.addEventListener('click', async () => {
    if (!selectedPerformer) return;
    const selectedRadio = document.querySelector('input[name="food_item_radio"]:checked');
    if (!selectedRadio) {
      alert('Please select an item from the list.');
      return;
    }

    const itemId = selectedRadio.value;
    const dishDesc = document.getElementById('food-dish-input').value.trim();

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
      if (performerFoodSignup && performerFoodSignup.signup_id) {
        // Update existing food signup
        const res = await fetch(`/api/signup/food/${performerFoodSignup.signup_id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            item_id: itemId,
            dish_description: dishDesc
          })
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.detail || 'Could not update food item');
        }
      } else {
        // Create new food signup
        const res = await fetch('/api/signup/food', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            signer_name: selectedPerformer,
            item_id: itemId,
            dish_description: dishDesc
          })
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.detail || 'Could not claim food item');
        }
      }

      hideSelector();
      await loadFoodCatalog();
      await checkPerformerFoodStatus(selectedPerformer);
    } catch (err) {
      alert(err.message || 'Error saving food choice');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Food Sign-Up';
    }
  });
}

async function handleRefreshClick() {
  const btn = document.getElementById('refresh-data-btn');
  if (btn) {
    btn.classList.add('opacity-50', 'pointer-events-none');
    const icon = btn.querySelector('i');
    if (icon) icon.classList.add('animate-spin');
  }

  try {
    const res = await fetch('/api/sync', { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      updateIntakeSyncBadge(data.last_synced_at);
    }
  } catch (e) {
    console.warn("Sync error:", e);
  }

  await loadPerformances();
  await loadFoodCatalog();
  if (selectedPerformer) {
    handlePerformerSelected(selectedPerformer);
  }

  if (btn) {
    btn.classList.remove('opacity-50', 'pointer-events-none');
    const icon = btn.querySelector('i');
    if (icon) icon.classList.remove('animate-spin');
  }
  if (window.lucide) lucide.createIcons();
}

function updateIntakeSyncBadge(isoString) {
  const badge = document.getElementById('sync-status-indicator');
  const text = document.getElementById('sync-status-text');
  if (!badge || !text) return;
  text.textContent = `● Synced ${formatTimeAgo(isoString)}`;
  if (isoString) {
    badge.title = `Last synchronized: ${new Date(isoString).toLocaleString()}`;
  }
}

function formatTimeAgo(isoString) {
  if (!isoString) return 'Just now';
  const date = new Date(isoString);
  const now = new Date();
  const diffSec = Math.floor((now - date) / 1000);
  if (diffSec < 15) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  return `${diffHr}h ago`;
}

async function handlePerformerSelected(name) {
  if (name) { try { localStorage.setItem(NAME_KEY, name); } catch (_) { /* private mode */ } }
  const songSection = document.getElementById('song-selection-section');
  const uploadSection = document.getElementById('upload-methods-section');
  const songContainer = document.getElementById('song-options-container');
  const selectedBar = document.getElementById('selected-performer-bar');
  const selectedNameDisplay = document.getElementById('selected-performer-display-name');

  if (!name) {
    if (selectedBar) selectedBar.classList.add('hidden');
    songSection.classList.add('hidden');
    uploadSection.classList.add('hidden');
    document.getElementById('food-cta-section').classList.add('hidden');
    document.getElementById('food-selector-card').classList.add('hidden');
    selectedEntry = null;
    return;
  }

  if (selectedBar && selectedNameDisplay) {
    selectedBar.classList.remove('hidden');
    selectedNameDisplay.textContent = name;
    if (window.lucide) lucide.createIcons();
  }

  // Load food status
  await checkPerformerFoodStatus(name);

  // When stage performances are disabled (e.g. potluck-only event), suppress performance & upload UI completely
  const isStageEnabled = !window.performerProfileData || window.performerProfileData.stage_performances_enabled !== false;
  if (!isStageEnabled) {
    songSection.classList.add('hidden');
    uploadSection.classList.add('hidden');
    const acousticNotice = document.getElementById('acoustic-event-notice-card');
    if (acousticNotice) acousticNotice.classList.add('hidden');
    const othersSection = document.getElementById('others-songs-section');
    if (othersSection) othersSection.classList.add('hidden');
    const addPerfBtn = document.getElementById('add-performance-btn');
    if (addPerfBtn) addPerfBtn.classList.add('hidden');
    const editNameBtn = document.getElementById('edit-performer-name-btn');
    if (editNameBtn) editNameBtn.classList.add('hidden');
    selectedEntry = null;
    return;
  }

  // Find all performances for this person
  const userSongs = performances.filter(p => 
    p.performer_name.trim().toLowerCase() === name.toLowerCase() ||
    (p.partner_name && p.partner_name.trim().toLowerCase() === name.toLowerCase())
  );

  if (userSongs.length === 0) {
    songContainer.innerHTML = '<p class="text-xs text-amber-400">No registered songs found for this name.</p>';
    songSection.classList.remove('hidden');
    uploadSection.classList.add('hidden');
    return;
  }

  songContainer.innerHTML = '';
  userSongs.forEach((song, idx) => {
    const isChecked = idx === 0;
    if (isChecked) {
      updateSelectedSong(song);
    }

    let statusClass = 'bg-amber-500/20 text-amber-300 border-amber-500/30';
    let statusLabel = 'Track Pending';
    if (song.track_status === 'Uploaded') {
      statusClass = 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
      statusLabel = 'Track Uploaded';
    } else if (song.track_status === 'Acoustic') {
      statusClass = 'bg-blue-500/20 text-blue-300 border-blue-500/30';
      statusLabel = 'Acoustic / No Track';
    } else if (isSongTitleMissing(song)) {
      statusClass = 'bg-rose-500/20 text-rose-300 border-rose-500/30';
      statusLabel = 'Song Name Missing';
    }

    const card = document.createElement('div');
    card.className = `p-3.5 rounded-xl border transition flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
      isChecked ? 'border-orange-500 bg-orange-500/10' : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
    }`;
    card.innerHTML = `
      <label class="flex items-center gap-3 cursor-pointer flex-1 min-w-0">
        <input type="radio" name="selected_song" value="${song.entry_id}" ${isChecked ? 'checked' : ''} class="text-orange-500 focus:ring-orange-500 accent-orange-500">
        <div class="truncate">
          <div class="font-semibold text-sm ${isSongTitleMissing(song) ? 'text-amber-300 italic' : 'text-white'} truncate">
            ${escapeHtml(!isSongTitleMissing(song) ? song.song_title : 'Untitled Song (Click Edit)')}
            ${song.movie_name ? `<span class="text-xs font-normal text-slate-400 ml-1.5 font-sans">(${escapeHtml(song.movie_name)})</span>` : ''}
          </div>
          <div class="text-xs text-slate-400 flex items-center gap-1.5 mt-1 flex-wrap">
            ${renderTypePill(song.performance_type)}
            ${(() => {
              const current = (selectedPerformer || '').trim().toLowerCase();
              const primary = (song.performer_name || '').trim();
              const partner = (song.partner_name || '').trim();
              if (!partner) return '';
              if (current && partner.toLowerCase() === current) {
                return `<span class="text-slate-400">with ${escapeHtml(primary)}</span>`;
              } else {
                return `<span class="text-slate-400">with ${escapeHtml(partner)}</span>`;
              }
            })()}
            <span class="text-slate-500">•</span>
            <span class="font-mono text-slate-400">Seq #${song.sequence_order || 'TBD'}</span>
          </div>
        </div>
      </label>
      <div class="flex items-center gap-2 self-end sm:self-center shrink-0">
        <span class="text-xs px-2.5 py-1 rounded-full border ${statusClass} font-medium">
          ${statusLabel}
        </span>
        ${(window.performerProfileData && window.performerProfileData.edits_enabled === false)
          ? `<span class="px-2.5 py-1 rounded-lg bg-slate-900 text-slate-500 text-xs font-semibold flex items-center gap-1 border border-slate-800" title="Edits are currently locked"><i data-lucide="lock" class="w-3.5 h-3.5"></i><span>Locked</span></span>`
          : `<button type="button" class="edit-song-btn px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1 border border-slate-700 transition" title="Edit song details">
              <i data-lucide="edit-2" class="w-3.5 h-3.5 text-orange-400"></i>
              <span>Edit</span>
            </button>`}
      </div>
    `;

    card.querySelector('input').addEventListener('change', () => {
      document.querySelectorAll('#song-options-container > div').forEach(c => {
        c.className = 'p-3.5 rounded-xl border transition flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-slate-800 bg-slate-950/60 hover:border-slate-700';
      });
      card.className = 'p-3.5 rounded-xl border transition flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-orange-500 bg-orange-500/10';
      updateSelectedSong(song);
    });

    const editBtn = card.querySelector('.edit-song-btn');
    if (editBtn) {
      editBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        openEditSongModal(song);
      });
    }

    songContainer.appendChild(card);
  });

  songSection.classList.remove('hidden');

  const uploadsEnabled = !window.performerProfileData || window.performerProfileData.track_upload_enabled !== false;
  const acousticNotice = document.getElementById('acoustic-event-notice-card');
  if (!uploadsEnabled) {
    if (acousticNotice) acousticNotice.classList.remove('hidden');
    if (uploadSection) uploadSection.classList.add('hidden');
  } else {
    if (acousticNotice) acousticNotice.classList.add('hidden');
    if (uploadSection) uploadSection.classList.remove('hidden');
  }

  const addPerfBtn = document.getElementById('add-performance-btn');
  if (addPerfBtn) {
    if (window.performerProfileData && window.performerProfileData.edits_enabled === false) {
      addPerfBtn.classList.add('hidden');
    } else if (userSongs.length < maxPerformancesPerParticipant) {
      addPerfBtn.classList.remove('hidden');
    } else {
      addPerfBtn.classList.add('hidden');
    }
  }

  const editNameBtn = document.getElementById('edit-performer-name-btn');
  if (editNameBtn) {
    if (window.performerProfileData && window.performerProfileData.edits_enabled === false) {
      editNameBtn.classList.add('hidden');
    } else {
      editNameBtn.classList.remove('hidden');
    }
  }

  if (window.lucide) lucide.createIcons();
}

async function checkPerformerFoodStatus(name) {
  const ctaSection = document.getElementById('food-cta-section');
  try {
    const res = await fetch(`/api/performer/profile?name=${encodeURIComponent(name)}`);
    if (res.ok) {
      const data = await res.json();
      window.performerProfileData = data;

      if (data.food_enabled === false) {
        ctaSection.classList.add('hidden');
        document.getElementById('food-selector-card')?.classList.add('hidden');
        return;
      }

      performerFoodSignup = data.food_signup;

      if (performerFoodSignup && performerFoodSignup.item_id) {
        // User has claimed food item -> Green Card
        ctaSection.innerHTML = `
          <div class="p-4 rounded-2xl bg-emerald-950/40 border border-emerald-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div class="flex items-start gap-3">
              <div class="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                <i data-lucide="utensils" class="w-4 h-4"></i>
              </div>
              <div>
                <div class="flex items-center gap-2">
                  <h4 class="text-sm font-bold text-white">${escapeHtml(performerFoodSignup.item_name)}</h4>
                  <span class="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-200 font-bold border border-amber-500/40">YOURS</span>
                </div>
                <p class="text-xs text-slate-300 mt-0.5">${performerFoodSignup.dish_description ? escapeHtml(performerFoodSignup.dish_description) : 'No description provided'}</p>
                <p class="text-[11px] text-emerald-400/80 mt-0.5">Group: ${escapeHtml(performerFoodSignup.group_name)} &bull; ${escapeHtml(foodServingNote)}</p>
              </div>
            </div>
            <div class="flex items-center gap-2 self-end sm:self-center">
              <button type="button" id="change-food-btn" class="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 transition flex items-center gap-1">
                <i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i>
                <span>Change Dish</span>
              </button>
              <button type="button" id="release-food-btn" class="px-3 py-1.5 rounded-xl bg-rose-950/60 hover:bg-rose-900/60 text-xs font-semibold text-rose-300 border border-rose-500/40 transition flex items-center gap-1">
                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                <span>Release</span>
              </button>
            </div>
          </div>
        `;

        document.getElementById('change-food-btn').addEventListener('click', () => {
          openFoodSelector(performerFoodSignup.item_id, performerFoodSignup.dish_description);
        });

        document.getElementById('release-food-btn').addEventListener('click', async () => {
          if (!confirm(`Release "${performerFoodSignup.item_name}"?\n\nThis frees the slot for someone else. You can pick another dish any time.`)) return;
          try {
            const delRes = await fetch(`/api/signup/food/${performerFoodSignup.signup_id}`, { method: 'DELETE' });
            if (!delRes.ok) throw new Error('release failed');
            await loadFoodCatalog();
            await checkPerformerFoodStatus(selectedPerformer);
            showToast('Dish released.', 'success');
          } catch (e) {
            alert('We could not release your dish. Please try again.');
          }
        });

      } else {
        // No food item claimed -> Yellow CTA Card
        ctaSection.innerHTML = `
          <div class="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div class="flex items-start gap-3">
              <div class="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0 mt-0.5">
                <i data-lucide="utensils" class="w-4 h-4"></i>
              </div>
              <div>
                <h4 class="text-sm font-bold text-white">You have not picked a dish yet</h4>
                <p class="text-xs text-amber-300/90 mt-0.5">You do not have to perform to bring a dish. Pick an open slot from the food board.</p>
                <p class="text-[11px] text-slate-400 mt-0.5">${escapeHtml(foodServingNote)}</p>
              </div>
            </div>
            <button type="button" id="pick-food-btn" class="px-3.5 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-xs font-bold text-white shadow-md shadow-amber-500/20 transition flex items-center gap-1.5 shrink-0 self-end sm:self-center">
              <i data-lucide="plus-circle" class="w-3.5 h-3.5"></i>
              <span>Pick a Dish</span>
            </button>
          </div>
        `;

        document.getElementById('pick-food-btn').addEventListener('click', () => {
          openFoodSelector();
        });

        // If deep linked food item exists, auto-open selector
        if (pendingDeepLinkFoodItem) {
          openFoodSelector(pendingDeepLinkFoodItem);
          pendingDeepLinkFoodItem = null;
        }
      }

      ctaSection.classList.remove('hidden');
      if (window.lucide) lucide.createIcons();
    }
  } catch (e) {
    console.warn('Could not fetch performer food status:', e);
  }
}

function openFoodSelector(preselectItemId = null, prefillDesc = '') {
  const selectorCard = document.getElementById('food-selector-card');
  const pickerContainer = document.getElementById('food-groups-picker');
  const dishInput = document.getElementById('food-dish-input');

  dishInput.value = prefillDesc || '';

  // Render food groups and items
  let html = '';
  allFoodGroups.forEach(group => {
    const items = allFoodItems.filter(i => i.group_id === group.group_id);
    if (items.length === 0) return; // Hide empty groups

    html += `
      <div class="space-y-2">
        <h5 class="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
          <span>●</span>
          <span>${escapeHtml(group.name)}</span>
        </h5>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
    `;

    items.forEach(item => {
      const isClaimedByOther = item.is_taken && (!performerFoodSignup || performerFoodSignup.item_id !== item.item_id);
      const isOwn = Boolean(performerFoodSignup && performerFoodSignup.item_id === item.item_id);
      const isSelected = preselectItemId ? item.item_id === preselectItemId : (performerFoodSignup && performerFoodSignup.item_id === item.item_id);

      if (isClaimedByOther) {
        html += `
          <div class="p-2.5 rounded-xl bg-slate-950/40 border border-slate-800/60 opacity-60 flex items-center justify-between text-xs">
            <span class="text-slate-400 line-through">${escapeHtml(item.name)}</span>
            <span class="text-[10px] text-rose-400 font-mono">Taken${item.signer_name ? ' \u00b7 ' + escapeHtml(item.signer_name) : ''}</span>
          </div>
        `;
      } else {
        html += `
          <label class="p-2.5 rounded-xl border flex items-center justify-between text-xs cursor-pointer transition ${
            isSelected ? 'bg-amber-500/15 border-amber-500/60 text-white' : 'bg-slate-950 border-slate-800 text-slate-200 hover:border-slate-700'
          }">
            <div class="flex items-center gap-2">
              <input type="radio" name="food_item_radio" value="${item.item_id}" ${isSelected ? 'checked' : ''} class="text-amber-500 accent-amber-500 focus:ring-amber-500">
              <span class="font-medium">${escapeHtml(item.name)}</span>
            </div>
            <span class="text-[10px] font-semibold uppercase ${isOwn ? 'text-amber-300' : 'text-emerald-400'}">${isOwn ? 'Yours' : 'Open'}</span>
          </label>
        `;
      }
    });

    html += `</div></div>`;
  });

  pickerContainer.innerHTML = html;
  selectorCard.classList.remove('hidden');

  // Handle radio select highlighting
  document.querySelectorAll('input[name="food_item_radio"]').forEach(r => {
    r.addEventListener('change', () => {
      document.querySelectorAll('#food-groups-picker label').forEach(lbl => {
        lbl.className = 'p-2.5 rounded-xl border flex items-center justify-between text-xs cursor-pointer transition bg-slate-950 border-slate-800 text-slate-200 hover:border-slate-700';
      });
      r.closest('label').className = 'p-2.5 rounded-xl border flex items-center justify-between text-xs cursor-pointer transition bg-amber-500/15 border-amber-500/60 text-white';
    });
  });

  selectorCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (window.lucide) lucide.createIcons();
}

function updateSelectedSong(song) {
  selectedEntry = song;
  const missingAlert = document.getElementById('missing-song-alert');
  const submitBtn = document.getElementById('submit-btn');
  const acousticBanner = document.getElementById('acoustic-notice-banner');
  const acousticToggle = document.getElementById('acoustic-toggle-container');

  if (isSongTitleMissing(song)) {
    missingAlert.classList.remove('hidden');
  } else {
    missingAlert.classList.add('hidden');
  }

  // Acoustic state rendering
  if (song.track_status === 'Acoustic') {
    if (acousticBanner) acousticBanner.classList.remove('hidden');
    if (acousticToggle) acousticToggle.classList.add('hidden');
  } else {
    if (acousticBanner) acousticBanner.classList.add('hidden');
    if (acousticToggle) acousticToggle.classList.remove('hidden');
  }

  updateSubmitButtonText();

  if (song.youtube_url) {
    document.getElementById('youtube-url-input').value = song.youtube_url;
  }

  updateActiveTrackBadge();
  updateActiveTrackPreview(song);
}

function audioExts() { return (allowedMedia && !allowedMedia.includes('audio')) ? [] : allowedExts.filter(e => !VIDEO_EXTS.includes(e)); }
function videoExts() { return (allowedMedia && !allowedMedia.includes('video')) ? [] : allowedExts.filter(e => VIDEO_EXTS.includes(e)); }
function extList(list) { return list.map(e => e.toUpperCase()).join(', ').replace(/, ([^,]*)$/, ' or $1'); }
function limitHintText() {
  const parts = [];
  if (audioExts().length) parts.push(`${extList(audioExts())} up to ${maxAudioMb} MB`);
  if (videoExts().length) parts.push(`${extList(videoExts())} video up to ${maxVideoMb} MB`);
  return parts.join('. ') + '. Or paste a YouTube or SoundCloud link.';
}

function setMediaType(type) {
  currentMediaType = type;
  const audioBtn = document.getElementById('type-audio-btn');
  const videoBtn = document.getElementById('type-video-btn');
  const badge = document.getElementById('media-type-badge');
  const hint = document.getElementById('media-type-hint');
  const fileInput = document.getElementById('audio-file-input');
  const label = document.getElementById('file-select-label');
  const sizeHint = document.getElementById('max-size-hint');
  const exts = type === 'video' ? videoExts() : audioExts();

  if (audioBtn) audioBtn.classList.toggle('hidden', audioExts().length === 0);
  if (videoBtn) videoBtn.classList.toggle('hidden', videoExts().length === 0);

  if (type === 'video') {
    if (audioBtn) audioBtn.className = 'py-2.5 px-3 rounded-lg text-slate-400 hover:text-slate-200 flex items-center justify-center gap-1.5 transition' + (audioExts().length ? '' : ' hidden');
    if (videoBtn) videoBtn.className = 'py-2.5 px-3 rounded-lg bg-purple-600 text-white flex items-center justify-center gap-1.5 transition shadow';
    if (badge) {
      badge.textContent = `Video (${extList(exts)})`;
      badge.className = 'text-[10px] px-2 py-0.5 rounded-full bg-purple-950/80 text-purple-300 border border-purple-500/40 font-medium';
    }
    if (hint) hint.textContent = 'Video plays on the stage monitor (720p). The sound team checks length and sound before it goes live.';
    if (label && label.textContent.includes('audio')) label.textContent = 'Tap to select or drag a video file here';
  } else {
    if (audioBtn) audioBtn.className = 'py-2.5 px-3 rounded-lg bg-orange-500 text-white flex items-center justify-center gap-1.5 transition shadow';
    if (videoBtn) videoBtn.className = 'py-2.5 px-3 rounded-lg text-slate-400 hover:text-slate-200 flex items-center justify-center gap-1.5 transition' + (videoExts().length ? '' : ' hidden');
    if (badge) {
      badge.textContent = `Audio (${extList(exts)})`;
      badge.className = 'text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-orange-400 border border-slate-700 font-medium';
    }
    if (hint) hint.textContent = 'A normal audio backing track for the venue sound system.';
    if (label && label.textContent.includes('video')) label.textContent = 'Tap to select or drag an audio file here';
  }
  if (fileInput) fileInput.accept = exts.map(e => '.' + e).join(',');
  if (sizeHint) sizeHint.textContent = limitHintText();
  updateSubmitButtonText();
  if (window.lucide) lucide.createIcons();
}

function updateSubmitButtonText() {
  const submitBtn = document.getElementById('submit-btn');
  const submitText = document.getElementById('submit-text');

  if (!submitBtn || !submitText || !selectedEntry) return;

  if (isSongTitleMissing(selectedEntry)) {
    submitBtn.disabled = false;
    submitBtn.className = 'w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-slate-950 font-bold text-sm shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 transition cursor-pointer';
    submitText.innerHTML = '<span class="flex items-center justify-center gap-1.5"><i data-lucide="edit-3" class="w-4 h-4"></i> Add Song Title to Upload Track</span>';
    if (window.lucide) lucide.createIcons();
    return;
  }

  submitBtn.disabled = false;
  submitBtn.className = 'w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white font-bold text-sm shadow-lg shadow-orange-500/25 flex items-center justify-center gap-2 transition disabled:opacity-50 disabled:cursor-not-allowed';

  const isReplacing = selectedEntry.track_status === 'Uploaded' || selectedEntry.drive_file_id;
  const isVideo = currentMediaType === 'video';

  if (currentMethod === 'youtube') {
    submitText.textContent = isReplacing
      ? (isVideo ? 'Extract & Replace Video Track' : 'Extract & Replace Track')
      : (isVideo ? 'Extract Video Track from YouTube' : 'Extract & Upload Track');
  } else {
    submitText.textContent = isReplacing
      ? (isVideo ? 'Replace with New Video Track' : 'Replace Existing Track')
      : (isVideo ? 'Upload Video Track' : 'Upload Track');
  }
  if (window.lucide) lucide.createIcons();
}

let previewWavesurfer = null;

function initPreviewWaveSurfer() {
  const container = document.getElementById('preview-waveform-inner');
  if (!container || typeof WaveSurfer === 'undefined') return;

  if (previewWavesurfer) {
    try { previewWavesurfer.destroy(); } catch (e) {}
  }

  container.innerHTML = '';
  previewWavesurfer = WaveSurfer.create({
    container: container,
    waveColor: '#64748b',
    progressColor: '#f97316',
    cursorColor: '#fb923c',
    cursorWidth: 2,
    barWidth: 2,
    barGap: 1,
    barRadius: 2,
    height: 38,
    normalize: true
  });

  const playBtn = document.getElementById('preview-play-btn');
  if (playBtn) {
    playBtn.innerHTML = '<i data-lucide="play" class="w-4 h-4 ml-0.5"></i>';
    if (window.lucide) lucide.createIcons();
  }

  previewWavesurfer.on('play', () => {
    window.auroraEffect?.setActive(true);
    if (playBtn) {
      playBtn.innerHTML = '<i data-lucide="pause" class="w-4 h-4 text-white fill-current"></i>';
      if (window.lucide) lucide.createIcons();
    }
  });

  previewWavesurfer.on('pause', () => {
    window.auroraEffect?.setActive(false);
    if (playBtn) {
      playBtn.innerHTML = '<i data-lucide="play" class="w-4 h-4 text-white fill-current ml-0.5"></i>';
      if (window.lucide) lucide.createIcons();
    }
  });

  previewWavesurfer.on('finish', () => {
    window.auroraEffect?.setActive(false);
    if (playBtn) {
      playBtn.innerHTML = '<i data-lucide="play" class="w-4 h-4 text-white fill-current ml-0.5"></i>';
      if (window.lucide) lucide.createIcons();
    }
  });

  if (playBtn) {
    playBtn.onclick = () => {
      if (previewWavesurfer) previewWavesurfer.playPause();
    };
  }
}

async function updateActiveTrackPreview(song) {
  const existingCard = document.getElementById('existing-track-card');
  const actionTitle = document.getElementById('upload-action-title');
  const audioContainer = document.getElementById('preview-audio-container');
  const videoContainer = document.getElementById('preview-video-container');
  const videoPlayer = document.getElementById('preview-video-player');

  if (song.track_status !== 'Uploaded' && !song.drive_file_id) {
    existingCard.classList.add('hidden');
    if (previewWavesurfer) {
      try { previewWavesurfer.stop(); } catch (e) {}
    }
    if (videoPlayer) {
      videoPlayer.pause();
      videoPlayer.src = '';
    }
    actionTitle.textContent = 'Provide Backing Track';
    return;
  }

  try {
    const res = await fetch(`/api/track-info/${song.entry_id}`);
    if (res.ok) {
      const data = await res.json();
      if (data.exists) {
        document.getElementById('track-filename-display').textContent = data.filename;
        document.getElementById('track-size-badge').textContent = data.size_formatted;
        document.getElementById('track-duration-display').textContent = data.duration_formatted;
        existingCard.classList.remove('hidden');
        actionTitle.textContent = 'Replace Existing Track (Optional)';

        const isVideo = (data.media_type === 'video') || (data.filename && data.filename.endsWith('.mp4'));
        if (isVideo) {
          if (audioContainer) audioContainer.classList.add('hidden');
          if (videoContainer) videoContainer.classList.remove('hidden');
          if (videoPlayer) {
            videoPlayer.src = `${data.stream_url}?t=${Date.now()}`;
          }
          if (previewWavesurfer) {
            try { previewWavesurfer.stop(); } catch (e) {}
          }
          setMediaType('video');
        } else {
          if (videoContainer) videoContainer.classList.add('hidden');
          if (videoPlayer) {
            videoPlayer.pause();
            videoPlayer.src = '';
          }
          if (audioContainer) audioContainer.classList.remove('hidden');
          initPreviewWaveSurfer();
          if (previewWavesurfer) {
            previewWavesurfer.load(`${data.stream_url}?t=${Date.now()}`);
          }
          setMediaType('audio');
        }

        if (window.lucide) lucide.createIcons();
        return;
      }
    }
  } catch (e) {
    console.warn('Could not fetch track metadata:', e);
  }

  existingCard.classList.add('hidden');
  actionTitle.textContent = 'Provide Backing Track';
}

function updateActiveTrackBadge() {
  const badge = document.getElementById('active-track-badge');
  if (!selectedEntry) return;

  if (isSongTitleMissing(selectedEntry)) {
    badge.innerHTML = '<span class="text-rose-400 flex items-center gap-1"><i data-lucide="alert-triangle" class="w-3.5 h-3.5"></i> Title Missing</span>';
  } else if (selectedEntry.track_status === 'Acoustic') {
    badge.innerHTML = '<span class="text-blue-400 flex items-center gap-1"><i data-lucide="guitar" class="w-3.5 h-3.5"></i> Acoustic (No Track)</span>';
  } else if (selectedEntry.track_status === 'Uploaded' || selectedEntry.drive_file_id) {
    badge.innerHTML = '<span class="text-emerald-400 flex items-center gap-1"><i data-lucide="check" class="w-3.5 h-3.5"></i> Track on file</span>';
  } else {
    badge.innerHTML = '<span class="text-amber-400 flex items-center gap-1"><i data-lucide="clock" class="w-3.5 h-3.5"></i> No track yet</span>';
  }
  if (window.lucide) lucide.createIcons();
}

function fileExt(name) {
  const m = /\.([A-Za-z0-9]+)$/.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

// Returns an error {title, text} or null.
function checkFile(file) {
  const ext = fileExt(file.name);
  if (!allowedExts.includes(ext)) {
    const kinds = [];
    if (audioExts().length) kinds.push(`${extList(audioExts())} audio`);
    if (videoExts().length) kinds.push(`${extList(videoExts())} video`);
    return {
      title: 'That file type is not allowed',
      text: `${file.name} is ${ext ? 'a .' + ext : 'an unknown'} file. Use ${kinds.join(', or ')}.`,
    };
  }
  const isVideo = VIDEO_EXTS.includes(ext);
  const limit = isVideo ? maxVideoMb : maxAudioMb;
  if (file.size > limit * 1024 * 1024) {
    return {
      title: 'File is too big',
      text: `This ${isVideo ? 'video' : 'audio'} file is ${formatBytes(file.size)}. The limit is ${maxAudioMb} MB for audio (${maxVideoMb} MB for video). Export a smaller file or paste a link instead.`,
    };
  }
  return null;
}

function handleFileSelected(file) {
  const infoBar = document.getElementById('file-info-bar');
  const nameDisplay = document.getElementById('file-name-display');
  const sizeDisplay = document.getElementById('file-size-display');
  const label = document.getElementById('file-select-label');
  const fileInput = document.getElementById('audio-file-input');
  if (!file) return;

  const problem = checkFile(file);
  if (problem) {
    if (fileInput) fileInput.value = '';
    if (infoBar) infoBar.classList.add('hidden');
    if (label) label.textContent = currentMediaType === 'video' ? 'Tap to select or drag a video file here' : 'Tap to select or drag an audio file here';
    lastSubmitFailed = false;
    showError(`${problem.title}. ${problem.text}`);
    return;
  }

  // Match the format switch to the chosen file (a .mp4 picked while "Audio" is shown, and so on).
  const wantVideo = VIDEO_EXTS.includes(fileExt(file.name));
  if (wantVideo !== (currentMediaType === 'video')) setMediaType(wantVideo ? 'video' : 'audio');

  hideError();
  nameDisplay.textContent = file.name;
  sizeDisplay.textContent = formatBytes(file.size);
  label.textContent = 'File chosen! Tap to change';
  infoBar.classList.remove('hidden');
}

// Allowed link hosts: SoundCloud and YouTube (including m., music. and youtu.be). Returns the cleaned URL or null.
function validLink(raw) {
  let u;
  try { u = new URL(raw); } catch (_) { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  return LINK_HOSTS.includes(host) ? u.toString() : null;
}

function sendUpload(formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    activeXhr = xhr;
    xhr.open('POST', '/api/upload');
    xhr.upload.onprogress = (ev) => { if (ev.lengthComputable) onProgress(ev.loaded, ev.total); };
    xhr.upload.onload = () => onProgress(null, null);
    xhr.onload = () => {
      activeXhr = null;
      let body = null;
      if ((xhr.getResponseHeader('content-type') || '').includes('application/json')) {
        try { body = JSON.parse(xhr.responseText); } catch (_) { body = null; }
      }
      resolve({ status: xhr.status, ok: xhr.status >= 200 && xhr.status < 300, body });
    };
    xhr.onerror = () => { activeXhr = null; reject(new Error('We could not reach the server. Check your connection and try again.')); };
    xhr.onabort = () => { activeXhr = null; const e = new Error('Upload cancelled.'); e.cancelled = true; reject(e); };
    xhr.ontimeout = () => { activeXhr = null; reject(new Error('The upload timed out. Try again, or paste a link instead.')); };
    xhr.send(formData);
  });
}

async function handleFormSubmit(e) {
  e.preventDefault();
  hideError();

  if (!selectedEntry) {
    lastSubmitFailed = false;
    showError('Please select a song from the list first.');
    return;
  }

  if (isSongTitleMissing(selectedEntry)) {
    openEditSongModal(selectedEntry);
    showToast('Please specify your song title before uploading a track.', 'error');
    return;
  }

  const isVideo = currentMediaType === 'video';
  const formData = new FormData();
  formData.append('entry_id', selectedEntry.entry_id);
  formData.append('submission_type', currentMethod);
  formData.append('media_type', currentMediaType);

  if (currentMethod === 'file') {
    const fileInput = document.getElementById('audio-file-input');
    if (!fileInput.files || fileInput.files.length === 0) {
      lastSubmitFailed = false;
      showError(`Please choose ${isVideo ? 'a video' : 'an audio'} file first.`);
      return;
    }
    const file = fileInput.files[0];
    const problem = checkFile(file);
    if (problem) {
      lastSubmitFailed = false;
      showError(`${problem.title}. ${problem.text}`);
      return;
    }
    formData.append('file', file);
  } else if (currentMethod === 'youtube') {
    const raw = document.getElementById('youtube-url-input').value.trim();
    if (!raw) {
      lastSubmitFailed = false;
      showError('Paste a public YouTube or SoundCloud link to one song.');
      return;
    }
    const link = validLink(raw);
    if (!link) {
      lastSubmitFailed = false;
      showError('We could not use that link. Paste a public YouTube or SoundCloud link to one song. Private videos and playlists do not work.');
      return;
    }
    formData.append('youtube_url', link);
  }

  const submitBtn = document.getElementById('submit-btn');
  const progressContainer = document.getElementById('progress-container');
  const progressBar = document.getElementById('progress-bar');
  const progressText = document.getElementById('progress-text');
  const isLink = currentMethod === 'youtube';

  submitBtn.disabled = true;
  progressContainer.classList.remove('hidden');
  progressBar.style.width = isLink ? '35%' : '0%';
  progressText.textContent = isLink
    ? 'Checking the link, then downloading and processing. This can take a minute.'
    : 'Starting upload...';

  try {
    const res = await sendUpload(formData, (loaded, total) => {
      if (loaded === null) {
        // All bytes are on the server: it now checks length and sound.
        progressBar.style.width = '100%';
        progressText.textContent = 'Upload finished. Checking length and sound...';
        return;
      }
      const pct = Math.max(1, Math.min(99, Math.round((loaded / total) * 100)));
      progressBar.style.width = pct + '%';
      progressText.textContent = `${pct}%  ·  ${formatBytes(loaded)} of ${formatBytes(total)}`;
    });

    if (!res.ok) {
      if (res.status === 413) {
        throw new Error(`The server says this file is too big. The limit is ${maxAudioMb} MB for audio (${maxVideoMb} MB for video). Export a smaller file or paste a link instead.`);
      }
      if (res.status === 502 || res.status === 504) {
        throw new Error(`The upload timed out (HTTP ${res.status}). Try again, or export a smaller file.`);
      }
      const detail = res.body && typeof res.body.detail === 'string' ? res.body.detail : '';
      throw new Error(detail || `Upload failed (HTTP ${res.status}). Please try again.`);
    }
    const result = res.body;
    if (!result) throw new Error('The upload reached the server, but its reply was unexpected. Check My entry to see if the track is there.');

    lastSubmitFailed = false;
    progressBar.style.width = '100%';
    progressText.textContent = 'Done!';

    setTimeout(() => {
      submitBtn.disabled = false;
      progressContainer.classList.add('hidden');
      document.getElementById('intake-form').classList.add('hidden');

      const successCard = document.getElementById('success-card');
      const detailsBox = document.getElementById('success-details');
      detailsBox.innerHTML = `
        <p><strong>Performer:</strong> ${escapeHtml(result.performer_name)}</p>
        <p><strong>Song:</strong> ${escapeHtml(result.song_title)}</p>
        <p><strong>Track file:</strong> <code class="text-orange-300">${escapeHtml(result.filename)}</code></p>
      `;
      successCard.classList.remove('hidden');
      if (window.lucide) lucide.createIcons();
      loadPerformances();
    }, 400);

  } catch (err) {
    submitBtn.disabled = false;
    progressContainer.classList.add('hidden');
    if (err && err.cancelled) { lastSubmitFailed = false; hideError(); return; }
    lastSubmitFailed = true;
    showError(err?.message || 'Something went wrong while uploading.');
  }
}

function showError(msg) {
  const errCard = document.getElementById('error-card');
  document.getElementById('error-message').textContent = msg;
  document.getElementById('retry-upload-btn')?.classList.toggle('hidden', !lastSubmitFailed);
  errCard.classList.remove('hidden');
  errCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (window.lucide) lucide.createIcons();
}

function hideError() {
  document.getElementById('error-card').classList.add('hidden');
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[m]);
}

function renderTypePill(perfType) {
  const raw = (perfType || 'Solo').trim();
  const lower = raw.toLowerCase();
  let colorClasses = 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30';
  if (lower.includes('duet')) {
    colorClasses = 'bg-purple-500/15 text-purple-300 border-purple-500/30';
  } else if (lower.includes('group')) {
    colorClasses = 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
  } else if (lower.includes('acoustic') || lower.includes('live')) {
    colorClasses = 'bg-amber-500/15 text-amber-300 border-amber-500/30';
  }
  return `<span class="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full border ${colorClasses} tracking-wide shrink-0">${escapeHtml(raw)}</span>`;
}

function showToast(message, type = 'success') {
  let toast = document.getElementById('intake-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'intake-toast';
    toast.className = 'fixed bottom-5 right-5 z-50 px-4 py-3 rounded-2xl text-xs font-bold text-white shadow-xl transition-all duration-300 transform translate-y-10 opacity-0 flex items-center gap-2';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = `fixed bottom-5 right-5 z-50 px-4 py-3 rounded-2xl text-xs font-bold text-white shadow-xl transition-all duration-300 transform translate-y-0 opacity-100 flex items-center gap-2 ${
    type === 'error' ? 'bg-rose-600 border border-rose-500' : 'bg-emerald-600 border border-emerald-500'
  }`;
  setTimeout(() => {
    toast.classList.add('translate-y-10', 'opacity-0');
  }, 4000);
}

function setupAddPerformanceModal() {
  const addPerfBtn = document.getElementById('add-performance-btn');
  const modal = document.getElementById('add-performance-modal');
  const closeBtn = document.getElementById('close-add-perf-modal');
  const cancelBtn = document.getElementById('cancel-add-perf-btn');
  const form = document.getElementById('add-perf-form');
  const typeSelect = document.getElementById('add-perf-type');
  const partnerRow = document.getElementById('add-perf-partner-row');
  const soloWarning = document.getElementById('add-perf-solo-warning');
  const partnerList = document.getElementById('add-perf-partner-list');

  if (!addPerfBtn || !modal) return;

  addPerfBtn.addEventListener('click', () => {
    if (!selectedPerformer) return;
    
    // Check if user already has a solo performance
    const userSongs = performances.filter(p => 
      p.performer_name.trim().toLowerCase() === selectedPerformer.toLowerCase() ||
      (p.partner_name && p.partner_name.trim().toLowerCase() === selectedPerformer.toLowerCase())
    );
    const soloCount = userSongs.filter(p => (p.performance_type || '').trim().toLowerCase() === 'solo').length;
    const allowDuets = !window.performerProfileData || window.performerProfileData.allow_duets !== false;
    const duetOption = typeSelect.querySelector('option[value="Duet"]');
    const groupOption = typeSelect.querySelector('option[value="Group"]');
    if (duetOption) duetOption.disabled = !allowDuets;
    if (groupOption) groupOption.disabled = !allowDuets;

    if (soloCount >= maxSoloPerParticipant) {
      if (soloOption) soloOption.disabled = true;
      if (allowDuets) {
        typeSelect.value = 'Duet';
        partnerRow.classList.remove('hidden');
        soloWarning.classList.remove('hidden');
      } else {
        showToast('Maximum solo performances reached. Duets are disabled for this event.');
        modal.classList.add('hidden');
        return;
      }
    } else {
      if (soloOption) soloOption.disabled = false;
      typeSelect.value = 'Solo';
      partnerRow.classList.add('hidden');
      soloWarning.classList.add('hidden');
    }

    const subTitle = document.getElementById('add-perf-modal-subtitle');
    if (subTitle) subTitle.textContent = `Adding performance for ${selectedPerformer}`;
    document.getElementById('add-perf-song-title').value = '';
    document.getElementById('add-perf-movie-name').value = '';
    document.getElementById('add-perf-partner').value = '';
    document.getElementById('add-perf-stage-notes').value = '';
    document.getElementById('add-perf-acoustic').checked = false;

    const addSongDup = document.getElementById('add-perf-song-dup-warning');
    if (addSongDup) { addSongDup.classList.add('hidden'); addSongDup.innerHTML = ''; }
    const addPartnerDup = document.getElementById('add-perf-partner-dup-box');
    if (addPartnerDup) addPartnerDup.classList.add('hidden');

    // Populate partner datalist options
    if (partnerList) {
      const performerSet = new Set();
      performances.forEach(p => {
        if (p.performer_name) performerSet.add(p.performer_name.trim());
        if (p.partner_name) performerSet.add(p.partner_name.trim());
      });
      const candidates = Array.from(performerSet)
        .filter(n => n.toLowerCase() !== selectedPerformer.toLowerCase())
        .sort((a, b) => a.localeCompare(b));

      partnerList.innerHTML = candidates.map(n => `<option value="${escapeHtml(n)}">`).join('');
    }

    modal.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
  });

  const addPartnerInput = document.getElementById('add-perf-partner');
  const addPartnerDupBox = document.getElementById('add-perf-partner-dup-box');
  const addPartnerMatchedList = document.getElementById('add-perf-partner-matched-list');
  const addSongTitleInput = document.getElementById('add-perf-song-title');
  const addSongDupWarning = document.getElementById('add-perf-song-dup-warning');

  if (addPartnerInput && addPartnerDupBox && addPartnerMatchedList && !addPartnerInput._configured) {
    addPartnerInput._configured = true;
    addPartnerInput.addEventListener('input', () => {
      const isGroup = typeSelect && typeSelect.value === 'Group';
      const rawVal = addPartnerInput.value;
      let activePart = '';
      let parts = [];
      let excluded = selectedPerformer ? [selectedPerformer.toLowerCase()] : [];

      if (isGroup) {
        parts = rawVal.split(',');
        activePart = parts[parts.length - 1].trim().toLowerCase();
        const already = parts.slice(0, -1).map(p => p.trim().toLowerCase());
        excluded = [...excluded, ...already];
      } else {
        activePart = rawVal.trim().toLowerCase();
      }

      if (activePart.length < 3) {
        addPartnerDupBox.classList.add('hidden');
        return;
      }

      const candidates = getRegisteredPerformersList().filter(name => !excluded.includes(name.toLowerCase()));
      const matches = candidates.filter(name => {
        const n = name.toLowerCase();
        return n === activePart || n.startsWith(activePart) || n.includes(activePart);
      });

      if (matches.length > 0) {
        addPartnerMatchedList.innerHTML = '';
        matches.forEach(m => {
          const pill = document.createElement('button');
          pill.type = 'button';
          pill.className = 'inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs shadow transition';
          pill.textContent = m;
          pill.addEventListener('click', () => {
            if (isGroup) {
              parts[parts.length - 1] = ' ' + m;
              addPartnerInput.value = parts.map(p => p.trim()).filter(Boolean).join(', ') + ', ';
            } else {
              addPartnerInput.value = m;
              if (partnerPhoneWrap) partnerPhoneWrap.classList.add('hidden');
              const partnerPhoneInput = document.getElementById('add-perf-partner-phone');
              if (partnerPhoneInput) partnerPhoneInput.value = '';
            }
            addPartnerDupBox.classList.add('hidden');
            addPartnerInput.focus();
          });
          addPartnerMatchedList.appendChild(pill);
        });
        addPartnerDupBox.classList.remove('hidden');
      } else {
        addPartnerDupBox.classList.add('hidden');
      }
    });
  }

  if (addSongTitleInput && addSongDupWarning && !addSongTitleInput._configured) {
    addSongTitleInput._configured = true;
    setupSongDuplicateWarning(addSongTitleInput, addSongDupWarning, () => null);
  }

  const partnerPhoneWrap = document.getElementById('add-perf-partner-phone-wrap');
  const checkPartnerPhoneVisibility = () => {
    if (!partnerPhoneWrap) return;
    const curType = typeSelect ? typeSelect.value : 'Solo';
    const curPartner = (addPartnerInput ? addPartnerInput.value : '').trim();
    if (curType === 'Duet' && curPartner) {
      const isRegistered = getRegisteredPerformersList().some(n => n.toLowerCase() === curPartner.toLowerCase());
      partnerPhoneWrap.classList.toggle('hidden', isRegistered);
    } else {
      partnerPhoneWrap.classList.add('hidden');
    }
  };
  addPartnerInput?.addEventListener('input', checkPartnerPhoneVisibility);
  addPartnerInput?.addEventListener('change', checkPartnerPhoneVisibility);

  typeSelect?.addEventListener('change', () => {
    if (typeSelect.value === 'Solo') {
      partnerRow.classList.add('hidden');
    } else {
      partnerRow.classList.remove('hidden');
    }
    checkPartnerPhoneVisibility();
  });

  const closeModal = () => modal.classList.add('hidden');
  closeBtn?.addEventListener('click', closeModal);
  cancelBtn?.addEventListener('click', closeModal);

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!selectedPerformer) return;

    const type = typeSelect.value;
    const songTitle = document.getElementById('add-perf-song-title').value.trim();
    const movieName = document.getElementById('add-perf-movie-name').value.trim();
    const partnerName = document.getElementById('add-perf-partner').value.trim();
    const stageNotes = document.getElementById('add-perf-stage-notes').value.trim();
    const isAcoustic = document.getElementById('add-perf-acoustic').checked;
    const partnerPhoneInput = document.getElementById('add-perf-partner-phone');
    const partnerPhone = partnerPhoneInput ? partnerPhoneInput.value.trim() : '';

    if (!songTitle) {
      alert('Please enter a song title.');
      return;
    }

    if (type !== 'Solo' && !partnerName) {
      alert('Please enter a partner name for a Duet or Group performance.');
      return;
    }

    if (type === 'Duet' && partnerName) {
      const isRegistered = getRegisteredPerformersList().some(n => n.toLowerCase() === partnerName.toLowerCase());
      if (!isRegistered) {
        if (!partnerPhone) {
          alert('Please enter a phone number for your duet partner so organizers can identify them.');
          if (partnerPhoneInput) partnerPhoneInput.focus();
          return;
        }
        if (partnerPhone.replace(/\D/g, '').length < 10) {
          alert('Please enter a valid 10-digit phone number for your duet partner.');
          if (partnerPhoneInput) partnerPhoneInput.focus();
          return;
        }
      }
    }

    const submitBtn = document.getElementById('submit-add-perf-btn');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Adding...';
    }

    try {
      const res = await fetch('/api/performer/performances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          performer_name: selectedPerformer,
          performance_type: type,
          song_title: songTitle,
          movie_name: movieName,
          partner_name: partnerName,
          partner_phone: partnerPhone,
          is_acoustic: isAcoustic,
          stage_notes: stageNotes
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to add performance');
      }

      closeModal();
      showToast('✓ Performance added successfully!');
      await loadPerformances();
      await handlePerformerSelected(selectedPerformer);

      // Select newly added song
      if (data.entry_id) {
        const newRadio = document.querySelector(`input[name="selected_song"][value="${data.entry_id}"]`);
        if (newRadio) {
          newRadio.checked = true;
          newRadio.dispatchEvent(new Event('change'));
        }
      }
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Add Performance';
      }
    }
  });
}
