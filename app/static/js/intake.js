// EMA Paattukoottam Performer Intake Logic
let performances = [];
let selectedPerformer = null;
let selectedEntry = null;
let currentMethod = 'file'; // 'file' or 'youtube'
let sheetUrl = 'https://docs.google.com';
let maxUploadSizeMb = 200;

document.addEventListener('DOMContentLoaded', async () => {
  await initEventInfo();
  await loadPerformances();
  setupEventListeners();
});

async function initEventInfo() {
  try {
    const res = await fetch('/api/event-info');
    if (res.ok) {
      const data = await res.json();
      if (data.event_name) {
        document.getElementById('event-title').textContent = data.event_name;
      }
      if (data.mock_mode) {
        document.getElementById('mock-banner').classList.remove('hidden');
      }
      if (data.sheet_url) {
        sheetUrl = data.sheet_url;
        const sheetLink = document.getElementById('open-sheet-link');
        if (sheetLink) sheetLink.href = sheetUrl;
      }
      if (data.max_upload_size_mb) {
        maxUploadSizeMb = data.max_upload_size_mb;
        const hint = document.getElementById('max-size-hint');
        if (hint) hint.textContent = `Supports MP3, M4A, WAV (Max ${maxUploadSizeMb}MB)`;
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
    if (!res.ok) throw new Error('Failed to load sign-ups from Google Sheet');
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
  } catch (err) {
    badge.textContent = 'Error loading names';
    showError(err.message || 'Could not connect to Google Sheet backend');
  }
}

function setupEventListeners() {
  const performerSelect = document.getElementById('performer-select');
  performerSelect.addEventListener('change', (e) => {
    selectedPerformer = e.target.value;
    handlePerformerSelected(selectedPerformer);
  });

  // Refresh Data buttons
  const refreshBtn = document.getElementById('refresh-data-btn');
  if (refreshBtn) refreshBtn.addEventListener('click', handleRefreshClick);

  const alertRefreshBtn = document.getElementById('alert-refresh-btn');
  if (alertRefreshBtn) alertRefreshBtn.addEventListener('click', handleRefreshClick);

  // Tab switching
  const tabFile = document.getElementById('tab-file');
  const tabYoutube = document.getElementById('tab-youtube');
  const filePane = document.getElementById('file-upload-pane');
  const ytPane = document.getElementById('youtube-upload-pane');
  const submitText = document.getElementById('submit-text');

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
}

async function handleRefreshClick() {
  const btns = [document.getElementById('refresh-data-btn'), document.getElementById('alert-refresh-btn')];
  btns.forEach(b => {
    if (b) {
      b.classList.add('opacity-50', 'pointer-events-none');
      const icon = b.querySelector('i');
      if (icon) icon.classList.add('animate-spin');
    }
  });

  await loadPerformances();
  if (selectedPerformer) {
    handlePerformerSelected(selectedPerformer);
  }

  btns.forEach(b => {
    if (b) {
      b.classList.remove('opacity-50', 'pointer-events-none');
      const icon = b.querySelector('i');
      if (icon) icon.classList.remove('animate-spin');
    }
  });
  if (window.lucide) lucide.createIcons();
}

function handlePerformerSelected(name) {
  const songSection = document.getElementById('song-selection-section');
  const uploadSection = document.getElementById('upload-methods-section');
  const songContainer = document.getElementById('song-options-container');

  if (!name) {
    songSection.classList.add('hidden');
    uploadSection.classList.add('hidden');
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

    let typeLabel = escapeHtml(song.performance_type);
    if (song.partner_name) {
      typeLabel = `Duet: ${escapeHtml(song.performer_name)} & ${escapeHtml(song.partner_name)}`;
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

    const card = document.createElement('label');
    card.className = `block p-3.5 rounded-xl border cursor-pointer transition flex items-center justify-between ${
      isChecked ? 'border-orange-500 bg-orange-500/10' : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
    }`;
    card.innerHTML = `
      <div class="flex items-center gap-3">
        <input type="radio" name="selected_song" value="${song.entry_id}" ${isChecked ? 'checked' : ''} class="text-orange-500 focus:ring-orange-500 accent-orange-500">
        <div>
          <div class="font-semibold text-sm ${song.is_song_name_missing ? 'text-amber-300 italic' : 'text-white'}">
            ${escapeHtml(song.song_title)}
          </div>
          <div class="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5">
            <span class="text-orange-400 font-medium">${typeLabel}</span>
            <span>•</span>
            <span>Seq #${song.sequence_order || 'TBD'}</span>
          </div>
        </div>
      </div>
      <span class="text-xs px-2.5 py-1 rounded-full border ${statusClass} font-medium shrink-0 ml-2">
        ${statusLabel}
      </span>
    `;

    card.querySelector('input').addEventListener('change', () => {
      document.querySelectorAll('#song-options-container label').forEach(l => {
        l.className = 'block p-3.5 rounded-xl border cursor-pointer transition flex items-center justify-between border-slate-800 bg-slate-950/60 hover:border-slate-700';
      });
      card.className = 'block p-3.5 rounded-xl border cursor-pointer transition flex items-center justify-between border-orange-500 bg-orange-500/10';
      updateSelectedSong(song);
    });

    songContainer.appendChild(card);
  });

  songSection.classList.remove('hidden');
  uploadSection.classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
}

function updateSelectedSong(song) {
  selectedEntry = song;
  const missingAlert = document.getElementById('missing-song-alert');
  const submitBtn = document.getElementById('submit-btn');

  if (song.is_song_name_missing) {
    missingAlert.classList.remove('hidden');
    submitBtn.disabled = true;
  } else {
    missingAlert.classList.add('hidden');
    submitBtn.disabled = false;
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
    submitText.textContent = 'Add song title in sheet to upload';
    return;
  }

  submitBtn.disabled = false;
  const isReplacing = selectedEntry.track_status === 'Uploaded' || selectedEntry.drive_file_id;

  if (currentMethod === 'youtube') {
    submitText.textContent = isReplacing ? 'Extract & Replace Track on Google Drive' : 'Extract & Upload to Google Drive';
  } else {
    submitText.textContent = isReplacing ? 'Replace Track on Google Drive' : 'Upload Track to Google Drive';
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

  const playIcon = document.getElementById('preview-play-icon');
  previewWavesurfer.on('play', () => {
    if (playIcon) playIcon.setAttribute('data-lucide', 'pause');
    if (window.lucide) lucide.createIcons();
  });

  previewWavesurfer.on('pause', () => {
    if (playIcon) playIcon.setAttribute('data-lucide', 'play');
    if (window.lucide) lucide.createIcons();
  });

  previewWavesurfer.on('finish', () => {
    if (playIcon) playIcon.setAttribute('data-lucide', 'play');
    if (window.lucide) lucide.createIcons();
  });

  const playBtn = document.getElementById('preview-play-btn');
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
    showError('Song title is missing in Google Sheet. Please add your song name to the sign-up sheet first.');
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
    progressText.textContent = 'Archiving previous version & updating Google Sheet...';

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
        <p><strong>Drive Active File:</strong> <code class="text-orange-300">${escapeHtml(result.filename)}</code></p>
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
