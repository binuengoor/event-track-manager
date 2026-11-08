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

function loginErrorMessage(res, data) {
  if (res.status === 429) {
    const header = parseInt(res.headers.get("Retry-After") || "", 10);
    const secs = (data && Number.isFinite(Number(data.retry_after)) && Number(data.retry_after) > 0) ? Number(data.retry_after) : (header > 0 ? header : 60);
    const mins = Math.max(1, Math.ceil(secs / 60));
    return `Too many attempts, try again in ${mins} min`;
  }
  if (res.status === 401 || res.status === 403) return "That PIN is not right. Check it and try again.";
  return `The server had a problem (error ${res.status}). Try again in a moment.`;
}
window.loginErrorMessage = loginErrorMessage;

function setupPinAuth() {
  const pinForm = document.getElementById("pin-form");
  const pinInput = document.getElementById("pin-input");
  const pinError = document.getElementById("pin-error");
  const showError = (msg) => { pinError.textContent = msg; pinError.classList.remove("hidden"); };

  document.getElementById("pin-go-admin")?.addEventListener("click", async () => {
    document.getElementById("pin-modal").classList.add("hidden");
    document.getElementById("auth-status-badge")?.classList.remove("hidden");
    await loadAllAdminData();
  });

  pinForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    pinError.classList.add("hidden");
    const pin = pinInput.value.trim();
    if (!pin) return;

    let res;
    try {
      res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin })
      });
    } catch (err) {
      showError("Cannot reach the server. Check your connection and try again.");
      return;
    }
    let data = {};
    try { data = await res.json(); } catch (err) { /* no body */ }
    if (!res.ok) { showError(loginErrorMessage(res, data)); return; }
    if (data.role && data.role !== "admin") { showError("This PIN only opens the sound console. Use the Admin PIN here."); return; }

    pinInput.value = "";
    pinForm.classList.add("hidden");
    document.getElementById("pin-success")?.classList.remove("hidden");
    document.getElementById("pin-go-admin")?.focus();
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

// Five destinations, each grouping some of the original ten tabs (kept as sub-sections).
const ADMIN_DESTINATIONS = [
  { id: "overview", label: "Overview", icon: "layout-dashboard", tabs: ["overview", "stats"] },
  { id: "lineup", label: "Lineup", icon: "list-ordered", tabs: ["lineup"], requires: "stage_performances_enabled" },
  { id: "people", label: "People & Food", icon: "users", tabs: ["participants", "food", "payments", "sheet"] },
  { id: "setup", label: "Setup & Rules", icon: "sliders", tabs: ["event", "rules", "features"] },
  { id: "system", label: "System", icon: "server", tabs: ["system", "backup", "activity"] }
];
window.ADMIN_DESTINATIONS = ADMIN_DESTINATIONS;
let currentAdminTab = "overview";

function destinationOf(tab) {
  return ADMIN_DESTINATIONS.find(d => d.tabs.includes(tab)) || ADMIN_DESTINATIONS[0];
}

function renderNavButtons() {
  ["admin-rail", "admin-bottom-bar"].forEach(id => {
    const nav = document.getElementById(id);
    if (!nav) return;
    nav.innerHTML = ADMIN_DESTINATIONS.map(d =>
      `<button type="button" class="admin-dest" data-dest="${d.id}"><i data-lucide="${d.icon}" class="w-4 h-4" aria-hidden="true"></i><span>${d.label}</span></button>`
    ).join("");
    nav.querySelectorAll(".admin-dest").forEach(btn => {
      btn.addEventListener("click", () => showAdminTab(ADMIN_DESTINATIONS.find(d => d.id === btn.dataset.dest).tabs[0]));
    });
  });
}

function showAdminTab(targetTab) {
  if (!document.getElementById(`panel-${targetTab}`)) targetTab = "overview";
  const dest = destinationOf(targetTab);
  currentAdminTab = targetTab;

  document.querySelectorAll(".admin-dest").forEach(b => {
    if (b.dataset.dest === dest.id) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });

  const bar = document.getElementById("admin-subtabs");
  let visible = 0;
  document.querySelectorAll(".admin-tab-btn").forEach(btn => {
    const inDest = btn.dataset.dest === dest.id;
    btn.hidden = !inDest;
    if (inDest && !btn.classList.contains("hidden")) visible++;
    if (btn.dataset.tab === targetTab) { btn.setAttribute("aria-current", "page"); btn.classList.add("active"); }
    else { btn.removeAttribute("aria-current"); btn.classList.remove("active"); }
  });
  if (bar) bar.hidden = visible <= 1;

  document.querySelectorAll(".admin-panel").forEach(p => p.classList.add("hidden"));
  document.getElementById(`panel-${targetTab}`)?.classList.remove("hidden");

  if (targetTab === "participants") loadParticipants();
  if (targetTab === "stats") loadSummary();
  if (targetTab === "backup") loadBackupStatus();
  if (targetTab === "activity") loadActivityLogs();
  try { history.replaceState(null, "", `#${targetTab}`); } catch (e) { /* ignore */ }
  document.dispatchEvent(new CustomEvent("etm:admin-tab", { detail: { tab: targetTab, dest: dest.id } }));
}
window.showAdminTab = showAdminTab;

function updateDestinationAvailability() {
  const lineupOn = adminSettings.stage_performances_enabled !== false;
  document.querySelectorAll('.admin-dest[data-dest="lineup"]').forEach(b => { b.hidden = !lineupOn; });
  if (!lineupOn && currentAdminTab === "lineup") showAdminTab("overview");
}

function setupTabs() {
  renderNavButtons();
  if (window.lucide) lucide.createIcons();
  document.querySelectorAll(".admin-tab-btn").forEach(btn => {
    btn.addEventListener("click", () => showAdminTab(btn.dataset.tab));
  });
  document.getElementById("setting-shorten-junior-names")?.addEventListener("click", (ev) => {
    const el = ev.currentTarget;
    el.setAttribute("aria-checked", el.getAttribute("aria-checked") === "true" ? "false" : "true");
  });

  document.querySelectorAll("[data-goto]").forEach(el => el.addEventListener("click", () => showAdminTab(el.dataset.goto)));
  const initial = (location.hash || "").replace("#", "");
  showAdminTab(document.getElementById(`panel-${initial}`) ? initial : "overview");
}

async function loadAllAdminData() {
  await Promise.all([
    loadSettings(),
    loadFoodGroups(),
    loadFoodItems(),
    loadParticipants(),
    loadSummary(),
    loadBackupStatus(),
    loadActivityLogs()
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
    setValue("setting-max-audio-mb", adminSettings.max_audio_upload_mb ?? 200);
    setValue("setting-max-video-mb", adminSettings.max_video_upload_mb ?? 500);
    setSwitch("setting-shorten-junior-names", adminSettings.shorten_junior_names !== false);

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
    renderFeatureToggles();
    updateDestinationAvailability();
    document.dispatchEvent(new CustomEvent("etm:settings-loaded"));

  } catch (e) {
    console.error("Error loading settings:", e);
  }
}

function setSwitch(id, on) {
  const el = document.getElementById(id);
  if (el) el.setAttribute("aria-checked", on ? "true" : "false");
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
