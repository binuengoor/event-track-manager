// Duplicate checks, partner/group autocomplete, rename-performer modal.
// Classic script: shares globals with the other intake files (see load order in the page).

function findDuplicateSong(title, currentEntryId = null) {
  if (!title || isPlaceholderSong(title)) return null;
  const cleanTitle = title.trim().toLowerCase();
  if (cleanTitle.length < 3) return null;

  for (const p of performances) {
    if (currentEntryId && p.entry_id === currentEntryId) continue;
    if (isSongTitleMissing(p)) continue;
    const existingTitle = (p.song_title || '').trim();
    if (isPlaceholderSong(existingTitle)) continue;

    const existingLower = existingTitle.toLowerCase();
    if (existingLower === cleanTitle || 
        (cleanTitle.length >= 4 && (existingLower.includes(cleanTitle) || cleanTitle.includes(existingLower)))) {
      return p;
    }
  }
  return null;
}

function getRegisteredPerformersList(excludeName = '') {
  const s = new Set();
  performances.forEach(p => {
    if (p.performer_name && p.performer_name.trim()) s.add(p.performer_name.trim());
    if (p.partner_name && p.partner_name.trim()) s.add(p.partner_name.trim());
  });
  return Array.from(s)
    .filter(n => !excludeName || n.toLowerCase() !== excludeName.toLowerCase())
    .sort((a, b) => a.localeCompare(b));
}

function setupPartnerAutocomplete(inputEl, dupBoxEl, listEl, getExcludedNames) {
  if (!inputEl || !dupBoxEl || !listEl) return;
  inputEl.addEventListener('input', () => {
    const val = inputEl.value.trim().toLowerCase();
    if (val.length < 3) {
      dupBoxEl.classList.add('hidden');
      return;
    }
    const excluded = (getExcludedNames ? getExcludedNames() : []).map(x => x.toLowerCase());
    const candidates = getRegisteredPerformersList().filter(name => !excluded.includes(name.toLowerCase()));
    const matches = candidates.filter(name => {
      const n = name.toLowerCase();
      return n === val || n.startsWith(val) || n.includes(val);
    });

    if (matches.length > 0) {
      listEl.innerHTML = '';
      matches.forEach(m => {
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'me-chip-btn';
        pill.textContent = m;
        pill.addEventListener('click', () => {
          inputEl.value = m;
          dupBoxEl.classList.add('hidden');
          inputEl.dispatchEvent(new Event('change'));
        });
        listEl.appendChild(pill);
      });
      dupBoxEl.classList.remove('hidden');
    } else {
      dupBoxEl.classList.add('hidden');
    }
  });
}

function setupGroupAutocomplete(inputEl, dupBoxEl, listEl, getExcludedNames) {
  if (!inputEl || !dupBoxEl || !listEl) return;
  inputEl.addEventListener('input', () => {
    const rawVal = inputEl.value;
    const parts = rawVal.split(',');
    const activePart = parts[parts.length - 1].trim().toLowerCase();
    if (activePart.length < 3) {
      dupBoxEl.classList.add('hidden');
      return;
    }

    const alreadyEntered = parts.slice(0, -1).map(p => p.trim().toLowerCase());
    const excluded = [...(getExcludedNames ? getExcludedNames() : []), ...alreadyEntered].map(x => x.toLowerCase());
    const candidates = getRegisteredPerformersList().filter(name => !excluded.includes(name.toLowerCase()));
    const matches = candidates.filter(name => {
      const n = name.toLowerCase();
      return n === activePart || n.startsWith(activePart) || n.includes(activePart);
    });

    if (matches.length > 0) {
      listEl.innerHTML = '';
      matches.forEach(m => {
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'me-chip-btn';
        pill.textContent = m;
        pill.addEventListener('click', () => {
          parts[parts.length - 1] = ' ' + m;
          inputEl.value = parts.map(p => p.trim()).filter(Boolean).join(', ') + ', ';
          dupBoxEl.classList.add('hidden');
          inputEl.focus();
        });
        listEl.appendChild(pill);
      });
      dupBoxEl.classList.remove('hidden');
    } else {
      dupBoxEl.classList.add('hidden');
    }
  });
}

function setupSongDuplicateWarning(inputEl, warningBoxEl, getExcludeEntryId) {
  if (!inputEl || !warningBoxEl) return;
  inputEl.addEventListener('input', () => {
    const val = inputEl.value.trim();
    const excludeId = getExcludeEntryId ? getExcludeEntryId() : null;
    const dup = findDuplicateSong(val, excludeId);
    if (dup) {
      const singer = dup.partner_name 
        ? `${escapeHtml(dup.performer_name)} & ${escapeHtml(dup.partner_name)}` 
        : escapeHtml(dup.performer_name);
      warningBoxEl.innerHTML = `
        <div class="me-warnbox-row">
          <i data-lucide="alert-circle" class="w-5 h-5"></i>
          <div>
            <span class="me-warnbox-title">Song already chosen:</span>
            <span>"<strong>${escapeHtml(dup.song_title)}</strong>" has already been selected by <strong>${singer}</strong> (${escapeHtml(dup.performance_type || 'Solo')}).</span>
          </div>
        </div>
      `;
      warningBoxEl.classList.remove('hidden');
      if (window.lucide) lucide.createIcons();
    } else {
      warningBoxEl.classList.add('hidden');
      warningBoxEl.innerHTML = '';
    }
  });
}

function setupRenamePerformerModal() {
  const modal = document.getElementById('rename-performer-modal');
  const openBtn = document.getElementById('edit-performer-name-btn');
  const closeBtn = document.getElementById('close-rename-modal-btn');
  const cancelBtn = document.getElementById('cancel-rename-btn');
  const form = document.getElementById('rename-performer-form');
  const nameInput = document.getElementById('new-performer-name-input');
  const errorMsg = document.getElementById('rename-error-msg');
  const saveBtn = document.getElementById('save-rename-btn');

  if (!modal || !openBtn || !form) return;

  const hideModal = () => {
    modal.classList.add('hidden');
    if (errorMsg) {
      errorMsg.classList.add('hidden');
      errorMsg.textContent = '';
    }
  };

  openBtn.addEventListener('click', () => {
    if (!selectedPerformer) return;
    nameInput.value = selectedPerformer;
    errorMsg.classList.add('hidden');
    errorMsg.textContent = '';
    modal.classList.remove('hidden');
    nameInput.focus();
    if (window.lucide) lucide.createIcons();
  });

  closeBtn?.addEventListener('click', hideModal);
  cancelBtn?.addEventListener('click', hideModal);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const newName = nameInput.value.trim();
    if (!newName || newName.length < 2) {
      errorMsg.textContent = 'Name must be at least 2 characters.';
      errorMsg.classList.remove('hidden');
      return;
    }

    if (newName.toLowerCase() === selectedPerformer.toLowerCase()) {
      hideModal();
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    errorMsg.classList.add('hidden');

    try {
      const res = await fetch('/api/performer/rename', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          old_name: selectedPerformer,
          new_name: newName
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Could not rename performer');
      }

      hideModal();
      selectedPerformer = newName;
      await loadPerformances();
      const select = document.getElementById('performer-select');
      if (select) select.value = newName;
      await handlePerformerSelected(newName);
      showToast(`✓ Participant renamed to ${newName}`);
    } catch (err) {
      errorMsg.textContent = err.message || 'Error renaming participant';
      errorMsg.classList.remove('hidden');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Name';
    }
  });
}
