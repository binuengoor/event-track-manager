// Add-performance modal.
// Classic script: shares globals with the other intake files (see load order in the page).

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
    if (!window.performerProfileData) return;
    const userSongs = window.performerProfileData.performances || [];
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
          pill.className = 'me-chip-btn';
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
