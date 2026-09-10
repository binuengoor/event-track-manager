let adminSettings = {};
let foodGroups = [];
let foodItems = [];
let perfTypes = [];
let ageGroups = [];
let allParticipants = [];

document.addEventListener("DOMContentLoaded", async () => {
  if (window.lucide) lucide.createIcons();
  setupPinAuth();
  setupTabs();
  await checkAuthAndLoad();
});

function setupPinAuth() {
  const pinForm = document.getElementById("pin-form");
  const pinInput = document.getElementById("pin-input");
  const pinError = document.getElementById("pin-error");

  pinForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    pinError.classList.add("hidden");
    const pin = pinInput.value.trim();
    if (!pin) return;

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin })
      });

      if (!res.ok) throw new Error("Invalid PIN. Please try again.");

      document.getElementById("pin-modal").classList.add("hidden");
      document.getElementById("auth-status-badge")?.classList.remove("hidden");
      await loadAllAdminData();
    } catch (err) {
      pinError.textContent = err.message;
      pinError.classList.remove("hidden");
    }
  });
}

async function checkAuthAndLoad() {
  try {
    const res = await fetch("/api/admin/settings");
    if (res.status === 401) {
      document.getElementById("pin-modal").classList.remove("hidden");
      return;
    }
    if (!res.ok) throw new Error("Could not load admin settings");

    document.getElementById("pin-modal").classList.add("hidden");
    document.getElementById("auth-status-badge")?.classList.remove("hidden");
    await loadAllAdminData();
  } catch (err) {
    document.getElementById("pin-modal").classList.remove("hidden");
  }
}

function setupTabs() {
  const tabs = document.querySelectorAll(".admin-tab-btn");
  tabs.forEach(btn => {
    btn.addEventListener("click", () => {
      tabs.forEach(t => {
        t.className = "admin-tab-btn px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 bg-slate-900 text-slate-400 hover:text-white border border-slate-800";
      });
      btn.className = "admin-tab-btn active px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 bg-orange-500 text-white shadow";

      const targetTab = btn.dataset.tab;
      document.querySelectorAll(".admin-panel").forEach(p => p.classList.add("hidden"));
      document.getElementById(`panel-${targetTab}`)?.classList.remove("hidden");

      if (targetTab === "participants") loadParticipants();
      if (targetTab === "stats") loadSummary();
      if (targetTab === "backup") loadBackupStatus();
    });
  });
}

async function loadAllAdminData() {
  await Promise.all([
    loadSettings(),
    loadFoodGroups(),
    loadFoodItems(),
    loadParticipants(),
    loadSummary(),
    loadBackupStatus()
  ]);
  setupActionHandlers();
}

async function loadSettings() {
  try {
    const res = await fetch("/api/admin/settings");
    if (!res.ok) return;
    adminSettings = await res.json();

    // Event details
    setValue("setting-header-brand-title", adminSettings.header_brand_title || "EMA Paattukoottam");
    setValue("setting-header-brand-subtitle", adminSettings.header_brand_subtitle || "Musical Night");
    const navTitle = document.getElementById("nav-event-title");
    if (navTitle && adminSettings.header_brand_title) navTitle.textContent = adminSettings.header_brand_title;
    const navSub = document.getElementById("nav-event-subtitle");
    if (navSub && adminSettings.header_brand_subtitle) navSub.textContent = adminSettings.header_brand_subtitle;
    setValue("setting-event-name", adminSettings.event_name);
    setValue("setting-event-subtitle", adminSettings.event_subtitle);
    updateCharCounters();
    setValue("setting-event-date-time", adminSettings.event_start_time || adminSettings.event_date_time);
    setValue("setting-event-time-range", adminSettings.event_time_range);
    setValue("setting-event-venue", adminSettings.event_venue);
    setValue("setting-event-poster-url", adminSettings.event_poster_url);
    setValue("setting-entry-id-prefix", adminSettings.entry_id_prefix);
    setValue("setting-payment-url", adminSettings.payment_url);
    setValue("setting-hero-tag-primary", adminSettings.hero_tag_primary || "Musical Evening");
    setValue("setting-hero-tag-status", adminSettings.hero_tag_status || "Stage Ready");
    setValue("setting-general-notes", adminSettings.general_notes || "");
    setValue("setting-signup-sheet-url", adminSettings.signup_sheet_url);

    // Rules
    setValue("setting-max-perfs", adminSettings.max_performances_per_participant || 2);
    setValue("setting-max-solo", adminSettings.max_solo_per_participant !== undefined ? adminSettings.max_solo_per_participant : 1);

    perfTypes = adminSettings.performance_types || ["Solo", "Duet", "Group"];
    renderPerformanceTypeChips();

    ageGroups = adminSettings.age_groups || [
      { name: "Junior", requires_guardian: true },
      { name: "Senior", requires_guardian: false }
    ];
    renderAgeGroupsTable();

    // Food settings
    setValue("setting-food-serving-note", adminSettings.food_serving_note || "Bring one dish to share");
    updateFoodToggleButton(Boolean(adminSettings.food_signup_enabled !== false));

  } catch (e) {
    console.error("Error loading settings:", e);
  }
}

