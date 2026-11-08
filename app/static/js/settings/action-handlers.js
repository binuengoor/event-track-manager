function setupActionHandlers() {
  // Activity Log Handlers
  document.getElementById("refresh-activity-btn")?.addEventListener("click", () => loadActivityLogs());
  document.getElementById("activity-days-filter")?.addEventListener("change", () => loadActivityLogs());
  document.getElementById("activity-action-filter")?.addEventListener("change", (e) => {
    currentActivityFilter = e.target.value;
    filterAndRenderActivityLogs();
  });

  const actSearch = document.getElementById("activity-search-input");
  const actClear = document.getElementById("clear-activity-search");
  actSearch?.addEventListener("input", (e) => {
    currentActivitySearch = e.target.value.trim();
    if (currentActivitySearch) {
      actClear?.classList.remove("hidden");
    } else {
      actClear?.classList.add("hidden");
    }
    filterAndRenderActivityLogs();
  });
  actClear?.addEventListener("click", () => {
    if (actSearch) actSearch.value = "";
    currentActivitySearch = "";
    actClear?.classList.add("hidden");
    filterAndRenderActivityLogs();
  });

  // Live Character Counters
  document.getElementById("setting-header-brand-title")?.addEventListener("input", updateCharCounters);
  document.getElementById("setting-header-brand-subtitle")?.addEventListener("input", updateCharCounters);
  document.getElementById("setting-event-name")?.addEventListener("input", updateCharCounters);
  document.getElementById("setting-event-subtitle")?.addEventListener("input", updateCharCounters);

  // Save Event Details
  document.getElementById("save-event-settings-btn")?.addEventListener("click", async () => {
    const headerTitleVal = document.getElementById("setting-header-brand-title") ? document.getElementById("setting-header-brand-title").value.trim() : "";
    const headerSubVal = document.getElementById("setting-header-brand-subtitle") ? document.getElementById("setting-header-brand-subtitle").value.trim() : "";
    const titleVal = document.getElementById("setting-event-name").value.trim();
    const subVal = document.getElementById("setting-event-subtitle").value.trim();

    if (headerTitleVal.length > 35) {
      alert("Header Brand Title cannot exceed 35 characters.");
      return;
    }
    if (headerSubVal.length > 45) {
      alert("Header Brand Subtitle cannot exceed 45 characters.");
      return;
    }
    if (titleVal.length > 60) {
      alert("Homepage Event title cannot exceed 60 characters.");
      return;
    }
    if (subVal.length > 80) {
      alert("Homepage Event subtitle cannot exceed 80 characters.");
      return;
    }

    const payload = {
      header_brand_title: headerTitleVal || "Event",
      header_brand_subtitle: headerSubVal || "Musical Night",
      event_name: titleVal,
      event_subtitle: subVal,
      event_start_time: document.getElementById("setting-event-date-time").value.trim(),
      event_time_range: document.getElementById("setting-event-time-range").value.trim(),
      doors_open_time: document.getElementById("setting-doors-open-time") ? document.getElementById("setting-doors-open-time").value.trim() : "",
      post_event_link_url: document.getElementById("setting-post-event-link-url") ? document.getElementById("setting-post-event-link-url").value.trim() : "",
      event_venue: document.getElementById("setting-event-venue").value.trim(),
      event_poster_url: document.getElementById("setting-event-poster-url").value.trim(),
      entry_id_prefix: document.getElementById("setting-entry-id-prefix").value.trim(),
      payment_url: document.getElementById("setting-payment-url").value.trim(),
      hero_tag_primary: document.getElementById("setting-hero-tag-primary") ? document.getElementById("setting-hero-tag-primary").value.trim() : "Musical Evening",
      hero_tag_status: document.getElementById("setting-hero-tag-status") ? document.getElementById("setting-hero-tag-status").value.trim() : "Stage Ready",
      general_notes: document.getElementById("setting-general-notes") ? document.getElementById("setting-general-notes").value.trim() : "",
      external_link_url: document.getElementById("setting-external-link-url").value.trim()
    };
    await updateSettingsApi(payload, "Event Details saved successfully!");
  });

  // Save Rules
  document.getElementById("save-rules-btn")?.addEventListener("click", async () => {
    const payload = {
      max_performances_per_participant: parseInt(document.getElementById("setting-max-perfs").value, 10) || 2,
      max_solo_per_participant: parseInt(document.getElementById("setting-max-solo").value, 10) || 1,
      max_audio_upload_mb: parseInt(document.getElementById("setting-max-audio-mb").value, 10) || 200,
      max_video_upload_mb: parseInt(document.getElementById("setting-max-video-mb").value, 10) || 500,
      shorten_junior_names: document.getElementById("setting-shorten-junior-names").getAttribute("aria-checked") === "true",
      performance_types: perfTypes,
      age_groups: ageGroups,
      allowed_media: (window.readAllowedMedia ? window.readAllowedMedia() : ["audio", "video"])
    };
    await updateSettingsApi(payload, "Sign-up rules updated successfully!");
  });

  // Add Type
  document.getElementById("add-type-btn")?.addEventListener("click", () => {
    const input = document.getElementById("new-type-input");
    const val = input.value.trim();
    if (val && !perfTypes.includes(val)) {
      perfTypes.push(val);
      input.value = "";
      renderPerformanceTypeChips();
    }
  });

  // Add Age Group
  document.getElementById("add-ag-btn")?.addEventListener("click", () => {
    const nameInput = document.getElementById("new-ag-name");
    const descriptionInput = document.getElementById("new-ag-description");
    const guardInput = document.getElementById("new-ag-guardian");
    const name = nameInput.value.trim();
    if (name) {
      ageGroups.push({ name, description: descriptionInput ? descriptionInput.value.trim() : "", requires_guardian: guardInput.checked });
      nameInput.value = "";
      if (descriptionInput) descriptionInput.value = "";
      guardInput.checked = false;
      renderAgeGroupsTable();
    }
  });

  // Food Serving Note
  document.getElementById("save-food-note-btn")?.addEventListener("click", async () => {
    const text = document.getElementById("setting-food-serving-note").value.trim();
    try {
      const res = await fetch("/api/admin/food-serving-note", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text })
      });
      if (res.ok) showToast("Serving note updated!");
    } catch (e) {
      showToast("Failed to update serving note", true);
    }
  });

  // Sign-Up Status Toggle
  document.getElementById("toggle-signup-status-btn")?.addEventListener("click", async () => {
    const currentlyEnabled = Boolean(adminSettings.signup_enabled !== false);
    const newEnabled = !currentlyEnabled;
    try {
      const res = await fetch("/api/admin/signup-toggle", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: newEnabled })
      });
      if (res.ok) {
        adminSettings.signup_enabled = newEnabled;
        updateSignupToggleButton(newEnabled);
        showToast(`Sign-ups ${newEnabled ? 'opened' : 'closed'}!`);
      }
    } catch (e) {
      showToast("Toggle failed", true);
    }
  });

  // Food Toggle
  document.getElementById("toggle-food-status-btn")?.addEventListener("click", async () => {
    const currentlyEnabled = Boolean(adminSettings.food_signup_enabled !== false);
    const newEnabled = !currentlyEnabled;
    try {
      const res = await fetch("/api/admin/food-toggle", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: newEnabled })
      });
      if (res.ok) {
        adminSettings.food_signup_enabled = newEnabled;
        updateFoodToggleButton(newEnabled);
        renderFeatureToggles();
        showToast(`Food sign-up ${newEnabled ? 'enabled' : 'disabled'}!`);
      }
    } catch (e) {
      showToast("Toggle failed", true);
    }
  });

  // Apply Presets
  document.querySelectorAll(".preset-apply-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const preset = btn.dataset.preset;
      try {
        btn.disabled = true;
        const res = await fetch("/api/admin/apply-preset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ preset })
        });
        btn.disabled = false;
        if (res.ok) {
          showToast(`Preset '${preset}' applied successfully!`);
          await loadSettings();
        } else {
          const data = await res.json();
          showToast(data.detail || "Failed to apply preset", true);
        }
      } catch (e) {
        btn.disabled = false;
        showToast("Error applying preset", true);
      }
    });
  });

  // Add Group
  document.getElementById("add-group-btn")?.addEventListener("click", async () => {
    const input = document.getElementById("new-group-name");
    const name = input.value.trim();
    if (!name) return;

    try {
      const res = await fetch("/api/admin/food-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name })
      });
      if (res.ok) {
        input.value = "";
        await loadFoodGroups();
        showToast(`Group "${name}" added!`);
      }
    } catch (e) {
      showToast("Failed to add group", true);
    }
  });

  // Item filter change
  document.getElementById("filter-group-select")?.addEventListener("change", renderFoodItemsList);

  // Add item form toggle
  const addItemBox = document.getElementById("add-item-box");
  document.getElementById("open-add-item-modal-btn")?.addEventListener("click", () => {
    addItemBox.classList.remove("hidden");
  });
  document.getElementById("cancel-add-item-btn")?.addEventListener("click", () => {
    addItemBox.classList.add("hidden");
  });

  // Submit Add Item
  document.getElementById("submit-add-item-btn")?.addEventListener("click", async () => {
    const name = document.getElementById("new-item-name").value.trim();
    const groupId = document.getElementById("new-item-group-select").value;
    if (!name || !groupId) return;

    try {
      const res = await fetch("/api/admin/food-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, group_id: groupId })
      });
      if (res.ok) {
        document.getElementById("new-item-name").value = "";
        addItemBox.classList.add("hidden");
        await Promise.all([loadFoodItems(), loadFoodGroups()]);
        showToast(`Item "${name}" created!`);
      }
    } catch (e) {
      showToast("Failed to create item", true);
    }
  });

  // Force Backup Now
  document.getElementById("force-backup-btn")?.addEventListener("click", async () => {
    const btn = document.getElementById("force-backup-btn");
    btn.disabled = true;
    showToast("Starting immediate backup snapshot...");
    try {
      const res = await fetch("/api/admin/backup-now", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.status === "success") {
        showToast(`Export complete! ${data.rows_backed} rows written to the event folder.`);
        await loadBackupStatus();
      } else {
        showToast(`Backup error: ${data.error || "Failed"}`, true);
      }
    } catch (e) {
      showToast("Backup request failed", true);
    } finally {
      btn.disabled = false;
    }
  });

  // Export signups now button
  document.getElementById("sync-sheet-now-btn")?.addEventListener("click", async () => {
    const btn = document.getElementById("sync-sheet-now-btn");
    btn.disabled = true;
    showToast("Exporting signups to the event folder...");
    try {
      const res = await fetch("/api/export-now", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.status === "success") {
        showToast("Export complete: signups.xlsx, signups.csv and potluck.csv updated.");
      } else {
        showToast(`Sync error: ${data.message || "Failed"}`, true);
      }
    } catch (e) {
      showToast("Sync request failed", true);
    } finally {
      btn.disabled = false;
    }
  });

  // Participant Search Input
  document.getElementById("participant-search-input")?.addEventListener("input", () => {
    renderParticipantsTable();
  });

  // Sortable column headers
  document.querySelectorAll("th[data-sort-key]").forEach(th => {
    th.addEventListener("click", () => {
      const key = th.dataset.sortKey;
      if (currentSort.column === key) {
        currentSort.direction = currentSort.direction === "asc" ? "desc" : "asc";
      } else {
        currentSort.column = key;
        currentSort.direction = "asc";
      }
      renderParticipantsTable();
    });
  });

  // Participant category filter pills (All / Juniors / Seniors)
  document.getElementById("participant-filter-pills")?.addEventListener("click", (e) => {
    const pill = e.target.closest("button[data-filter]");
    if (!pill) return;
    setCategoryFilter(pill.dataset.filter);
  });

  // Top stat cards click navigation to participants filter
  document.getElementById("stat-card-participants")?.addEventListener("click", () => {
    switchToTab("participants");
    setCategoryFilter("all");
  });
  document.getElementById("stat-card-juniors")?.addEventListener("click", () => {
    switchToTab("participants");
    setCategoryFilter("junior");
  });
  document.getElementById("stat-card-seniors")?.addEventListener("click", () => {
    switchToTab("participants");
    setCategoryFilter("senior");
  });

  // Modal Cancel / Close buttons
  document.getElementById("close-admin-edit-modal-btn")?.addEventListener("click", closeAdminEditModal);
  document.getElementById("cancel-admin-edit-btn")?.addEventListener("click", closeAdminEditModal);

  // Participant Edit Form Submit
  document.getElementById("admin-edit-participant-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await saveParticipantEdit();
  });

  // Food Item Modal Listeners
  document.getElementById("close-admin-food-modal-btn")?.addEventListener("click", closeAdminFoodModal);
  document.getElementById("cancel-admin-food-btn")?.addEventListener("click", closeAdminFoodModal);
  document.getElementById("admin-edit-food-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await saveFoodItemModal();
  });

  // Table action button clicks (Edit & Delete delegation)
  document.getElementById("participants-table-body")?.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const entryId = btn.dataset.entryId;
    if (!entryId) return;

    if (action === "edit-participant") {
      openEditParticipantModal(entryId);
    } else if (action === "delete-participant") {
      const name = btn.dataset.name || entryId;
      deleteParticipant(entryId, name);
    }
  });
}
