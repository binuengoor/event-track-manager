window.openEditParticipantModal = function(entryId) {
  const p = allParticipants.find(item => item.entry_id === entryId);
  if (!p) {
    showToast("Participant not found", true);
    return;
  }

  document.getElementById("admin-edit-entry-id").value = p.entry_id;
  document.getElementById("admin-edit-entry-id-badge").textContent = p.entry_id;
  document.getElementById("admin-edit-performer-name").value = p.performer_name || "";
  document.getElementById("admin-edit-contact-info").value = p.contact_info || "";
  document.getElementById("admin-edit-age-group").value = p.age_group || "Senior";
  document.getElementById("admin-edit-guardian-name").value = p.guardian_name || "";
  document.getElementById("admin-edit-guardian-phone").value = p.guardian_phone || p.phone || "";
  document.getElementById("admin-edit-performance-type").value = p.performance_type || "Solo";
  document.getElementById("admin-edit-partner-name").value = p.partner_name || "";
  document.getElementById("admin-edit-partner-phone").value = p.partner_phone || "";
  document.getElementById("admin-edit-partner-age-group").value = p.partner_age_group || "";
  document.getElementById("admin-edit-song-title").value = p.song_title || "";
  document.getElementById("admin-edit-movie-name").value = p.movie_name || "";
  document.getElementById("admin-edit-sequence-order").value = p.sequence_order || "";
  document.getElementById("admin-edit-track-status").value = p.track_status || "Pending";
  document.getElementById("admin-edit-performance-status").value = p.performance_status || "Upcoming";
  document.getElementById("admin-edit-stage-notes").value = p.stage_notes || "";

  // Food Item Contribution Dropdown
  const foodSelect = document.getElementById("admin-edit-food-item");
  const shareNotice = document.getElementById("admin-edit-food-share-notice");
  const shareText = document.getElementById("admin-edit-food-share-text");
  if (shareNotice) shareNotice.classList.add("hidden");

  if (foodSelect) {
    const perfName = (p.performer_name || "").trim().toLowerCase();
    let currentItemId = (p.food_signup && p.food_signup.item_id) || "";

    let optionsHtml = `<option value="">-- None / No Potluck Sign-Up --</option>`;
    foodItems.forEach(item => {
      const isTaken = Boolean(item.is_taken);
      const signerRaw = item.signer_name || "";
      const signers = signerRaw.split(/[&,]|(?:\band\b)/i).map(s => s.trim().toLowerCase());
      const isCurrentSigner = isTaken && (
        (currentItemId && item.item_id === currentItemId) ||
        signers.includes(perfName) || 
        signers.some(s => (s.length >= 3 && perfName.includes(s)) || (perfName.length >= 3 && s.includes(perfName)))
      );

      if (isCurrentSigner && !currentItemId) {
        currentItemId = item.item_id;
      }

      let label = `[${item.group_name || 'Food'}] ${item.name}`;
      if (isCurrentSigner) {
        label += ` (Current: ${signerRaw})`;
      } else if (isTaken) {
        label += ` (Claimed by ${signerRaw})`;
      } else {
        label += ` (Available)`;
      }
      optionsHtml += `<option value="${item.item_id}" data-taken="${isTaken ? '1' : '0'}" data-signer="${escapeQuotes(signerRaw)}">${escapeHtml(label)}</option>`;
    });
    foodSelect.innerHTML = optionsHtml;
    foodSelect.value = currentItemId || "";

    foodSelect.onchange = function() {
      const selectedOpt = foodSelect.options[foodSelect.selectedIndex];
      const isTaken = selectedOpt?.getAttribute("data-taken") === "1";
      const signer = selectedOpt?.getAttribute("data-signer") || "";
      const signers = signer.split(/[&,]|(?:\band\b)/i).map(s => s.trim().toLowerCase());
      const isCurrent = (currentItemId && selectedOpt?.value === currentItemId) ||
        signers.includes(perfName) || 
        signers.some(s => (s.length >= 3 && perfName.includes(s)) || (perfName.length >= 3 && s.includes(perfName)));

      if (isTaken && !isCurrent) {
        if (shareText) shareText.textContent = `Already claimed by ${signer}. Saving will link this food item across both family members/participants.`;
        if (shareNotice) shareNotice.classList.remove("hidden");
      } else {
        if (shareNotice) shareNotice.classList.add("hidden");
      }
    };
  }

  document.getElementById("admin-edit-participant-modal").classList.remove("hidden");
  if (window.lucide) lucide.createIcons();
};

function closeAdminEditModal() {
  document.getElementById("admin-edit-participant-modal").classList.add("hidden");
}

