// EMA Paattukoottam Performer Hub Logic
let performances = [];
let selectedPerformer = null;
let selectedEntry = null;
let currentMethod = 'file'; // 'file' or 'youtube'
let sheetUrl = 'https://docs.google.com/spreadsheets/d/1OB0F_qM7FRvivZfp6u3qrqKCjBCpCZiPDr_CMr-posk/edit';
let maxUploadSizeMb = 200;
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
      if (data.header_brand_title) {
        const titleEl = document.getElementById('event-title');
        if (titleEl) titleEl.textContent = data.header_brand_title;
        document.title = `${data.header_brand_title} - Performer Hub`;
      }
      if (data.header_brand_subtitle) {
        const subEl = document.getElementById('event-subtitle');
        if (subEl) subEl.textContent = data.header_brand_subtitle;
      }
      if (data.mock_mode) {
        document.getElementById('mock-banner').classList.remove('hidden');
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
      if (data.max_upload_size_mb) {
        maxUploadSizeMb = data.max_upload_size_mb;
        const hint = document.getElementById('max-size-hint');
        if (hint) hint.textContent = `Supports MP3, M4A, WAV (Max ${maxUploadSizeMb}MB)`;
      }

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
    const res = await fetch('/api/performances');
    if (!res.ok) throw new Error('Failed to load sign-ups');
    performances = await res.json();

    // Extract unique performer and partner names
    const performerSet = new Set();
    performances.forEach(p => {
      if (p.performer_name) performerSet.add(p.performer_name.trim());
      if (p.partner_name) performerSet.add(p.partner_name.trim());
    });

    const sortedPerformers = Array.from(performerSet).sort((a, b) => a.localeCompare(b));
    const select = document.getElementById('performer-select');
    const currentSelected = select.value;
    select.innerHTML = '<option value="">-- Choose your name from the sign-up list --</option>';

    sortedPerformers.forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      if (name === currentSelected) opt.selected = true;
      select.appendChild(opt);
    });

    badge.textContent = `${sortedPerformers.length} registered participants`;
    renderOthersSongs();
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

