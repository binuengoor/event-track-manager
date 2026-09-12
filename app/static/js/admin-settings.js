let adminSettings = {};
let foodGroups = [];
let foodItems = [];
let perfTypes = [];
let ageGroups = [];
let allParticipants = [];
let groupedParticipants = [];
let activeCategoryFilter = "all";
let currentSort = { column: "seq", direction: "asc" };

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

    // Sign-Up & Food settings
    updateSignupToggleButton(Boolean(adminSettings.signup_enabled !== false));
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

function updateSignupToggleButton(enabled) {
  const btn = document.getElementById("toggle-signup-status-btn");
  if (!btn) return;
  if (enabled) {
    btn.className = "w-full sm:w-auto px-4 py-2 rounded-xl text-xs font-bold border transition flex items-center justify-center gap-2 bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20";
    btn.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span><span>Sign-Ups Open</span>`;
  } else {
    btn.className = "w-full sm:w-auto px-4 py-2 rounded-xl text-xs font-bold border transition flex items-center justify-center gap-2 bg-rose-500/10 text-rose-400 border-rose-500/30 hover:bg-rose-500/20";
    btn.innerHTML = `<span class="w-2 h-2 rounded-full bg-rose-500"></span><span>Sign-Ups Closed</span>`;
  }
}

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

function switchToTab(targetTab) {
  const btn = document.querySelector(`.admin-tab-btn[data-tab="${targetTab}"]`);
  if (btn) btn.click();
}

function updateSortIndicators() {
  ["seq", "name", "acts", "tracks", "food"].forEach(key => {
    const el = document.getElementById(`sort-indicator-${key}`);
    if (!el) return;
    if (currentSort.column === key) {
      el.textContent = currentSort.direction === "asc" ? "▲" : "▼";
      el.className = "text-orange-400 font-mono text-xs font-bold";
    } else {
      el.textContent = "↕";
      el.className = "text-slate-600 font-mono text-xs";
    }
  });
}

function setCategoryFilter(filter) {
  activeCategoryFilter = filter;
  document.querySelectorAll(".part-filter-pill").forEach(pill => {
    const f = pill.dataset.filter;
    if (f === filter) {
      pill.className = "part-filter-pill px-3 py-1.5 rounded-lg text-xs font-bold transition bg-orange-500 text-white shadow";
    } else {
      pill.className = "part-filter-pill px-3 py-1.5 rounded-lg text-xs font-bold transition text-slate-400 hover:text-white";
    }
  });
  renderParticipantsTable();
}

function groupPerformancesByParticipant(performances) {
  const map = new Map();

  performances.forEach(perf => {
    const normName = (perf.performer_name || "").trim();
    if (!normName) return;
    const key = normName.toLowerCase();

    if (!map.has(key)) {
      map.set(key, {
        performer_name: normName,
        age_group: perf.age_group || "Senior",
        guardian_name: perf.guardian_name || "",
        guardian_phone: perf.guardian_phone || perf.phone || "",
        contact_info: perf.contact_info || "",
        food_signup: perf.food_signup || null,
        performances: [],
        min_seq: (perf.sequence_order && perf.sequence_order > 0) ? perf.sequence_order : 9999,
        seq_list: []
      });
    }

    const p = map.get(key);
    p.performances.push(perf);
    if (perf.sequence_order && perf.sequence_order > 0) {
      p.seq_list.push(perf.sequence_order);
      if (perf.sequence_order < p.min_seq) {
        p.min_seq = perf.sequence_order;
      }
    }
    if (!p.guardian_name && perf.guardian_name) p.guardian_name = perf.guardian_name;
    if (!p.guardian_phone && (perf.guardian_phone || perf.phone)) p.guardian_phone = perf.guardian_phone || perf.phone;
    if (!p.food_signup && perf.food_signup) p.food_signup = perf.food_signup;
  });

  return Array.from(map.values()).map(p => {
    const total = p.performances.length;
    const readyCount = p.performances.filter(perf => {
      const st = (perf.track_status || "").toLowerCase();
      return st === "uploaded" || st === "acoustic";
    }).length;
    const acousticCount = p.performances.filter(perf => (perf.track_status || "").toLowerCase() === "acoustic").length;
    const uploadedCount = p.performances.filter(perf => (perf.track_status || "").toLowerCase() === "uploaded").length;

    return {
      ...p,
      totalActs: total,
      readyCount,
      acousticCount,
      uploadedCount
    };
  });
}

async function loadParticipants() {
  const tbody = document.getElementById("participants-table-body");
  if (!tbody) return;
  try {
    const res = await fetch("/api/admin/participants");
    if (!res.ok) {
      tbody.innerHTML = `<tr><td colspan="6" class="px-4 py-8 text-center text-rose-400">Failed to load participants</td></tr>`;
      return;
    }
    allParticipants = await res.json();
    groupedParticipants = groupPerformancesByParticipant(allParticipants);
    updateParticipantCounters();
    renderParticipantsTable();
  } catch (err) {
    console.error("loadParticipants error:", err);
    tbody.innerHTML = `<tr><td colspan="6" class="px-4 py-8 text-center text-rose-400">Error loading participants</td></tr>`;
  }
}

function updateParticipantCounters() {
  const total = groupedParticipants.length;
  const juniors = groupedParticipants.filter(p => (p.age_group || "").toLowerCase().includes("junior")).length;
  const seniors = groupedParticipants.filter(p => (p.age_group || "").toLowerCase().includes("senior")).length;

  const totalEl = document.getElementById("participants-count-total");
  const juniorsEl = document.getElementById("participants-count-juniors");
  const seniorsEl = document.getElementById("participants-count-seniors");

  if (totalEl) totalEl.textContent = total;
  if (juniorsEl) juniorsEl.textContent = juniors;
  if (seniorsEl) seniorsEl.textContent = seniors;
}

function renderParticipantsTable() {
  const tbody = document.getElementById("participants-table-body");
  if (!tbody) return;

  const query = document.getElementById("participant-search-input")?.value.trim().toLowerCase() || "";

  let list = groupedParticipants.filter(p => {
    // Category filter: all / junior / senior
    const isJunior = (p.age_group || "").toLowerCase().includes("junior");
    if (activeCategoryFilter === "junior" && !isJunior) return false;
    if (activeCategoryFilter === "senior" && isJunior) return false;

    // Query search filter
    if (!query) return true;
    const matchName = p.performer_name.toLowerCase().includes(query);
    const matchGuardian = (p.guardian_name || "").toLowerCase().includes(query);
    const matchPhone = (p.guardian_phone || "").toLowerCase().includes(query);
    const matchFood = p.food_signup ? (p.food_signup.item_name || "").toLowerCase().includes(query) || (p.food_signup.dish_description || "").toLowerCase().includes(query) : false;
    const matchSong = p.performances.some(perf => 
      (perf.song_title || "").toLowerCase().includes(query) || 
      (perf.movie_name || "").toLowerCase().includes(query) ||
      (perf.entry_id || "").toLowerCase().includes(query) ||
      (perf.partner_name || "").toLowerCase().includes(query)
    );

    return matchName || matchGuardian || matchPhone || matchFood || matchSong;
  });

  // Apply sorting
  list.sort((a, b) => {
    let cmp = 0;
    if (currentSort.column === "seq") {
      cmp = a.min_seq - b.min_seq;
    } else if (currentSort.column === "name") {
      cmp = a.performer_name.localeCompare(b.performer_name);
    } else if (currentSort.column === "acts") {
      cmp = a.totalActs - b.totalActs;
    } else if (currentSort.column === "tracks") {
      const ratioA = a.totalActs > 0 ? (a.readyCount / a.totalActs) : 0;
      const ratioB = b.totalActs > 0 ? (b.readyCount / b.totalActs) : 0;
      cmp = ratioA - ratioB;
    } else if (currentSort.column === "food") {
      const hasFoodA = a.food_signup ? 1 : 0;
      const hasFoodB = b.food_signup ? 1 : 0;
      cmp = hasFoodA - hasFoodB;
      if (cmp === 0 && a.food_signup && b.food_signup) {
        cmp = (a.food_signup.item_name || "").localeCompare(b.food_signup.item_name || "");
      }
    }
    return currentSort.direction === "asc" ? cmp : -cmp;
  });

  updateSortIndicators();

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="px-4 py-8 text-center text-slate-500">No participants found matching criteria.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(p => {
    const isJunior = (p.age_group || "").toLowerCase().includes("junior");
    const ageBadgeClass = isJunior
      ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
      : "bg-blue-500/10 text-blue-400 border border-blue-500/20";

    // Seq display
    const seqDisplay = p.seq_list.length > 0 
      ? p.seq_list.sort((a, b) => a - b).map(s => `<span class="font-bold text-orange-400">#${s}</span>`).join(", ")
      : `<span class="text-slate-500">-</span>`;

    // Track status display
    let trackStatusHtml = "";
    if (p.readyCount === p.totalActs && p.totalActs > 0) {
      if (p.acousticCount === p.totalActs) {
        trackStatusHtml = `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-purple-500/15 text-purple-300 border border-purple-500/30"><i data-lucide="guitar" class="w-3 h-3"></i><span>${p.totalActs}/${p.totalActs} Acoustic</span></span>`;
      } else {
        trackStatusHtml = `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"><i data-lucide="check-circle" class="w-3 h-3"></i><span>${p.totalActs}/${p.totalActs} Ready</span></span>`;
      }
    } else if (p.readyCount > 0) {
      trackStatusHtml = `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30"><i data-lucide="clock" class="w-3 h-3"></i><span>${p.readyCount}/${p.totalActs} Ready</span></span>`;
    } else {
      trackStatusHtml = `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700"><i data-lucide="alert-circle" class="w-3 h-3"></i><span>0/${p.totalActs} Pending</span></span>`;
    }

    // Food sign-up display
    let foodHtml = "";
    if (p.food_signup) {
      foodHtml = `
        <div class="space-y-0.5">
          <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-bold text-[10px]">
            <i data-lucide="utensils" class="w-3 h-3"></i>
            <span>${escapeHtml(p.food_signup.item_name)}</span>
          </span>
          ${p.food_signup.dish_description ? `<div class="text-[10px] text-slate-400 truncate max-w-[140px] pl-1" title="${escapeHtml(p.food_signup.dish_description)}">${escapeHtml(p.food_signup.dish_description)}</div>` : ''}
        </div>
      `;
    } else {
      foodHtml = `
        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-800/80 text-slate-500 text-[10px]">
          <i data-lucide="minus-circle" class="w-3 h-3"></i>
          <span>None</span>
        </span>
      `;
    }

    // Acts list with individual Edit / Delete actions
    const actsHtml = `
      <div class="space-y-1.5">
        <div class="text-[11px] font-bold text-white flex items-center gap-1.5">
          <span>${p.totalActs} ${p.totalActs === 1 ? 'Act' : 'Acts'}</span>
        </div>
        <div class="space-y-1 text-[10px]">
          ${p.performances.map((perf, idx) => `
            <div class="flex items-center justify-between gap-1.5 p-1 rounded bg-slate-900/60 border border-slate-800/60">
              <div class="truncate max-w-[160px]">
                <span class="font-bold text-orange-400">${escapeHtml(perf.performance_type || 'Solo')}</span>: 
                <span class="text-slate-300 font-medium">${perf.song_title ? escapeHtml(perf.song_title) : '<span class="italic text-slate-500">No song</span>'}</span>
                ${perf.partner_name ? `<span class="text-[9px] text-amber-300 block truncate">+ ${escapeHtml(perf.partner_name)}</span>` : ''}
              </div>
              <div class="flex items-center gap-0.5 shrink-0">
                <button type="button" data-action="edit-participant" data-entry-id="${escapeHtml(perf.entry_id)}" class="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition" title="Edit ${escapeHtml(perf.entry_id)}">
                  <i data-lucide="edit-3" class="w-3 h-3 pointer-events-none"></i>
                </button>
                <button type="button" data-action="delete-participant" data-entry-id="${escapeHtml(perf.entry_id)}" data-name="${escapeHtml(p.performer_name)}" class="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition" title="Delete ${escapeHtml(perf.entry_id)}">
                  <i data-lucide="trash-2" class="w-3 h-3 pointer-events-none"></i>
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    return `
      <tr class="hover:bg-slate-800/30 transition">
        <td class="px-3.5 py-3 font-mono text-xs">
          ${seqDisplay}
        </td>
        <td class="px-3.5 py-3">
          <div class="font-bold text-white flex items-center gap-1.5">
            <span>${escapeHtml(p.performer_name)}</span>
            <span class="px-1.5 py-0.2 rounded text-[9px] font-bold uppercase ${ageBadgeClass}">${escapeHtml(p.age_group)}</span>
          </div>
          ${p.guardian_name ? `
            <div class="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
              <i data-lucide="shield" class="w-3 h-3 text-slate-500"></i>
              <span>${escapeHtml(p.guardian_name)}</span>
              ${p.guardian_phone ? `<span class="text-slate-500 font-mono text-[10px]">(${escapeHtml(p.guardian_phone)})</span>` : ''}
            </div>
          ` : (p.guardian_phone ? `<div class="text-[10px] text-slate-500 font-mono mt-0.5">${escapeHtml(p.guardian_phone)}</div>` : '')}
        </td>
        <td class="px-3.5 py-3">
          ${actsHtml}
        </td>
        <td class="px-3.5 py-3">
          ${trackStatusHtml}
        </td>
        <td class="px-3.5 py-3">
          ${foodHtml}
        </td>
        <td class="px-3.5 py-3 text-right">
          <a href="/performer?name=${encodeURIComponent(p.performer_name)}" target="_blank" class="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-slate-800 hover:bg-orange-500/20 text-slate-300 hover:text-orange-400 border border-slate-700/60 font-semibold transition text-[11px]" title="Open Performer Hub">
            <span>Hub</span>
            <i data-lucide="external-link" class="w-3 h-3"></i>
          </a>
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
  document.getElementById("admin-edit-partner-age-group").value = p.partner_age_group || "";
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
    partner_age_group: document.getElementById("admin-edit-partner-age-group").value || null,
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
