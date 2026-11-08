// Page event wiring.
// Classic script: shares globals with the other intake files (see load order in the page).

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