function renderOthersSongs(filterQuery = '') {
  const listEl = document.getElementById('others-songs-list');
  if (!listEl) return;

  const validSongs = performances.filter(p => p.song_title && !p.is_song_name_missing);
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

  dropZone.addEventListener('click', () => fileInput.click());
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
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      fileInput.files = e.dataTransfer.files;
      handleFileSelected(fileInput.files[0]);
    }
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files[0]) {
      handleFileSelected(fileInput.files[0]);
    }
  });

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
    document.getElementById('edit-group-members-row').classList.toggle('hidden', val !== 'Group');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const entryId = document.getElementById('edit-entry-id').value;
    const songTitle = document.getElementById('edit-song-title').value.trim();
    const perfType = document.getElementById('edit-perf-type').value;
    const partnerName = document.getElementById('edit-partner-name').value.trim();
    const groupMembers = document.getElementById('edit-group-members').value.trim();
    const ytUrl = document.getElementById('edit-youtube-url').value.trim();

    const isAcousticChecked = document.getElementById('edit-acoustic-check')?.checked;

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
          group_members: perfType === 'Group' ? groupMembers : '',
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
  document.getElementById('edit-song-title').value = song.song_title || '';
  
  const perfTypeSelect = document.getElementById('edit-perf-type');
  perfTypeSelect.value = song.performance_type || 'Solo';
  document.getElementById('edit-partner-name').value = song.partner_name || '';
  document.getElementById('edit-group-members').value = song.group_members || '';
  document.getElementById('edit-youtube-url').value = song.youtube_url || '';

  const acousticCheck = document.getElementById('edit-acoustic-check');
  if (acousticCheck) {
    acousticCheck.checked = song.track_status === 'Acoustic';
  }

  document.getElementById('edit-partner-row').classList.toggle('hidden', perfTypeSelect.value !== 'Duet');
  document.getElementById('edit-group-members-row').classList.toggle('hidden', perfTypeSelect.value !== 'Group');

  document.getElementById('edit-song-modal').classList.remove('hidden');
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
  const songSection = document.getElementById('song-selection-section');
  const uploadSection = document.getElementById('upload-methods-section');
  const songContainer = document.getElementById('song-options-container');

  if (!name) {
    songSection.classList.add('hidden');
    uploadSection.classList.add('hidden');
    document.getElementById('food-cta-section').classList.add('hidden');
    document.getElementById('food-selector-card').classList.add('hidden');
    selectedEntry = null;
    return;
  }

  // Load food status
  await checkPerformerFoodStatus(name);

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
    } else if (song.is_song_name_missing) {
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
          <div class="font-semibold text-sm ${song.is_song_name_missing ? 'text-amber-300 italic' : 'text-white'} truncate">
            ${escapeHtml(song.song_title || 'Untitled Song (Click Edit)')}
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
        <button type="button" class="edit-song-btn px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1 border border-slate-700 transition" title="Edit song details">
          <i data-lucide="edit-2" class="w-3.5 h-3.5 text-orange-400"></i>
          <span>Edit</span>
        </button>
      </div>
    `;

    card.querySelector('input').addEventListener('change', () => {
      document.querySelectorAll('#song-options-container > div').forEach(c => {
        c.className = 'p-3.5 rounded-xl border transition flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-slate-800 bg-slate-950/60 hover:border-slate-700';
      });
      card.className = 'p-3.5 rounded-xl border transition flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-orange-500 bg-orange-500/10';
      updateSelectedSong(song);
    });

    card.querySelector('.edit-song-btn').addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openEditSongModal(song);
    });

    songContainer.appendChild(card);
  });

  songSection.classList.remove('hidden');
  uploadSection.classList.remove('hidden');

  const addPerfBtn = document.getElementById('add-performance-btn');
  if (addPerfBtn) {
    if (userSongs.length < maxPerformancesPerParticipant) {
      addPerfBtn.classList.remove('hidden');
    } else {
      addPerfBtn.classList.add('hidden');
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
                  <span class="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30">CONFIRMED DISH</span>
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
          if (!confirm(`Are you sure you want to release "${performerFoodSignup.item_name}"?`)) return;
          try {
            const delRes = await fetch(`/api/signup/food/${performerFoodSignup.signup_id}`, { method: 'DELETE' });
            if (delRes.ok) {
              await loadFoodCatalog();
              await checkPerformerFoodStatus(selectedPerformer);
            }
          } catch (e) {
            alert('Failed to release food item.');
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
                <h4 class="text-sm font-bold text-white">You haven't picked a potluck dish yet!</h4>
                <p class="text-xs text-amber-300/90 mt-0.5">Help feed the gathering &mdash; claim an open item from the potluck menu.</p>
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
      const isSelected = preselectItemId ? item.item_id === preselectItemId : (performerFoodSignup && performerFoodSignup.item_id === item.item_id);

      if (isClaimedByOther) {
        html += `
          <div class="p-2.5 rounded-xl bg-slate-950/40 border border-slate-800/60 opacity-60 flex items-center justify-between text-xs">
            <span class="text-slate-400 line-through">${escapeHtml(item.name)}</span>
            <span class="text-[10px] text-rose-400 font-mono">${escapeHtml(item.signer_name || 'Taken')}</span>
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
            <span class="text-[10px] text-emerald-400 font-semibold uppercase">Open</span>
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

  if (song.is_song_name_missing) {
    missingAlert.classList.remove('hidden');
    submitBtn.disabled = true;
  } else {
    missingAlert.classList.add('hidden');
    submitBtn.disabled = false;
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

function updateSubmitButtonText() {
  const submitBtn = document.getElementById('submit-btn');
  const submitText = document.getElementById('submit-text');

  if (!selectedEntry) return;

  if (selectedEntry.is_song_name_missing) {
    submitBtn.disabled = true;
    submitText.textContent = 'Add song title to upload track';
    return;
  }

  submitBtn.disabled = false;
  const isReplacing = selectedEntry.track_status === 'Uploaded' || selectedEntry.drive_file_id;

  if (currentMethod === 'youtube') {
    submitText.textContent = isReplacing ? 'Extract & Replace Track' : 'Extract & Upload Track';
  } else {
    submitText.textContent = isReplacing ? 'Replace Existing Track' : 'Upload Track to Google Drive';
  }
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
    if (playBtn) {
      playBtn.innerHTML = '<i data-lucide="pause" class="w-4 h-4 text-white fill-current"></i>';
      if (window.lucide) lucide.createIcons();
    }
  });

  previewWavesurfer.on('pause', () => {
    if (playBtn) {
      playBtn.innerHTML = '<i data-lucide="play" class="w-4 h-4 text-white fill-current ml-0.5"></i>';
      if (window.lucide) lucide.createIcons();
    }
  });

  previewWavesurfer.on('finish', () => {
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

  if (song.track_status !== 'Uploaded' && !song.drive_file_id) {
    existingCard.classList.add('hidden');
    if (previewWavesurfer) {
      try { previewWavesurfer.stop(); } catch (e) {}
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

        initPreviewWaveSurfer();
        if (previewWavesurfer) {
          previewWavesurfer.load(data.stream_url);
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

  if (selectedEntry.is_song_name_missing) {
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

function handleFileSelected(file) {
  const infoBar = document.getElementById('file-info-bar');
  const nameDisplay = document.getElementById('file-name-display');
  const sizeDisplay = document.getElementById('file-size-display');
  const label = document.getElementById('file-select-label');

  if (file) {
    nameDisplay.textContent = file.name;
    sizeDisplay.textContent = formatBytes(file.size);
    label.textContent = 'File chosen! Tap to change';
    infoBar.classList.remove('hidden');
  }
}

async function handleFormSubmit(e) {
  e.preventDefault();
  hideError();

  if (!selectedEntry) {
    showError('Please select a song from the list first.');
    return;
  }

  if (selectedEntry.is_song_name_missing) {
    showError('Song title is missing. Please click Edit on the performance card to add your song title first.');
    return;
  }

  const formData = new FormData();
  formData.append('entry_id', selectedEntry.entry_id);
  formData.append('submission_type', currentMethod);

  if (currentMethod === 'file') {
    const fileInput = document.getElementById('audio-file-input');
    if (!fileInput.files || fileInput.files.length === 0) {
      showError('Please select an audio file to upload.');
      return;
    }
    formData.append('file', fileInput.files[0]);
  } else if (currentMethod === 'youtube') {
    const ytUrl = document.getElementById('youtube-url-input').value.trim();
    if (!ytUrl) {
      showError('Please enter a valid YouTube link.');
      return;
    }
    if (!ytUrl.includes('youtube.com') && !ytUrl.includes('youtu.be')) {
      showError('The URL must be a valid YouTube link (youtube.com or youtu.be).');
      return;
    }
    formData.append('youtube_url', ytUrl);
  }

  // UI state during upload
  const submitBtn = document.getElementById('submit-btn');
  const progressContainer = document.getElementById('progress-container');
  const progressBar = document.getElementById('progress-bar');
  const progressText = document.getElementById('progress-text');

  submitBtn.disabled = true;
  progressContainer.classList.remove('hidden');
  progressBar.style.width = '35%';
  progressText.textContent = currentMethod === 'youtube' ? 'Extracting audio from YouTube with yt-dlp...' : 'Uploading audio to server...';

  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });

    progressBar.style.width = '80%';
    progressText.textContent = 'Saving version and updating database...';

    const result = await res.json();
    if (!res.ok) {
      throw new Error(result.detail || 'Upload failed. Please try again.');
    }

    progressBar.style.width = '100%';
    progressText.textContent = 'Complete!';

    setTimeout(() => {
      submitBtn.disabled = false;
      progressContainer.classList.add('hidden');
      document.getElementById('intake-form').classList.add('hidden');
      
      const successCard = document.getElementById('success-card');
      const detailsBox = document.getElementById('success-details');
      detailsBox.innerHTML = `
        <p><strong>Performer:</strong> ${escapeHtml(result.performer_name)}</p>
        <p><strong>Song:</strong> ${escapeHtml(result.song_title)}</p>
        <p><strong>Active Track File:</strong> <code class="text-orange-300">${escapeHtml(result.filename)}</code></p>
      `;
      successCard.classList.remove('hidden');
      if (window.lucide) lucide.createIcons();

      // Refresh performances
      loadPerformances();
    }, 400);

  } catch (err) {
    submitBtn.disabled = false;
    progressContainer.classList.add('hidden');
    showError(err.message || 'An unexpected error occurred during submission.');
  }
}

function showError(msg) {
  const errCard = document.getElementById('error-card');
  document.getElementById('error-message').textContent = msg;
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
    const soloOption = typeSelect.querySelector('option[value="Solo"]');

    if (soloCount >= maxSoloPerParticipant) {
      if (soloOption) soloOption.disabled = true;
      typeSelect.value = 'Duet';
      partnerRow.classList.remove('hidden');
      soloWarning.classList.remove('hidden');
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

  typeSelect?.addEventListener('change', () => {
    if (typeSelect.value === 'Solo') {
      partnerRow.classList.add('hidden');
    } else {
      partnerRow.classList.remove('hidden');
    }
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

    if (!songTitle) {
      alert('Please enter a song title.');
      return;
    }

    if (type !== 'Solo' && !partnerName) {
      alert('Please enter a partner name for a Duet or Group performance.');
      return;
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
