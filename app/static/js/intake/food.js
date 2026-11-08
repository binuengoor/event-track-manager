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

      if (performerFoodSignup && performerFoodSignup.item_id) {
        // User has claimed food item -> Green Card
        ctaSection.innerHTML = `
          <div class="p-4 rounded-2xl bg-emerald-950/40 border border-emerald-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div class="flex items-start gap-3">
              <div class="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                <i data-lucide="utensils" class="w-4 h-4"></i>
              </div>
              <div>
                <div class="flex items-center gap-2">
                  <h4 class="text-sm font-bold text-white">${escapeHtml(performerFoodSignup.item_name)}</h4>
                  <span class="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-200 font-bold border border-amber-500/40">YOURS</span>
                </div>
                <p class="text-xs text-slate-300 mt-0.5">${performerFoodSignup.dish_description ? escapeHtml(performerFoodSignup.dish_description) : 'No description provided'}</p>
                <p class="text-[11px] text-emerald-400/80 mt-0.5">Group: ${escapeHtml(performerFoodSignup.group_name)} &bull; ${escapeHtml(foodServingNote)}</p>
              </div>
            </div>
            <div class="flex items-center gap-2 self-end sm:self-center">
              <button type="button" id="change-food-btn" class="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 transition flex items-center gap-1">
                <i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i>
                <span>Change Dish</span>
              </button>
              <button type="button" id="release-food-btn" class="px-3 py-1.5 rounded-xl bg-rose-950/60 hover:bg-rose-900/60 text-xs font-semibold text-rose-300 border border-rose-500/40 transition flex items-center gap-1">
                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                <span>Release</span>
              </button>
            </div>
          </div>
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
        // No food item claimed -> Yellow CTA Card
        ctaSection.innerHTML = `
          <div class="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div class="flex items-start gap-3">
              <div class="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0 mt-0.5">
                <i data-lucide="utensils" class="w-4 h-4"></i>
              </div>
              <div>
                <h4 class="text-sm font-bold text-white">You have not picked a dish yet</h4>
                <p class="text-xs text-amber-300/90 mt-0.5">You do not have to perform to bring a dish. Pick an open slot from the food board.</p>
                <p class="text-[11px] text-slate-400 mt-0.5">${escapeHtml(foodServingNote)}</p>
              </div>
            </div>
            <button type="button" id="pick-food-btn" class="px-3.5 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-xs font-bold text-white shadow-md shadow-amber-500/20 transition flex items-center gap-1.5 shrink-0 self-end sm:self-center">
              <i data-lucide="plus-circle" class="w-3.5 h-3.5"></i>
              <span>Pick a Dish</span>
            </button>
          </div>
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
      <div class="space-y-2">
        <h5 class="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
          <span>●</span>
          <span>${escapeHtml(group.name)}</span>
        </h5>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
    `;

    items.forEach(item => {
      const isClaimedByOther = item.is_taken && (!performerFoodSignup || performerFoodSignup.item_id !== item.item_id);
      const isOwn = Boolean(performerFoodSignup && performerFoodSignup.item_id === item.item_id);
      const isSelected = preselectItemId ? item.item_id === preselectItemId : (performerFoodSignup && performerFoodSignup.item_id === item.item_id);

      if (isClaimedByOther) {
        html += `
          <div class="p-2.5 rounded-xl bg-slate-950/40 border border-slate-800/60 opacity-60 flex items-center justify-between text-xs">
            <span class="text-slate-400 line-through">${escapeHtml(item.name)}</span>
            <span class="text-[10px] text-rose-400 font-mono">Taken${item.signer_name ? ' \u00b7 ' + escapeHtml(item.signer_name) : ''}</span>
          </div>
        `;
      } else {
        html += `
          <label class="p-2.5 rounded-xl border flex items-center justify-between text-xs cursor-pointer transition ${
            isSelected ? 'bg-amber-500/15 border-amber-500/60 text-white' : 'bg-slate-950 border-slate-800 text-slate-200 hover:border-slate-700'
          }">
            <div class="flex items-center gap-2">
              <input type="radio" name="food_item_radio" value="${item.item_id}" ${isSelected ? 'checked' : ''} class="text-amber-500 accent-amber-500 focus:ring-amber-500">
              <span class="font-medium">${escapeHtml(item.name)}</span>
            </div>
            <span class="text-[10px] font-semibold uppercase ${isOwn ? 'text-amber-300' : 'text-emerald-400'}">${isOwn ? 'Yours' : 'Open'}</span>
          </label>
        `;
      }
    });

    html += `</div></div>`;
  });

  pickerContainer.innerHTML = html;
  selectorCard.classList.remove('hidden');

  // Handle radio select highlighting
  document.querySelectorAll('input[name="food_item_radio"]').forEach(r => {
    r.addEventListener('change', () => {
      document.querySelectorAll('#food-groups-picker label').forEach(lbl => {
        lbl.className = 'p-2.5 rounded-xl border flex items-center justify-between text-xs cursor-pointer transition bg-slate-950 border-slate-800 text-slate-200 hover:border-slate-700';
      });
      r.closest('label').className = 'p-2.5 rounded-xl border flex items-center justify-between text-xs cursor-pointer transition bg-amber-500/15 border-amber-500/60 text-white';
    });
  });

  selectorCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (window.lucide) lucide.createIcons();
}
