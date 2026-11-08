async function loadFoodGroups() {
  try {
    const res = await fetch("/api/admin/food-groups");
    if (!res.ok) return;
    foodGroups = await res.json();
    renderFoodGroupsList();
    populateGroupDropdowns();
  } catch (e) {
    console.error("Food groups error:", e);
  }
}

function renderFoodGroupsList() {
  const list = document.getElementById("admin-food-groups-list");
  if (!list) return;

  if (foodGroups.length === 0) {
    list.innerHTML = `<div class="p-4 text-center text-slate-500 text-xs">No food groups defined. Add one above.</div>`;
    return;
  }

  list.innerHTML = foodGroups.map((g, idx) => `
    <div class="flex items-center justify-between p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 text-xs">
      <div class="flex items-center gap-3">
        <span class="text-slate-500 font-mono text-[11px]">${idx + 1}</span>
        <div>
          <strong class="text-white font-bold text-sm">${g.name}</strong>
          <span class="text-[11px] text-slate-400 block">${g.taken_count || 0}/${g.item_count || 0} slots claimed (${g.open_count || 0} open)</span>
        </div>
      </div>
      <div class="flex items-center gap-1.5">
        <button onclick="moveGroup(${idx}, -1)" ${idx === 0 ? 'disabled class="opacity-30 p-1.5"' : 'class="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300"'} title="Move Up"><i data-lucide="arrow-up" class="w-3.5 h-3.5"></i></button>
        <button onclick="moveGroup(${idx}, 1)" ${idx === foodGroups.length - 1 ? 'disabled class="opacity-30 p-1.5"' : 'class="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300"'} title="Move Down"><i data-lucide="arrow-down" class="w-3.5 h-3.5"></i></button>
        <button onclick="renameGroup('${g.group_id}', '${escapeQuotes(g.name)}')" class="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300" title="Rename"><i data-lucide="edit-3" class="w-3.5 h-3.5"></i></button>
        <button onclick="deleteGroup('${g.group_id}', '${escapeQuotes(g.name)}')" class="p-1.5 rounded-lg bg-slate-900 hover:bg-rose-950 text-rose-400" title="Delete"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
      </div>
    </div>
  `).join("");
  if (window.lucide) lucide.createIcons();
}

