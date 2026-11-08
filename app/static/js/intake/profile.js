// Refresh, sync badge, performer profile lookup.
// Classic script: shares globals with the other intake files (see load order in the page).

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

  // Never keep the previous person's actions visible while a new lookup runs.
  window.performerProfileData = null;
  performerFoodSignup = null;
  selectedEntry = null;
  songSection.classList.add('hidden');
  uploadSection.classList.add('hidden');
  document.getElementById('food-cta-section').classList.add('hidden');
  document.getElementById('food-selector-card').classList.add('hidden');
  document.getElementById('add-performance-btn')?.classList.add('hidden');
  document.getElementById('edit-performer-name-btn')?.classList.add('hidden');
  for (const id of ['edit-song-modal', 'rename-performer-modal', 'add-performance-modal']) {
    document.getElementById(id)?.classList.add('hidden');
  }

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
  const profileLoaded = await checkPerformerFoodStatus(name);
  if (selectedPerformer !== name || !profileLoaded) return;

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
  const userSongs = window.performerProfileData.performances || [];

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