async function saveParticipantEdit() {
  const entryId = document.getElementById("admin-edit-entry-id").value;
  if (!entryId) return;

  const contactInfoVal = document.getElementById("admin-edit-contact-info").value.trim();
  const guardianPhoneVal = document.getElementById("admin-edit-guardian-phone").value.trim();
  const partnerPhoneVal = document.getElementById("admin-edit-partner-phone").value.trim();
  const perfType = document.getElementById("admin-edit-performance-type").value;
  const partnerName = document.getElementById("admin-edit-partner-name").value.trim();

  // Validate phone format if entered
  const cleanPhone = (val) => (val || "").replace(/\D/g, "");
  if (contactInfoVal && cleanPhone(contactInfoVal).length < 10) {
    showToast("Participant phone number must be at least 10 digits", true);
    return;
  }
  if (guardianPhoneVal && cleanPhone(guardianPhoneVal).length < 10) {
    showToast("Guardian phone number must be at least 10 digits", true);
    return;
  }
  if (perfType.toLowerCase() === "duet" && partnerName && partnerPhoneVal && cleanPhone(partnerPhoneVal).length < 10) {
    showToast("Partner phone number must be at least 10 digits", true);
    return;
  }

  const seqVal = document.getElementById("admin-edit-sequence-order").value;
  const foodSelect = document.getElementById("admin-edit-food-item");
  const foodItemIdVal = foodSelect ? foodSelect.value : null;

  const payload = {
    performer_name: document.getElementById("admin-edit-performer-name").value.trim(),
    contact_info: contactInfoVal || null,
    age_group: document.getElementById("admin-edit-age-group").value,
    guardian_name: document.getElementById("admin-edit-guardian-name").value.trim() || null,
    guardian_phone: guardianPhoneVal || null,
    phone: guardianPhoneVal || null,
    performance_type: perfType,
    partner_name: partnerName || null,
    partner_phone: partnerPhoneVal || null,
    partner_age_group: document.getElementById("admin-edit-partner-age-group").value || null,
    song_title: document.getElementById("admin-edit-song-title").value.trim() || null,
    movie_name: document.getElementById("admin-edit-movie-name").value.trim() || null,
    sequence_order: seqVal ? parseInt(seqVal, 10) : null,
    track_status: document.getElementById("admin-edit-track-status").value,
    performance_status: document.getElementById("admin-edit-performance-status").value,
    stage_notes: document.getElementById("admin-edit-stage-notes").value.trim() || null,
    food_item_id: foodItemIdVal
  };

  try {
    const res = await fetch(`/api/admin/participants/${entryId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      closeAdminEditModal();
      showToast(`Updated ${payload.performer_name || entryId}`);
      await Promise.all([loadParticipants(), loadFoodItems(), loadSummary()]);
    } else {
      const err = await res.json();
      showToast(`Update failed: ${err.detail || "Error"}`, true);
    }
  } catch (e) {
    showToast("Network error updating participant", true);
  }
}

window.deleteParticipant = async function(entryId, name) {
  if (!confirm(`Are you sure you want to delete "${name}" (${entryId})? This will permanently remove the performance and its track cache.`)) {
    return;
  }

  try {
    const res = await fetch(`/api/admin/participants/${entryId}`, {
      method: "DELETE"
    });
    if (res.ok) {
      showToast(`Deleted ${name} (${entryId})`);
      await Promise.all([loadParticipants(), loadSummary()]);
    } else {
      const err = await res.json();
      showToast(`Delete failed: ${err.detail || "Error"}`, true);
    }
  } catch (e) {
    showToast("Network error deleting participant", true);
  }
};

window.moveGroup = async function(idx, direction) {
  const targetIdx = idx + direction;
  if (targetIdx < 0 || targetIdx >= foodGroups.length) return;

  const temp = foodGroups[idx];
  foodGroups[idx] = foodGroups[targetIdx];
  foodGroups[targetIdx] = temp;

  const orderedIds = foodGroups.map(g => g.group_id);
  renderFoodGroupsList();

  try {
    await fetch("/api/admin/food-groups/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ordered_ids: orderedIds })
    });
  } catch (e) {
    showToast("Reorder sync failed", true);
  }
};

window.renameGroup = async function(groupId, currentName) {
  const newName = prompt("Enter new name for this food group:", currentName);
  if (!newName || newName.trim() === currentName) return;

  try {
    const res = await fetch(`/api/admin/food-groups/${groupId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() })
    });
    if (res.ok) {
      await Promise.all([loadFoodGroups(), loadFoodItems()]);
      showToast("Group renamed!");
    }
  } catch (e) {
    showToast("Rename failed", true);
  }
};

window.deleteGroup = async function(groupId, name) {
  if (!confirm(`Are you sure you want to delete group "${name}"?`)) return;

  try {
    const res = await fetch(`/api/admin/food-groups/${groupId}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      alert(data.detail || "Cannot delete group.");
      return;
    }
    await Promise.all([loadFoodGroups(), loadFoodItems()]);
    showToast("Group deleted!");
  } catch (e) {
    showToast("Delete failed", true);
  }
};