function escapeQuotes(str) {
  return (str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function populateGroupDropdowns() {
  const filterSelect = document.getElementById("filter-group-select");
  const modalSelect = document.getElementById("new-item-group-select");

  if (filterSelect) {
    const currentVal = filterSelect.value;
    filterSelect.innerHTML = `<option value="">All Groups (${foodGroups.length})</option>` +
      foodGroups.map(g => `<option value="${g.group_id}">${g.name}</option>`).join("");
    if (currentVal) filterSelect.value = currentVal;
  }

  if (modalSelect) {
    modalSelect.innerHTML = foodGroups.map(g => `<option value="${g.group_id}">${g.name}</option>`).join("");
  }
}

async function loadFoodItems() {
  try {
    const res = await fetch("/api/admin/food-items");
    if (!res.ok) return;
    foodItems = await res.json();
    renderFoodItemsList();
  } catch (e) {
    console.error("Food items error:", e);
  }
}

function renderFoodItemsList() {
  const list = document.getElementById("admin-food-items-list");
  const filterId = document.getElementById("filter-group-select")?.value;
  if (!list) return;

  const filtered = filterId ? foodItems.filter(i => i.group_id === filterId) : foodItems;

  if (filtered.length === 0) {
    list.innerHTML = `<div class="p-4 text-center text-slate-500 text-xs">No food items found in this selection.</div>`;
    return;
  }

  list.innerHTML = filtered.map(item => `
    <div class="flex items-center justify-between p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 text-xs">
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <span class="w-2 h-2 rounded-full ${item.is_taken ? 'bg-rose-500' : 'bg-emerald-500'}"></span>
          <strong class="text-white font-bold">${item.name}</strong>
          <span class="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 font-semibold">${item.group_name}</span>
        </div>
        ${item.is_taken 
          ? `<p class="text-[11px] text-slate-400 mt-1 pl-4">Taken by <strong class="text-orange-400">${escapeHtml(item.signer_name)}</strong> ${item.signer_phone ? `<span class="text-slate-500 font-mono text-[10px]">(${escapeHtml(item.signer_phone)})</span> ` : ''}${item.dish_description ? `— "${escapeHtml(item.dish_description)}"` : ''}</p>`
          : '<p class="text-[11px] text-emerald-400/80 mt-1 pl-4">Available for participant claim</p>'}
      </div>
      <div class="flex items-center gap-2">
        <button onclick="openAdminFoodModal('${item.item_id}')" class="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300" title="Edit Item & Sign-Up"><i data-lucide="edit-3" class="w-3.5 h-3.5"></i></button>
        <button onclick="deleteItem('${item.item_id}', '${escapeQuotes(item.name)}', ${item.is_taken})" class="p-1.5 rounded-lg bg-slate-900 hover:bg-rose-950 text-rose-400" title="Delete"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
      </div>
    </div>
  `).join("");
  if (window.lucide) lucide.createIcons();
}

window.openAdminFoodModal = function(itemId) {
  const item = foodItems.find(i => i.item_id === itemId);
  if (!item) {
    showToast("Food item not found", true);
    return;
  }

  document.getElementById("admin-edit-food-item-id").value = item.item_id;
  document.getElementById("admin-edit-food-id-badge").textContent = item.item_id;
  document.getElementById("admin-edit-food-name").value = item.name || "";

  // Populate categories
  const groupSelect = document.getElementById("admin-edit-food-group");
  if (groupSelect) {
    groupSelect.innerHTML = foodGroups.map(g => `<option value="${g.group_id}">${escapeHtml(g.name)}</option>`).join("");
    groupSelect.value = item.group_id || (foodGroups[0] ? foodGroups[0].group_id : "");
  }

  const pill = document.getElementById("admin-food-claim-status-pill");
  const signerNameInput = document.getElementById("admin-edit-food-signer-name");
  const signerPhoneInput = document.getElementById("admin-edit-food-signer-phone");
  const dishDescInput = document.getElementById("admin-edit-food-dish-desc");
  const releaseWrap = document.getElementById("admin-food-release-wrap");
  const releaseCheckbox = document.getElementById("admin-edit-food-release");

  if (item.is_taken) {
    if (pill) {
      pill.className = "text-[10px] px-2 py-0.5 rounded-full font-bold bg-rose-500/15 text-rose-300 border border-rose-500/30";
      pill.textContent = "CLAIMED";
    }
    signerNameInput.value = item.signer_name || "";
    signerPhoneInput.value = item.signer_phone || "";
    dishDescInput.value = item.dish_description || "";
    if (releaseWrap) releaseWrap.classList.remove("hidden");
    if (releaseCheckbox) releaseCheckbox.checked = false;
  } else {
    if (pill) {
      pill.className = "text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30";
      pill.textContent = "AVAILABLE";
    }
    signerNameInput.value = "";
    signerPhoneInput.value = "";
    dishDescInput.value = "";
    if (releaseWrap) releaseWrap.classList.add("hidden");
    if (releaseCheckbox) releaseCheckbox.checked = false;
  }

  document.getElementById("admin-edit-food-modal").classList.remove("hidden");
  if (window.lucide) lucide.createIcons();
};

window.closeAdminFoodModal = function() {
  document.getElementById("admin-edit-food-modal").classList.add("hidden");
};

window.editItem = function(itemId) {
  window.openAdminFoodModal(itemId);
};

window.saveFoodItemModal = async function() {
  const itemId = document.getElementById("admin-edit-food-item-id").value;
  if (!itemId) return;

  const nameVal = document.getElementById("admin-edit-food-name").value.trim();
  const groupIdVal = document.getElementById("admin-edit-food-group").value;
  const signerNameVal = document.getElementById("admin-edit-food-signer-name").value.trim();
  const signerPhoneVal = document.getElementById("admin-edit-food-signer-phone").value.trim();
  const dishDescVal = document.getElementById("admin-edit-food-dish-desc").value.trim();
  const releaseClaimVal = document.getElementById("admin-edit-food-release") ? document.getElementById("admin-edit-food-release").checked : false;

  if (!nameVal) {
    showToast("Food item name cannot be empty", true);
    return;
  }

  const payload = {
    name: nameVal,
    group_id: groupIdVal,
    signer_name: signerNameVal,
    signer_phone: signerPhoneVal,
    dish_description: dishDescVal,
    release_claim: releaseClaimVal
  };

  try {
    const res = await fetch(`/api/admin/food-items/${itemId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      window.closeAdminFoodModal();
      showToast("Food item & sign-up updated!");
      await Promise.all([loadFoodItems(), loadParticipants(), loadSummary()]);
    } else {
      const err = await res.json();
      showToast(`Update failed: ${err.detail || "Error"}`, true);
    }
  } catch (e) {
    showToast("Network error updating food item", true);
  }
};

window.deleteItem = async function(itemId, name, isTaken) {
  let force = false;
  if (isTaken) {
    if (!confirm(`Warning: "${name}" is currently claimed by a participant! Delete anyway?`)) return;
    force = true;
  } else {
    if (!confirm(`Delete item "${name}"?`)) return;
  }

  try {
    const res = await fetch(`/api/admin/food-items/${itemId}?force=${force}`, { method: "DELETE" });
    if (res.ok) {
      await Promise.all([loadFoodItems(), loadFoodGroups()]);
      showToast("Item deleted!");
    }
  } catch (e) {
    showToast("Delete failed", true);
  }
};
