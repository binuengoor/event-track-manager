// Edit-song modal.
// Classic script: shares globals with the other intake files (see load order in the page).

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
    const clearStageNotes = document.getElementById('clear-stage-notes')?.checked || false;
    const typeChanged = perfType !== (form.dataset.initialType || '');
    const partnerChanged = partnerName !== (form.dataset.initialPartner || '');
    const groupChanged = groupMembers !== (form.dataset.initialGroup || '');

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
          performance_type: typeChanged ? perfType : undefined,
          partner_name: typeChanged || (perfType === 'Duet' && partnerChanged) || (perfType === 'Group' && groupChanged)
            ? (perfType === 'Duet' ? partnerName : (perfType === 'Group' ? groupMembers : '')) : undefined,
          partner_phone: perfType === 'Duet' && partnerPhone ? partnerPhone : undefined,
          group_members: perfType === 'Group' ? groupMembers : '',
          movie_name: movieName,
          stage_notes: clearStageNotes ? '' : (stageNotes || undefined),
          youtube_url: ytUrl,
          track_status: isAcousticChecked ? 'Acoustic' : (selectedEntry && selectedEntry.track_status === 'Acoustic' ? 'Pending' : undefined)
        })
      });

      if (!res.ok) {
        const err = await res.json();
        if (res.status === 403 && (err.detail || '').includes('Name and phone do not match')) {
          const phoneLast4 = prompt('Edit verification is enabled. Enter the last 4 digits of your registered phone number:');
          if (phoneLast4) {
            const retryRes = await fetch(`/api/signup/performance/${entryId}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                song_title: songTitle,
                performance_type: typeChanged ? perfType : undefined,
                partner_name: typeChanged || (perfType === 'Duet' && partnerChanged) || (perfType === 'Group' && groupChanged)
                  ? (perfType === 'Duet' ? partnerName : (perfType === 'Group' ? groupMembers : '')) : undefined,
                partner_phone: perfType === 'Duet' && partnerPhone ? partnerPhone : undefined,
                group_members: perfType === 'Group' ? groupMembers : '',
                movie_name: movieName,
                stage_notes: clearStageNotes ? '' : (stageNotes || undefined),
                youtube_url: ytUrl,
                track_status: isAcousticChecked ? 'Acoustic' : (selectedEntry && selectedEntry.track_status === 'Acoustic' ? 'Pending' : undefined),
                signer_name: selectedPerformer || '',
                signer_phone: phoneLast4.trim()
              })
            });
            if (retryRes.ok) {
              hideModal();
              await loadPerformances();
              if (selectedPerformer) {
                handlePerformerSelected(selectedPerformer);
              }
              return;
            }
            const retryErr = await retryRes.json();
            throw new Error(retryErr.detail || 'Verification failed');
          }
        }
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
  const editForm = document.getElementById('edit-song-form');
  editForm.dataset.initialType = perfTypeSelect.value;
  editForm.dataset.initialPartner = song.partner_name || '';
  editForm.dataset.initialGroup = song.performance_type === 'Group' ? (song.partner_name || '') : '';
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
  document.getElementById('edit-group-members').value = song.performance_type === 'Group' ? (song.partner_name || '') : '';
  document.getElementById('edit-youtube-url').value = song.youtube_url || '';

  const movieNameInput = document.getElementById('edit-movie-name');
  if (movieNameInput) {
    movieNameInput.value = song.movie_name || '';
  }

  const stageNotesInput = document.getElementById('edit-stage-notes');
  if (stageNotesInput) {
    stageNotesInput.value = '';
  }
  const clearStageNotes = document.getElementById('clear-stage-notes');
  if (clearStageNotes) clearStageNotes.checked = false;

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
