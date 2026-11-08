// Food selector events, food status and selector.
// Classic script: shares globals with the other intake files (see load order in the page).

function setupFoodSelectorEvents() {
  const selectorCard = document.getElementById('food-selector-card');
  const closeBtn = document.getElementById('close-food-selector-btn');
  const cancelBtn = document.getElementById('cancel-food-btn');
  const saveBtn = document.getElementById('save-food-btn');

  const hideSelector = () => selectorCard.classList.add('hidden');
  closeBtn.addEventListener('click', hideSelector);
  cancelBtn.addEventListener('click', hideSelector);

  saveBtn.addEventListener('click', async () => {
    if (!selectedPerformer) return;
    const selectedRadio = document.querySelector('input[name="food_item_radio"]:checked');
    if (!selectedRadio) {
      alert('Please select an item from the list.');
      return;
    }

    const itemId = selectedRadio.value;
    const dishDesc = document.getElementById('food-dish-input').value.trim();

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
      if (performerFoodSignup && performerFoodSignup.signup_id) {
        const signerName = prompt('Enter the full name used to claim this dish:');
        if (signerName === null) return;
        const signerPhone = prompt('Enter the full phone number used to claim this dish:');
        if (signerPhone === null) return;
        // Update existing food signup
        const res = await fetch(`/api/signup/food/${performerFoodSignup.signup_id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            item_id: itemId,
            dish_description: dishDesc,
            signer_name: signerName,
            signer_phone: signerPhone
          })
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.detail || 'Could not update food item');
        }
      } else {
        const signerName = prompt('Enter your full name for this dish:', selectedPerformer);
        if (signerName === null) return;
        const signerPhone = prompt('Enter your full phone number so you can change this dish later:');
        if (signerPhone === null) return;
        if (!signerName.trim() || signerPhone.replace(/\D/g, '').length < 10) throw new Error('Enter your full name and a valid phone number.');
        // Create new food signup
        const res = await fetch('/api/signup/food', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            signer_name: signerName,
            signer_phone: signerPhone,
            item_id: itemId,
            dish_description: dishDesc
          })
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.detail || 'Could not claim food item');
        }
      }

      hideSelector();
      await loadFoodCatalog();
      await checkPerformerFoodStatus(selectedPerformer);
    } catch (err) {
      alert(err.message || 'Error saving food choice');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Food Sign-Up';
    }
  });
}

async function checkPerformerFoodStatus(name) {
  const ctaSection = document.getElementById('food-cta-section');
  const lookupVersion = ++profileLookupVersion;
  try {
    const res = await fetch(`/api/performer/profile?name=${encodeURIComponent(name)}`);
    if (selectedPerformer !== name || lookupVersion !== profileLookupVersion) return false;
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      throw new Error(typeof detail.detail === 'string' ? detail.detail : 'Could not load your entry. Please try again.');
    }
    if (res.ok) {
      const data = await res.json();
      if (selectedPerformer !== name || lookupVersion !== profileLookupVersion) return false;
      window.performerProfileData = data;

      if (data.food_enabled === false) {
        ctaSection.classList.add('hidden');
        document.getElementById('food-selector-card')?.classList.add('hidden');
        performerFoodSignup = null;
        return true;
      }

      performerFoodSignup = data.food_signup;
      // Dish-only people can still sign up to perform; their name and phone carry over on the sign-up page.
      const sing = (data.stage_performances_enabled !== false && !(data.performances || []).length)
        ? `<a href="/signup" class="me-cta"><span class="me-cta-text"><strong>Want to sing too?</strong><span>Sign up to perform. Your name and phone carry over.</span></span><span class="me-cta-go">Sign up</span></a>`
        : '';

      if (performerFoodSignup && performerFoodSignup.item_id) {
        // Claimed: the "My dish" card (name, group, serving size, note, change and release)
        ctaSection.innerHTML = `
          <section class="me-card me-dish" aria-labelledby="my-dish-heading">
            <div class="me-row me-row-top">
              <div class="me-dish-text">
                <span class="me-eyebrow" id="my-dish-heading">My dish</span>
                <span class="me-dish-name">${escapeHtml(performerFoodSignup.item_name)}</span>
                <span class="me-small">${escapeHtml(performerFoodSignup.group_name)} &middot; ${escapeHtml(foodServingNote)}</span>
                ${performerFoodSignup.dish_description ? `<span class="me-small">Note: ${escapeHtml(performerFoodSignup.dish_description)}</span>` : ''}
              </div>
              <span class="me-status" data-kind="ok">Yours</span>
            </div>
            <div class="me-two">
              <button type="button" id="change-food-btn" class="me-btn me-btn-primary">Change dish</button>
              <button type="button" id="release-food-btn" class="me-btn me-btn-danger">Release dish</button>
            </div>
            <p class="me-small">Releasing frees the slot for someone else. You will be asked to confirm. You can pick another dish any time.</p>
          </section>
          ${sing}
        `;

        document.getElementById('change-food-btn').addEventListener('click', () => {
          openFoodSelector(performerFoodSignup.item_id, performerFoodSignup.dish_description);
        });

        document.getElementById('release-food-btn').addEventListener('click', async () => {
          if (!confirm(`Release "${performerFoodSignup.item_name}"?\n\nThis frees the slot for someone else. You can pick another dish any time.`)) return;
          const signerName = prompt('Enter the full name used to claim this dish:');
          if (signerName === null) return;
          const signerPhone = prompt('Enter the full phone number used to claim this dish:');
          if (signerPhone === null) return;
          try {
            const delRes = await fetch(`/api/signup/food/${performerFoodSignup.signup_id}`, {
              method: 'DELETE', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ signer_name: signerName, signer_phone: signerPhone })
            });
            if (!delRes.ok) throw new Error((await delRes.json()).detail || 'Could not release dish.');
            await loadFoodCatalog();
            await checkPerformerFoodStatus(selectedPerformer);
            showToast('Dish released.', 'success');
          } catch (e) {
            alert(e.message || 'We could not release your dish. Please try again.');
          }
        });

      } else {
        // Nothing claimed: invite them to pick an open slot
        ctaSection.innerHTML = `
          <section class="me-card me-dish" aria-labelledby="my-dish-heading">
            <div class="me-dish-text">
              <span class="me-eyebrow" id="my-dish-heading">My dish</span>
              <span class="me-dish-name">You have not picked a dish yet</span>
              <span class="me-small">You do not have to perform to bring a dish. Pick an open slot from the food board.</span>
              <span class="me-small">${escapeHtml(foodServingNote)}</span>
            </div>
            <button type="button" id="pick-food-btn" class="me-btn me-btn-primary me-btn-block">Pick a dish</button>
          </section>
          ${sing}
        `;

        document.getElementById('pick-food-btn').addEventListener('click', () => {
          openFoodSelector();
        });

        // If deep linked food item exists, auto-open selector
        if (pendingDeepLinkFoodItem) {
          openFoodSelector(pendingDeepLinkFoodItem);
          pendingDeepLinkFoodItem = null;
        }
      }

      ctaSection.classList.remove('hidden');
      if (window.lucide) lucide.createIcons();
      return true;
    }
  } catch (e) {
    if (selectedPerformer !== name || lookupVersion !== profileLookupVersion) return false;
    window.performerProfileData = null;
    performerFoodSignup = null;
    selectedEntry = null;
    ctaSection.classList.add('hidden');
    document.getElementById('food-selector-card')?.classList.add('hidden');
    document.getElementById('song-selection-section')?.classList.add('hidden');
    document.getElementById('upload-methods-section')?.classList.add('hidden');
    document.getElementById('add-performance-btn')?.classList.add('hidden');
    document.getElementById('edit-performer-name-btn')?.classList.add('hidden');
    showToast(e.message || 'Could not load your entry. Please try again.', 'error');
    console.warn('Could not fetch performer food status:', e);
    return false;
  }
}

function openFoodSelector(preselectItemId = null, prefillDesc = '') {
  const selectorCard = document.getElementById('food-selector-card');
  const pickerContainer = document.getElementById('food-groups-picker');
  const dishInput = document.getElementById('food-dish-input');

  dishInput.value = prefillDesc || '';

  // Render food groups and items
  let html = '';
  allFoodGroups.forEach(group => {
    const items = allFoodItems.filter(i => i.group_id === group.group_id);
    if (items.length === 0) return; // Hide empty groups

    html += `
      <fieldset class="me-pick-group">
        <legend class="me-eyebrow">${escapeHtml(group.name)}</legend>
        <div class="me-pick-grid">
    `;

    items.forEach(item => {
      const isClaimedByOther = item.is_taken && (!performerFoodSignup || performerFoodSignup.item_id !== item.item_id);
      const isOwn = Boolean(performerFoodSignup && performerFoodSignup.item_id === item.item_id);
      const isSelected = preselectItemId ? item.item_id === preselectItemId : (performerFoodSignup && performerFoodSignup.item_id === item.item_id);

      if (isClaimedByOther) {
        html += `
          <div class="me-pick is-taken">
            <span class="me-pick-name">${escapeHtml(item.name)}</span>
            <span class="me-pick-tag">Taken${item.signer_name ? ' \u00b7 ' + escapeHtml(item.signer_name) : ''}</span>
          </div>
        `;
      } else {
        html += `
          <label class="me-pick${isSelected ? ' is-selected' : ''}">
            <input type="radio" name="food_item_radio" value="${item.item_id}" ${isSelected ? 'checked' : ''}>
            <span class="me-pick-name">${escapeHtml(item.name)}</span>
            <span class="me-pick-tag">${isOwn ? 'Yours' : 'Open'}</span>
          </label>
        `;
      }
    });

    html += `</div></fieldset>`;
  });

  pickerContainer.innerHTML = html;
  selectorCard.classList.remove('hidden');

  // Handle radio select highlighting
  document.querySelectorAll('input[name="food_item_radio"]').forEach(r => {
    r.addEventListener('change', () => {
      document.querySelectorAll('#food-groups-picker .me-pick').forEach(lbl => lbl.classList.remove('is-selected'));
      r.closest('label').classList.add('is-selected');
    });
  });

  selectorCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (window.lucide) lucide.createIcons();
}
