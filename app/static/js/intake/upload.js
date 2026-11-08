// File/link validation, upload and submit.
// Classic script: shares globals with the other intake files (see load order in the page).

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