function setValue(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val !== undefined && val !== null ? val : "";
}

function updateCharCounters() {
  const headerTitleInput = document.getElementById("setting-header-brand-title");
  const headerSubInput = document.getElementById("setting-header-brand-subtitle");
  const headerTitleCount = document.getElementById("header-title-char-count");
  const headerSubCount = document.getElementById("header-subtitle-char-count");

  const titleInput = document.getElementById("setting-event-name");
  const subInput = document.getElementById("setting-event-subtitle");
  const titleCount = document.getElementById("title-char-count");
  const subCount = document.getElementById("subtitle-char-count");

  if (headerTitleInput && headerTitleCount) {
    headerTitleCount.textContent = `${headerTitleInput.value.length}/35`;
  }
  if (headerSubInput && headerSubCount) {
    headerSubCount.textContent = `${headerSubInput.value.length}/45`;
  }
  if (titleInput && titleCount) {
    titleCount.textContent = `${titleInput.value.length}/60`;
  }
  if (subInput && subCount) {
    subCount.textContent = `${subInput.value.length}/80`;
  }
}

function renderPerformanceTypeChips() {
  const container = document.getElementById("types-chips-container");
  if (!container) return;
  container.innerHTML = perfTypes.map((t, idx) => `
    <span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-700 text-xs font-bold text-white shadow-sm">
      <span>${t}</span>
      <button type="button" onclick="removePerfType(${idx})" class="text-slate-400 hover:text-rose-400 ml-1">
        <i data-lucide="x" class="w-3.5 h-3.5"></i>
      </button>
    </span>
  `).join("");
  if (window.lucide) lucide.createIcons();
}

window.removePerfType = function(idx) {
  perfTypes.splice(idx, 1);
  renderPerformanceTypeChips();
};

function renderAgeGroupsTable() {
  const container = document.getElementById("age-groups-table-container");
  if (!container) return;
  container.innerHTML = ageGroups.map((ag, idx) => `
    <div class="flex items-center justify-between p-3 rounded-2xl bg-slate-950/80 border border-slate-800 text-xs">
      <div class="flex items-center gap-2">
        <strong class="text-white font-bold">${ag.name}</strong>
        ${ag.requires_guardian 
          ? '<span class="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[10px] font-bold">Guardian Required</span>' 
          : '<span class="px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 text-[10px] font-semibold">Self-Registration</span>'}
      </div>
      <button type="button" onclick="removeAgeGroup(${idx})" class="text-xs text-rose-400 hover:text-rose-300 font-semibold flex items-center gap-1">
        <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
      </button>
    </div>
  `).join("");
  if (window.lucide) lucide.createIcons();
}

window.removeAgeGroup = function(idx) {
  ageGroups.splice(idx, 1);
  renderAgeGroupsTable();
};

