async function loadFoodGroups() {
  try {
    const res = await fetch("/api/admin/food-groups");
    if (!res.ok) return;
    foodGroups = await res.json();
    renderFoodGroupsList();
    populateGroupDropdowns();
    renderFoodItemsList();
  } catch (e) {
    console.error("Food groups error:", e);
  }
}

function renderFoodGroupsList() {
  const list = document.getElementById("admin-food-groups-list");
  if (!list) return;
  setupFoodGroupDragReorder();

  if (foodGroups.length === 0) {
    list.innerHTML = `<div class="ap-empty">
      <span class="ap-empty-ico"><i data-lucide="utensils"></i></span>
      <h3>No dishes yet</h3>
      <p>Start from a menu, then edit it. Paste a menu or pick a template under Quick add, or add a group above.</p>
      <button type="button" class="ap-btn ap-btn-primary" onclick="document.getElementById('bulk-food-text').focus()">Go to Quick add</button>
    </div>`;
    if (window.lucide) lucide.createIcons();
    return;
  }

  list.innerHTML = foodGroups.map((g, idx) => `
    <div class="ap-listrow" data-food-group-row data-group-id="${escapeHtml(g.group_id)}">
      <div class="lead">
        <span class="ix">${idx + 1}</span>
        <div>
          <strong>${escapeHtml(g.name)}</strong>
          <small>${g.taken_count || 0} of ${g.item_count || 0} slots claimed (${g.open_count || 0} open)</small>
        </div>
      </div>
      <div class="acts">
        <span class="ap-food-drag-handle" draggable="true" data-food-group-drag data-group-id="${escapeHtml(g.group_id)}" aria-hidden="true" title="Drag to reorder"><i data-lucide="grip-vertical"></i></span>
        <button type="button" data-food-group-action="move" data-group-index="${idx}" data-direction="-1" class="ap-iconbtn" ${idx === 0 ? 'disabled' : ''} title="Move up" aria-label="Move ${escapeHtml(g.name)} up"><i data-lucide="arrow-up"></i></button>
        <button type="button" data-food-group-action="move" data-group-index="${idx}" data-direction="1" class="ap-iconbtn" ${idx === foodGroups.length - 1 ? 'disabled' : ''} title="Move down" aria-label="Move ${escapeHtml(g.name)} down"><i data-lucide="arrow-down"></i></button>
        <button type="button" data-food-group-action="rename" data-group-id="${escapeHtml(g.group_id)}" data-group-name="${escapeHtml(g.name)}" class="ap-iconbtn" title="Rename" aria-label="Rename ${escapeHtml(g.name)}"><i data-lucide="edit-3"></i></button>
        <button type="button" data-food-group-action="delete" data-group-id="${escapeHtml(g.group_id)}" data-group-name="${escapeHtml(g.name)}" class="ap-iconbtn ap-iconbtn-danger" title="Delete" aria-label="Delete ${escapeHtml(g.name)}"><i data-lucide="trash-2"></i></button>
      </div>
    </div>
  `).join("");
  if (window.lucide) lucide.createIcons();
}

function setupFoodGroupDragReorder() {
  const list = document.getElementById("admin-food-groups-list");
  if (!list || list.dataset.foodDragBound) return;
  list.dataset.foodDragBound = "true";
  let draggedGroupId = "";

  list.addEventListener("dragstart", (event) => {
    const handle = event.target.closest?.("[data-food-group-drag]");
    if (!handle) return;
    draggedGroupId = String(handle.dataset.groupId || "");
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", draggedGroupId);
    }
  });
  list.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-food-group-action]");
    if (!button) return;
    const action = button.dataset.foodGroupAction;
    if (action === "move") window.moveGroup?.(Number(button.dataset.groupIndex), Number(button.dataset.direction));
    else if (action === "rename") window.renameGroup?.(button.dataset.groupId, button.dataset.groupName);
    else if (action === "delete") window.deleteGroup?.(button.dataset.groupId, button.dataset.groupName);
  });
  list.addEventListener("dragover", (event) => {
    if (event.target.closest?.("[data-food-group-row]") && draggedGroupId) {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    }
  });
  list.addEventListener("drop", async (event) => {
    const row = event.target.closest?.("[data-food-group-row]");
    if (!row) return;
    event.preventDefault();
    const fromId = draggedGroupId || String(event.dataTransfer?.getData("text/plain") || "");
    const toId = String(row.dataset.groupId || "");
    draggedGroupId = "";
    const from = foodGroups.findIndex(group => String(group.group_id) === fromId);
    const to = foodGroups.findIndex(group => String(group.group_id) === toId);
    if (from < 0 || to < 0 || from === to) return;

    const reordered = foodGroups.slice();
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    try {
      const response = await fetch("/api/admin/food-groups/reorder", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ordered_ids: reordered.map(group => group.group_id)}),
      });
      if (!response.ok) {
        showToast("Group reorder failed. The previous order was restored.", true);
        return;
      }
      foodGroups = reordered;
      renderFoodGroupsList();
      populateGroupDropdowns();
      renderFoodItemsList();
    } catch (error) {
      showToast("Group reorder failed. The previous order was restored.", true);
    }
  });
  list.addEventListener("dragend", () => { draggedGroupId = ""; });
}

