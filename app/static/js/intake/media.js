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

  audioBtn?.setAttribute('aria-pressed', String(type !== 'video'));
  videoBtn?.setAttribute('aria-pressed', String(type === 'video'));
  if (type === 'video') {
    if (badge) badge.textContent = `Video (${extList(exts)})`;
    if (hint) hint.textContent = 'Video plays on the stage monitor (720p). The sound team checks length and sound before it goes live.';
    if (label && label.textContent.includes('audio')) label.textContent = 'Tap to select or drag a video file here';
  } else {
    if (badge) badge.textContent = `Audio (${extList(exts)})`;
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
    submitBtn.className = 'me-btn me-btn-block me-btn-warn';
    submitText.textContent = 'Add Song Title to Upload Track';
    if (window.lucide) lucide.createIcons();
    return;
  }

  submitBtn.disabled = false;
  submitBtn.className = 'me-btn me-btn-primary me-btn-block';

  const isReplacing = selectedEntry.track_status === 'Uploaded' || selectedEntry.track_version;
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
  const css = getComputedStyle(document.documentElement);
  const token = (name, fallback) => (css.getPropertyValue(name).trim() || fallback);
  previewWavesurfer = WaveSurfer.create({
    container: container,
    waveColor: token('--text-muted', '#8A92A0'),
    progressColor: token('--accent-primary', '#F06449'),
    cursorColor: token('--text-primary', '#F3F4F6'),
    cursorWidth: 2,
    barWidth: 2,
    barGap: 1,
    barRadius: 2,
    height: 38,
    normalize: true
  });

  const playBtn = document.getElementById('preview-play-btn');
  if (playBtn) {
    playBtn.innerHTML = '<i data-lucide="play" class="w-5 h-5"></i>';
    if (window.lucide) lucide.createIcons();
  }

  previewWavesurfer.on('play', () => {
    window.auroraEffect?.setActive(true);
    if (playBtn) {
      playBtn.innerHTML = '<i data-lucide="pause" class="w-5 h-5"></i>';
      if (window.lucide) lucide.createIcons();
    }
  });

  previewWavesurfer.on('pause', () => {
    window.auroraEffect?.setActive(false);
    if (playBtn) {
      playBtn.innerHTML = '<i data-lucide="play" class="w-5 h-5"></i>';
      if (window.lucide) lucide.createIcons();
    }
  });

  previewWavesurfer.on('finish', () => {
    window.auroraEffect?.setActive(false);
    if (playBtn) {
      playBtn.innerHTML = '<i data-lucide="play" class="w-5 h-5"></i>';
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

  if (song.track_status !== 'Uploaded' && !song.track_version) {
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

  let kind = 'wait';
  let icon = 'clock';
  let text = 'No track yet';
  if (isSongTitleMissing(selectedEntry)) { kind = 'bad'; icon = 'alert-triangle'; text = 'Title missing'; }
  else if (selectedEntry.track_status === 'Acoustic') { kind = 'info'; icon = 'guitar'; text = 'Acoustic (no track)'; }
  else if (selectedEntry.track_status === 'Uploaded' || selectedEntry.track_version) { kind = 'ok'; icon = 'check'; text = 'Track on file'; }
  badge.dataset.kind = kind;
  badge.innerHTML = `<i data-lucide="${icon}" class="w-4 h-4"></i><span>${text}</span>`;
  renderReadiness(selectedEntry);
  if (window.lucide) lucide.createIcons();
}

// Song, Track, Ready: the first step that is not done is the current one (numbered, highlighted).
function renderReadiness(song) {
  const list = document.getElementById('entry-readiness');
  if (!list || !song) return;
  const songDone = !isSongTitleMissing(song);
  const trackDone = song.track_status === 'Uploaded' || Boolean(song.track_version) || song.track_status === 'Acoustic';
  const steps = [
    { label: 'Song', done: songDone },
    { label: 'Track', done: songDone && trackDone },
    { label: 'Ready', done: songDone && trackDone },
  ];
  let currentFound = false;
  list.innerHTML = steps.map((step, i) => {
    let state = 'todo';
    if (step.done) state = 'done';
    else if (!currentFound) { state = 'current'; currentFound = true; }
    const mark = state === 'done' ? '&#10003;' : String(i + 1);
    const word = state === 'done' ? 'done' : state === 'current' ? 'next step' : 'to do';
    return `<li class="is-${state}"><span class="me-step-dot" aria-hidden="true">${mark}</span><span>${step.label}<span class="sr-only">, ${word}</span></span></li>`;
  }).join('');
}