function updateFoodToggleButton(enabled) {
  const btn = document.getElementById("toggle-food-status-btn");
  if (!btn) return;
  if (enabled) {
    btn.className = "w-full py-2 rounded-xl text-xs font-bold border transition flex items-center justify-center gap-2 bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20";
    btn.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span><span>Sign-Up Enabled</span>`;
  } else {
    btn.className = "w-full py-2 rounded-xl text-xs font-bold border transition flex items-center justify-center gap-2 bg-rose-500/10 text-rose-400 border-rose-500/30 hover:bg-rose-500/20";
    btn.innerHTML = `<span class="w-2 h-2 rounded-full bg-rose-500"></span><span>Sign-Up Disabled</span>`;
  }
}

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
          ? `<p class="text-[11px] text-slate-400 mt-1 pl-4">Taken by <strong class="text-orange-400">${item.signer_name}</strong> ${item.dish_description ? `— "${item.dish_description}"` : ''}</p>`
          : '<p class="text-[11px] text-emerald-400/80 mt-1 pl-4">Available for participant claim</p>'}
      </div>
      <div class="flex items-center gap-2">
        <button onclick="editItem('${item.item_id}', '${escapeQuotes(item.name)}')" class="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300" title="Edit"><i data-lucide="edit-3" class="w-3.5 h-3.5"></i></button>
        <button onclick="deleteItem('${item.item_id}', '${escapeQuotes(item.name)}', ${item.is_taken})" class="p-1.5 rounded-lg bg-slate-900 hover:bg-rose-950 text-rose-400" title="Delete"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
      </div>
    </div>
  `).join("");
  if (window.lucide) lucide.createIcons();
}

async function loadSummary() {
  try {
    const res = await fetch("/api/admin/summary");
    if (!res.ok) return;
    const s = await res.json();

    document.getElementById("stat-total-performers").textContent = s.total_participants;
    document.getElementById("stat-total-performances").textContent = s.total_performances;
    document.getElementById("stat-juniors").textContent = s.juniors;
    document.getElementById("stat-seniors").textContent = s.seniors;
    document.getElementById("stat-solo").textContent = s.solo;
    document.getElementById("stat-duet").textContent = s.duet;
    document.getElementById("stat-group").textContent = s.group;

    document.getElementById("stat-food-claimed").textContent = s.food_taken;
    document.getElementById("stat-food-total").textContent = s.food_total;
    const pct = s.food_total > 0 ? Math.round((s.food_taken / s.food_total) * 100) : 0;
    document.getElementById("stat-food-percent").textContent = `${pct}%`;
  } catch (e) {
    console.error("Summary error:", e);
  }
}