function populateGroupDropdowns() {
  const filterSelect = document.getElementById("filter-group-select");
  const modalSelect = document.getElementById("new-item-group-select");

  if (filterSelect) {
    const currentVal = filterSelect.value;
    filterSelect.innerHTML = `<option value="">All Groups (${foodGroups.length})</option>` +
      foodGroups.map(g => `<option value="${escapeHtml(g.group_id)}">${escapeHtml(g.name)}</option>`).join("");
    if (currentVal) filterSelect.value = currentVal;
  }

  if (modalSelect) {
    modalSelect.innerHTML = foodGroups.map(g => `<option value="${escapeHtml(g.group_id)}">${escapeHtml(g.name)}</option>`).join("");
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
  setupFoodItemActions();

  const filtered = filterId ? foodItems.filter(i => String(i.group_id) === String(filterId)) : foodItems;

  if (filtered.length === 0) {
    list.innerHTML = `<div class="ap-empty-inline">No dish slots in this selection.</div>`;
    return;
  }

  const groupsWithItems = foodGroups.map(group => ({
    group,
    items: filtered.filter(item => String(item.group_id) === String(group.group_id)),
  })).filter(entry => entry.items.length);
  list.innerHTML = groupsWithItems.map(({group, items}) => `
    <section class="ap-food-group-section" data-food-items-group="${escapeHtml(group.group_id)}" aria-labelledby="admin-food-heading-${escapeHtml(group.group_id)}">
      <div class="ap-food-group-heading">
        <h4 id="admin-food-heading-${escapeHtml(group.group_id)}">${escapeHtml(group.name)}</h4>
        <span>${items.filter(item => !item.is_taken).length} open of ${items.length}</span>
      </div>
      <div class="ap-food-group-items">
        ${items.map(item => `
          <div class="ap-listrow">
            <div class="ap-slot-main">
              <div class="ap-slot-top">
                <strong>${escapeHtml(item.name)}</strong>
                ${item.is_taken ? '<span class="ap-chip ap-chip-ok">Claimed</span>' : '<span class="ap-chip ap-chip-warn">Open</span>'}
              </div>
              ${item.is_taken
                ? `<p class="ap-slot-note">Taken by <b>${escapeHtml(item.signer_name)}</b> ${item.signer_phone ? `<span class="ap-mono">(${escapeHtml(item.signer_phone)})</span> ` : ''}${item.dish_description ? `: ${escapeHtml(item.dish_description)}` : ''}</p>`
                : '<p class="ap-slot-note">No one has claimed this yet.</p>'}
            </div>
            <div class="acts">
              <button type="button" data-food-item-action="edit" data-item-id="${escapeHtml(item.item_id)}" class="ap-iconbtn" title="Edit slot and claim" aria-label="Edit ${escapeHtml(item.name)}"><i data-lucide="edit-3"></i></button>
              <button type="button" data-food-item-action="delete" data-item-id="${escapeHtml(item.item_id)}" data-item-name="${escapeHtml(item.name)}" data-is-taken="${Boolean(item.is_taken)}" class="ap-iconbtn ap-iconbtn-danger" title="Delete" aria-label="Delete ${escapeHtml(item.name)}"><i data-lucide="trash-2"></i></button>
            </div>
          </div>
        `).join("")}
      </div>
    </section>
  `).join("");
  if (window.lucide) lucide.createIcons();
}

function setupFoodItemActions() {
  const list = document.getElementById("admin-food-items-list");
  if (!list || list.dataset.foodActionsBound) return;
  list.dataset.foodActionsBound = "true";
  list.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-food-item-action]");
    if (!button) return;
    if (button.dataset.foodItemAction === "edit") {
      window.openAdminFoodModal?.(button.dataset.itemId);
    } else if (button.dataset.foodItemAction === "delete") {
      window.deleteItem?.(button.dataset.itemId, button.dataset.itemName, button.dataset.isTaken === "true");
    }
  });
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
      pill.className = "ap-chip ap-chip-ok";
      pill.textContent = "Claimed";
    }
    signerNameInput.value = item.signer_name || "";
    signerPhoneInput.value = item.signer_phone || "";
    dishDescInput.value = item.dish_description || "";
    if (releaseWrap) releaseWrap.classList.remove("hidden");
    if (releaseCheckbox) releaseCheckbox.checked = false;
  } else {
    if (pill) {
      pill.className = "ap-chip ap-chip-warn";
      pill.textContent = "Open";
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
