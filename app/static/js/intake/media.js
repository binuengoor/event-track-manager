// Selected song, media type, submit text, audio preview.
// Classic script: shares globals with the other intake files (see load order in the page).

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