async function loadBackupStatus() {
  try {
    const res = await fetch("/api/admin/backup-status");
    if (!res.ok) return;
    const b = await res.json();

    const card = document.getElementById("backup-status-card");
    const last = b.last_backup;

    card.innerHTML = `
      <div class="flex items-center justify-between">
        <span class="font-bold text-white flex items-center gap-2">
          <span class="w-2.5 h-2.5 rounded-full ${b.enabled ? 'bg-emerald-500' : 'bg-slate-600'}"></span>
          <span>Target Google Sheet:</span>
          <code class="text-orange-400">${b.backup_target_sheet}</code>
        </span>
        <span class="text-[11px] font-semibold ${last && last.status === 'success' ? 'text-emerald-400' : 'text-slate-400'}">
          ${last ? `Status: ${last.status.toUpperCase()}` : 'No backups run yet'}
        </span>
      </div>
      <p class="text-slate-400">
        ${last ? `Last snapshot: ${last.completed_at || last.triggered_at} (${last.rows_backed || 0} rows backed up)` : 'Backups trigger automatically on data changes.'}
      </p>
    `;

    const tbody = document.getElementById("backup-history-body");
    const history = b.history || [];
    if (history.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="px-4 py-6 text-center text-slate-500">No backup records found.</td></tr>`;
      return;
    }

    tbody.innerHTML = history.map(h => `
      <tr class="hover:bg-slate-900/50">
        <td class="px-4 py-2 font-mono text-[11px]">${h.completed_at || h.triggered_at}</td>
        <td class="px-4 py-2">
          <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${h.status === 'success' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}">
            ${h.status}
          </span>
        </td>
        <td class="px-4 py-2 font-mono">${h.rows_backed || 0}</td>
        <td class="px-4 py-2 text-slate-400 truncate max-w-xs">${h.error_msg || '—'}</td>
      </tr>
    `).join("");
  } catch (e) {
    console.error("Backup status error:", e);
  }
}

function setupActionHandlers() {
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
      header_brand_title: headerTitleVal || "EMA Paattukoottam",
      header_brand_subtitle: headerSubVal || "Musical Night",
      event_name: titleVal,
      event_subtitle: subVal,
      event_start_time: document.getElementById("setting-event-date-time").value.trim(),
      event_time_range: document.getElementById("setting-event-time-range").value.trim(),
      event_venue: document.getElementById("setting-event-venue").value.trim(),
      event_poster_url: document.getElementById("setting-event-poster-url").value.trim(),
      entry_id_prefix: document.getElementById("setting-entry-id-prefix").value.trim(),
      payment_url: document.getElementById("setting-payment-url").value.trim(),
      hero_tag_primary: document.getElementById("setting-hero-tag-primary") ? document.getElementById("setting-hero-tag-primary").value.trim() : "Musical Evening",
      hero_tag_status: document.getElementById("setting-hero-tag-status") ? document.getElementById("setting-hero-tag-status").value.trim() : "Stage Ready",
      general_notes: document.getElementById("setting-general-notes") ? document.getElementById("setting-general-notes").value.trim() : "",
      signup_sheet_url: document.getElementById("setting-signup-sheet-url").value.trim()
    };
    await updateSettingsApi(payload, "Event Details saved successfully!");
  });

  // Save Rules
  document.getElementById("save-rules-btn")?.addEventListener("click", async () => {
    const payload = {
      max_performances_per_participant: parseInt(document.getElementById("setting-max-perfs").value, 10) || 2,
      max_solo_per_participant: parseInt(document.getElementById("setting-max-solo").value, 10) || 1,
      performance_types: perfTypes,
      age_groups: ageGroups
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
    const guardInput = document.getElementById("new-ag-guardian");
    const name = nameInput.value.trim();
    if (name) {
      ageGroups.push({ name, requires_guardian: guardInput.checked });
      nameInput.value = "";
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
        showToast(`Food sign-up ${newEnabled ? 'enabled' : 'disabled'}!`);
      }
    } catch (e) {
      showToast("Toggle failed", true);
    }
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
        showToast(`Backup complete! ${data.rows_backed} rows saved to Sheet.`);
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

  // Export DB to Sheet Now button
  document.getElementById("sync-sheet-now-btn")?.addEventListener("click", async () => {
    const btn = document.getElementById("sync-sheet-now-btn");
    btn.disabled = true;
    showToast("Exporting local DB to Google Sheet...");
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.status === "success") {
        showToast("Sync success: DB pushed to Google Sheet!");
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
  document.getElementById("participant-search-input")?.addEventListener("input", (e) => {
    renderParticipantsTable(e.target.value.trim().toLowerCase());
  });

  // Modal Cancel / Close buttons
  document.getElementById("close-admin-edit-modal-btn")?.addEventListener("click", closeAdminEditModal);
  document.getElementById("cancel-admin-edit-btn")?.addEventListener("click", closeAdminEditModal);

  // Participant Edit Form Submit
  document.getElementById("admin-edit-participant-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await saveParticipantEdit();
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
      const p = allParticipants.find(item => item.entry_id === entryId);
      const name = p ? p.performer_name : entryId;
      deleteParticipant(entryId, name);
    }
  });
}

async function loadParticipants() {
  const tbody = document.getElementById("participants-table-body");
  if (!tbody) return;
  try {
    const res = await fetch("/api/admin/participants");
    if (!res.ok) {
      tbody.innerHTML = `<tr><td colspan="7" class="px-4 py-8 text-center text-rose-400">Failed to load participants</td></tr>`;
      return;
    }
    allParticipants = await res.json();
    updateParticipantCounters();
    const query = document.getElementById("participant-search-input")?.value.trim().toLowerCase() || "";
    renderParticipantsTable(query);
  } catch (err) {
    console.error("loadParticipants error:", err);
    tbody.innerHTML = `<tr><td colspan="7" class="px-4 py-8 text-center text-rose-400">Error loading participants</td></tr>`;
  }
}

function updateParticipantCounters() {
  const total = allParticipants.length;
  const juniors = allParticipants.filter(p => (p.age_group || "").toLowerCase().includes("junior")).length;
  const seniors = allParticipants.filter(p => (p.age_group || "").toLowerCase().includes("senior")).length;

  const totalEl = document.getElementById("participants-count-total");
  const juniorsEl = document.getElementById("participants-count-juniors");
  const seniorsEl = document.getElementById("participants-count-seniors");

  if (totalEl) totalEl.textContent = total;
  if (juniorsEl) juniorsEl.textContent = juniors;
  if (seniorsEl) seniorsEl.textContent = seniors;
}

function renderParticipantsTable(query = "") {
  const tbody = document.getElementById("participants-table-body");
  if (!tbody) return;

  const filtered = allParticipants.filter(p => {
    if (!query) return true;
    const matchName = (p.performer_name || "").toLowerCase().includes(query);
    const matchGuardian = (p.guardian_name || "").toLowerCase().includes(query);
    const matchSong = (p.song_title || "").toLowerCase().includes(query);
    const matchMovie = (p.movie_name || "").toLowerCase().includes(query);
    const matchId = (p.entry_id || "").toLowerCase().includes(query);
    const matchPhone = (p.phone || "").toLowerCase().includes(query);
    return matchName || matchGuardian || matchSong || matchMovie || matchId || matchPhone;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="px-4 py-8 text-center text-slate-500">No participants found matching criteria.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(p => {
    const isJunior = (p.age_group || "").toLowerCase().includes("junior");
    const ageBadgeClass = isJunior
      ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
      : "bg-blue-500/10 text-blue-400 border border-blue-500/20";

    const trackStatus = p.track_status || "Pending";
    let trackBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-400">${escapeHtml(trackStatus)}</span>`;
    if (trackStatus.toLowerCase() === "uploaded") {
      trackBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Uploaded</span>`;
    } else if (trackStatus.toLowerCase() === "acoustic") {
      trackBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/20">Acoustic</span>`;
    }

    const origin = p.created_via || p.origin || "app";
    const originBadge = origin === "sheet"
      ? `<span class="px-1.5 py-0.5 rounded text-[9px] bg-slate-800 text-slate-400">Sheet</span>`
      : `<span class="px-1.5 py-0.5 rounded text-[9px] bg-orange-500/10 text-orange-400 border border-orange-500/20">App</span>`;

    const seqDisplay = p.sequence_order ? `#${p.sequence_order}` : "-";
    const safeEntryId = escapeHtml(p.entry_id || "");
    const safePerformerName = escapeHtml(p.performer_name || "Unknown");
    const safeAgeGroup = escapeHtml(p.age_group || "Senior");
    const safeGuardianName = escapeHtml(p.guardian_name || "");
    const safePhone = escapeHtml(p.phone || "");
    const safePerfType = escapeHtml(p.performance_type || "Solo");
    const safePartner = escapeHtml(p.partner_name || "");
    const safeSong = p.song_title ? escapeHtml(p.song_title) : '<span class="italic text-slate-500">None</span>';
    const safeMovie = escapeHtml(p.movie_name || "");

    return `
      <tr class="hover:bg-slate-800/40 transition">
        <td class="px-3 py-3 font-mono font-bold text-slate-300">
          <div>${safeEntryId}</div>
          <div class="text-[10px] text-slate-500 font-sans">Seq: <span class="text-orange-400 font-bold">${seqDisplay}</span></div>
        </td>
        <td class="px-3 py-3">
          <div class="font-bold text-white flex items-center gap-1.5">
            <span>${safePerformerName}</span>
            <span class="px-1.5 py-0.2 rounded text-[9px] font-bold uppercase ${ageBadgeClass}">${safeAgeGroup}</span>
          </div>
          ${p.guardian_name ? `<div class="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5"><i data-lucide="shield" class="w-3 h-3 text-slate-500"></i> ${safeGuardianName} ${p.phone ? `<span class="text-slate-500 font-mono text-[10px]">(${safePhone})</span>` : ""}</div>` : (p.phone ? `<div class="text-[10px] text-slate-500 font-mono mt-0.5">${safePhone}</div>` : "")}
        </td>
        <td class="px-3 py-3">
          <span class="font-medium text-slate-300">${safePerfType}</span>
          ${p.partner_name ? `<div class="text-[10px] text-slate-400 truncate max-w-[120px]">+ ${safePartner}</div>` : ""}
        </td>
        <td class="px-3 py-3">
          <div class="font-medium text-white">${safeSong}</div>
          ${p.movie_name ? `<div class="text-[11px] text-slate-400">${safeMovie}</div>` : ""}
        </td>
        <td class="px-3 py-3">${trackBadge}</td>
        <td class="px-3 py-3">${originBadge}</td>
        <td class="px-3 py-3 text-right">
          <div class="flex items-center justify-end gap-1.5">
            <button type="button" data-action="edit-participant" data-entry-id="${safeEntryId}" class="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition" title="Edit Participant">
              <i data-lucide="edit-3" class="w-3.5 h-3.5 pointer-events-none"></i>
            </button>
            <button type="button" data-action="delete-participant" data-entry-id="${safeEntryId}" class="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-900/40 text-slate-400 hover:text-rose-300 transition" title="Delete Participant">
              <i data-lucide="trash-2" class="w-3.5 h-3.5 pointer-events-none"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  if (window.lucide) lucide.createIcons();
}

window.openEditParticipantModal = function(entryId) {
  const p = allParticipants.find(item => item.entry_id === entryId);
  if (!p) {
    showToast("Participant not found", true);
    return;
  }

  document.getElementById("admin-edit-entry-id").value = p.entry_id;
  document.getElementById("admin-edit-entry-id-badge").textContent = p.entry_id;
  document.getElementById("admin-edit-performer-name").value = p.performer_name || "";
  document.getElementById("admin-edit-age-group").value = p.age_group || "Senior";
  document.getElementById("admin-edit-guardian-name").value = p.guardian_name || "";
  document.getElementById("admin-edit-guardian-phone").value = p.phone || "";
  document.getElementById("admin-edit-performance-type").value = p.performance_type || "Solo";
  document.getElementById("admin-edit-partner-name").value = p.partner_name || "";
  document.getElementById("admin-edit-song-title").value = p.song_title || "";
  document.getElementById("admin-edit-movie-name").value = p.movie_name || "";
  document.getElementById("admin-edit-sequence-order").value = p.sequence_order || "";
  document.getElementById("admin-edit-track-status").value = p.track_status || "Pending";
  document.getElementById("admin-edit-performance-status").value = p.performance_status || "Upcoming";
  document.getElementById("admin-edit-stage-notes").value = p.stage_notes || "";

  document.getElementById("admin-edit-participant-modal").classList.remove("hidden");
  if (window.lucide) lucide.createIcons();
};

function closeAdminEditModal() {
  document.getElementById("admin-edit-participant-modal").classList.add("hidden");
}

async function saveParticipantEdit() {
  const entryId = document.getElementById("admin-edit-entry-id").value;
  if (!entryId) return;

  const seqVal = document.getElementById("admin-edit-sequence-order").value;
  const payload = {
    performer_name: document.getElementById("admin-edit-performer-name").value.trim(),
    age_group: document.getElementById("admin-edit-age-group").value,
    guardian_name: document.getElementById("admin-edit-guardian-name").value.trim() || null,
    phone: document.getElementById("admin-edit-guardian-phone").value.trim() || null,
    performance_type: document.getElementById("admin-edit-performance-type").value,
    partner_name: document.getElementById("admin-edit-partner-name").value.trim() || null,
    song_title: document.getElementById("admin-edit-song-title").value.trim() || null,
    movie_name: document.getElementById("admin-edit-movie-name").value.trim() || null,
    sequence_order: seqVal ? parseInt(seqVal, 10) : null,
    track_status: document.getElementById("admin-edit-track-status").value,
    performance_status: document.getElementById("admin-edit-performance-status").value,
    stage_notes: document.getElementById("admin-edit-stage-notes").value.trim() || null
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
      await Promise.all([loadParticipants(), loadSummary()]);
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

window.editItem = async function(itemId, currentName) {
  const newName = prompt("Edit food item name:", currentName);
  if (!newName || newName.trim() === currentName) return;

  try {
    const res = await fetch(`/api/admin/food-items/${itemId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() })
    });
    if (res.ok) {
      await loadFoodItems();
      showToast("Item updated!");
    }
  } catch (e) {
    showToast("Update failed", true);
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

async function updateSettingsApi(settingsObj, successMsg) {
  try {
    const res = await fetch("/api/admin/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settingsObj)
    });
    if (res.ok) {
      showToast(successMsg);
    } else {
      showToast("Failed to save settings", true);
    }
  } catch (e) {
    showToast("Error updating settings", true);
  }
}

function showToast(msg, isError = false) {
  const toast = document.getElementById("admin-toast");
  const text = document.getElementById("admin-toast-text");
  if (!toast) return;

  text.textContent = msg;
  if (isError) {
    toast.className = "p-4 rounded-2xl text-xs font-bold transition flex items-center justify-between bg-rose-500/10 border border-rose-500/30 text-rose-300";
  } else {
    toast.className = "p-4 rounded-2xl text-xs font-bold transition flex items-center justify-between bg-emerald-500/10 border border-emerald-500/30 text-emerald-300";
  }
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 4000);
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[m]);
}
