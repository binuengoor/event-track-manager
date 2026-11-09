// File/link validation, upload and submit.
// Classic script: shares globals with the other intake files (see load order in the page).

let trackCheckRefreshToken = 0;

function beginTrackUpload() {
  trackCheckRefreshToken += 1;
  return trackCheckRefreshToken;
}

function invalidateTrackCheckRefresh() {
  trackCheckRefreshToken += 1;
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
    showError(problem.text, { title: problem.title, action: 'file' });
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

function renderTrackChecks(checks) {
  if (!checks || typeof checks !== 'object') return '';
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  const duration = finite(checks.duration_s)
    ? (checks.duration_s >= 60
      ? `${Math.floor(checks.duration_s / 60)}:${String(Math.floor(checks.duration_s % 60)).padStart(2, '0')}`
      : `${Math.round(checks.duration_s)} sec`)
    : 'Not available';
  const format = checks.format_ok === false ? 'Format needs attention' : checks.format_ok === true ? 'Format accepted' : 'Format check unavailable';
  const loudness = finite(checks.loudness_lufs) ? `${checks.loudness_lufs.toFixed(1)} LUFS` : 'Not available yet; check again shortly';
  const gain = finite(checks.gain_db) ? `${checks.gain_db > 0 ? '+' : ''}${checks.gain_db.toFixed(1)} dB` : 'Pending';
  const heading = checks.format_ok === false
    ? 'Pre-check needs attention'
    : checks.format_ok === true ? 'Pre-check passed' : 'Pre-check incomplete';
  return `<section class="me-precheck" aria-label="Track pre-check results">
    <strong>${heading}</strong>
    <ul><li>Duration: ${duration}</li><li>${format}</li><li>Loudness: ${loudness}</li><li>Suggested gain: ${gain}</li></ul>
  </section>`;
}

async function refreshTrackChecksOnce(entryId, performerName, token, details) {
  if (!entryId || !performerName || token !== trackCheckRefreshToken || !details) return;
  try {
    const response = await fetch(`/api/performer/profile?name=${encodeURIComponent(performerName)}`);
    if (!response.ok) return;
    const profile = await response.json();
    if (token !== trackCheckRefreshToken || details !== document.getElementById('success-details')) return;
    const act = (profile.performances || []).find((item) => item.entry_id === entryId);
    if (!act || !act.checks) return;
    const previous = details?.querySelector('.me-precheck');
    if (previous) previous.outerHTML = renderTrackChecks(act.checks);
  } catch (_) { /* The upload response remains useful if the one refresh fails. */ }
}

async function handleFormSubmit(e) {
  e.preventDefault();
  const uploadToken = beginTrackUpload();
  hideError();

  if (!selectedEntry) {
    lastSubmitFailed = false;
    showError('Please select a song from the list first.', { title: 'Choose an act first' });
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
      showError(`Please choose ${isVideo ? 'a video' : 'an audio'} file first.`, { title: 'No file chosen', action: 'file' });
      return;
    }
    const file = fileInput.files[0];
    const problem = checkFile(file);
    if (problem) {
      lastSubmitFailed = false;
      showError(problem.text, { title: problem.title, action: 'file' });
      return;
    }
    formData.append('file', file);
  } else if (currentMethod === 'youtube') {
    const raw = document.getElementById('youtube-url-input').value.trim();
    if (!raw) {
      lastSubmitFailed = false;
      showError('Paste a public YouTube or SoundCloud link to one song.', { title: 'No link yet', action: 'link' });
      return;
    }
    const link = validLink(raw);
    if (!link) {
      lastSubmitFailed = false;
      showError('Paste a public YouTube or SoundCloud link to one song. Private videos and playlists do not work.', { title: 'We could not use that link', action: 'link' });
      return;
    }
    formData.append('youtube_url', link);
  }

  const submitBtn = document.getElementById('submit-btn');
  const progressContainer = document.getElementById('progress-container');
  const progressBar = document.getElementById('progress-bar');
  const progressText = document.getElementById('progress-text');
  const isLink = currentMethod === 'youtube';
  const setProgress = (pct) => {
    progressBar.style.width = pct + '%';
    document.getElementById('progress-track')?.setAttribute('aria-valuenow', String(pct));
    const pctEl = document.getElementById('progress-pct');
    if (pctEl) pctEl.textContent = pct + '%';
  };
  const detail = document.getElementById('progress-detail');
  const stages = document.getElementById('progress-stages');
  const setStage = (name) => {
    const order = ['check', 'download', 'process'];
    stages?.querySelectorAll('li').forEach((li) => {
      const idx = order.indexOf(li.dataset.stage);
      const at = name === 'done' ? order.length : order.indexOf(name);
      li.className = idx < at ? 'is-done' : idx === at ? 'is-current' : '';
    });
  };
  const nameEl = document.getElementById('progress-name');
  if (nameEl) nameEl.textContent = isLink ? (document.getElementById('youtube-url-input').value.trim().replace(/^https?:\/\/(www\.)?/, '') || 'Link') : (formData.get('file')?.name || 'Track');
  stages?.classList.toggle('hidden', !isLink);
  if (isLink) setStage('download');
  if (detail) detail.textContent = '';
  const startedAt = Date.now();

  submitBtn.disabled = true;
  progressContainer.classList.remove('hidden');
  setProgress(isLink ? 35 : 0);
  progressText.textContent = isLink
    ? 'Checking the link, then downloading and processing. This can take a minute.'
    : 'Starting upload...';

  try {
    const res = await sendUpload(formData, (loaded, total) => {
      if (loaded === null) {
        // All bytes are on the server: it now checks length and sound.
        setProgress(100);
        progressText.textContent = 'Upload finished. Checking length and sound...';
        if (detail) detail.textContent = '';
        return;
      }
      const pct = Math.max(1, Math.min(99, Math.round((loaded / total) * 100)));
      setProgress(pct);
      progressText.textContent = `Uploading ${pct}%`;
      const elapsed = (Date.now() - startedAt) / 1000;
      let eta = '';
      if (elapsed > 2 && loaded > 0 && pct >= 3) {
        const secs = Math.max(1, Math.round((total - loaded) / (loaded / elapsed)));
        eta = secs >= 90 ? ` \u00b7 about ${Math.ceil(secs / 60)} min left` : ` \u00b7 about ${secs} s left`;
      }
      if (detail) detail.textContent = `${formatBytes(loaded)} of ${formatBytes(total)}${eta}`;
    });

    if (!res.ok) {
      if (res.status === 413) {
        throw new Error(`The server says this file is too big. The limit is ${maxAudioMb} MB for audio (${maxVideoMb} MB for video). Export a smaller file or paste a link instead.`);
      }
      if (res.status === 502 || res.status === 504) {
        throw new Error(`The upload timed out (HTTP ${res.status}). Try again, or export a smaller file.`);
      }
      const detailMsg = res.body && typeof res.body.detail === 'string' ? res.body.detail : '';
      throw new Error(detailMsg || `Upload failed (HTTP ${res.status}). Please try again.`);
    }
    const result = res.body;
    if (!result) throw new Error('The upload reached the server, but its reply was unexpected. Check My entry to see if the track is there.');

    lastSubmitFailed = false;
    setProgress(100);
    if (isLink) setStage('done');
    progressText.textContent = 'Done!';

    setTimeout(() => {
      submitBtn.disabled = false;
      progressContainer.classList.add('hidden');
      document.getElementById('intake-form').classList.add('hidden');

      const successCard = document.getElementById('success-card');
      const detailsBox = document.getElementById('success-details');
      const kind = result.media_type ? String(result.media_type).toLowerCase() : (isVideo ? 'video' : 'audio');
      document.getElementById('success-title').textContent = result.duration ? `Ready. ${result.duration}, ${kind}` : 'Track uploaded';
      document.getElementById('success-summary').textContent = result.checks?.format_ok === false
        ? `${result.filename || 'Your track'} was saved, but its format needs attention.`
        : `${result.filename || 'Your track'} was saved for the sound team.`;
      detailsBox.innerHTML = `
        <p><strong>Performer:</strong> ${escapeHtml(result.performer_name)}</p>
        <p><strong>Song:</strong> ${escapeHtml(result.song_title)}</p>
        <p><strong>Track file:</strong> <code>${escapeHtml(result.filename)}</code></p>
        ${renderTrackChecks(result.checks)}
      `;
      successCard.classList.remove('hidden');
      if (result.checks && (result.checks.loudness_lufs == null || result.checks.gain_db == null)) {
        const uploadedEntryId = selectedEntry?.entry_id;
        const uploadedName = selectedPerformer;
        setTimeout(() => refreshTrackChecksOnce(uploadedEntryId, uploadedName, uploadToken, detailsBox), 1800);
      }
      if (window.lucide) lucide.createIcons();
      loadPerformances();
    }, 400);

  } catch (err) {
    submitBtn.disabled = false;
    progressContainer.classList.add('hidden');
    if (err && err.cancelled) { lastSubmitFailed = false; hideError(); return; }
    lastSubmitFailed = true;
    showError(err?.message || 'Something went wrong while uploading.', { title: 'The upload did not finish' });
  }
}
