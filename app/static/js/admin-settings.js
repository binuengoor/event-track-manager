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
// Keep each destination on one line (tests parse this table). "short" is the phone bar label.
const ADMIN_DESTINATIONS = [
  { id: "overview", label: "Overview", short: "Overview", icon: "overview", tabs: ["overview", "stats"] },
  { id: "lineup", label: "Lineup", short: "Lineup", icon: "lineup", tabs: ["lineup"], requires: "stage_performances_enabled" },
  { id: "people", label: "People & Potluck", short: "People", icon: "people", tabs: ["participants", "food", "payments", "sheet"] },
  { id: "setup", label: "Setup & Rules", short: "Setup", icon: "setup", tabs: ["event", "rules", "features"] },
  { id: "system", label: "System", short: "System", icon: "system", tabs: ["system", "backup", "activity"] }
];
window.ADMIN_DESTINATIONS = ADMIN_DESTINATIONS;
let currentAdminTab = "overview";

// Inline icon paths (same drawing set as the design boards); no runtime icon library needed.
const AD_ICONS = {
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  overview: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  lineup: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6M17 5a3.5 3.5 0 0 1 0 7M22 21c0-3-2-5-5-5.7"/>',
  setup: '<path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  system: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  wizard: '<path d="M5 19L19 5M14 5h5v5M5 5h.01M9 3h.01M3 9h.01"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
  swap: '<path d="M4 8h14l-3-3M20 16H6l3 3"/>',
  console: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 15v-4M12 15V9M17 15v-2"/>',
  screen: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>'
};
function adIcon(name, size) {
  const px = size || 20;
  return `<svg width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${AD_ICONS[name] || ""}</svg>`;
}
window.adIcon = adIcon;

function destinationOf(tab) {
  return ADMIN_DESTINATIONS.find(d => d.tabs.includes(tab)) || ADMIN_DESTINATIONS[0];
}

function adminEventName() {
  const raw = (typeof adminSettings !== "undefined" && adminSettings && adminSettings.event_name) || "";
  return window.cleanEventName ? window.cleanEventName(raw) : raw;
}

function paintEventLabels() {
  const name = adminEventName();
  const rail = document.getElementById("admin-rail-event-name");
  if (rail) rail.textContent = name || "No event name yet";
  const eyebrow = document.getElementById("admin-event-eyebrow");
  if (eyebrow) eyebrow.textContent = name;
  const more = document.getElementById("ad-more-event-sub");
  if (more) more.textContent = name ? `${name} is active` : "Switch or create an event";
}

function setAdminPageSub(text) {
  const el = document.getElementById("admin-page-sub");
  if (el) el.textContent = text || "";
}
window.setAdminPageSub = setAdminPageSub;

function renderNavButtons() {
  const dest = (d, label) =>
    `<button type="button" class="admin-dest" data-dest="${d.id}">${adIcon(d.icon, label === d.short ? 24 : 20)}<span>${label}</span></button>`;
  const rail = document.getElementById("admin-rail");
  if (rail) {
    rail.innerHTML =
      `<button type="button" class="ad-rail-event" id="admin-rail-event"><span class="k">ACTIVE EVENT</span><span class="n" id="admin-rail-event-name"></span><span class="h">Switch or create event</span></button>` +
      `<div class="ad-rail-links">${ADMIN_DESTINATIONS.map(d => dest(d, d.label)).join("")}</div>` +
      `<div class="ad-rail-foot">Signed in as Admin</div>`;
    document.getElementById("admin-rail-event")?.addEventListener("click", () => document.getElementById("manage-events-btn")?.click());
  }
  const bar = document.getElementById("admin-bottom-bar");
  if (bar) {
    // Phone: four destinations plus More (System, Activity, downloads, event switch, show links).
    bar.innerHTML = ADMIN_DESTINATIONS.filter(d => d.id !== "system").map(d => dest(d, d.short)).join("") +
      `<button type="button" class="admin-dest" data-dest="more" aria-haspopup="dialog" aria-expanded="false" aria-controls="ad-more-sheet">${adIcon("more", 24)}<span>More</span></button>`;
  }
  document.querySelectorAll(".admin-dest").forEach(btn => {
    if (btn.dataset.dest === "more") { btn.addEventListener("click", () => toggleMoreSheet()); return; }
    btn.addEventListener("click", () => { closeMoreSheet(false); showAdminTab(ADMIN_DESTINATIONS.find(d => d.id === btn.dataset.dest).tabs[0]); });
  });
  paintEventLabels();
}

// ---- phone "More" sheet ----
function moreItems() {
  const go = (tab) => () => showAdminTab(tab);
  const click = (id) => () => document.getElementById(id)?.click();
  return [
    { icon: "wizard", title: "Setup wizard", sub: "Guided setup for this event", run: click("overview-wizard-resume") },
    { icon: "system", title: "System", sub: "Events, snapshots, offline ZIP", run: go("system") },
    { icon: "activity", title: "Activity", sub: "Audit log of changes", run: go("activity") },
    { icon: "download", title: "Downloads", sub: "Spreadsheets and exports", run: go("sheet") },
    { icon: "swap", title: "Switch event", subId: "ad-more-event-sub", sub: "Switch or create an event", run: click("manage-events-btn") },
    { icon: "console", title: "Open Console", sub: "Sound booth view", href: "/console" },
    { icon: "screen", title: "Open Live screen", sub: "Venue screen", href: "/live" },
    { icon: "screen", title: "Open Stage monitor", sub: "Performers' screen", href: "/console/stage-monitor" },
    { icon: "lock", title: "Admin sign out", sub: "Sign out on this device", run: () => {
      fetch("/api/auth/logout", { method: "POST" }).catch(() => {}).then(() => {
        try { localStorage.removeItem("paattukoottam_pin"); } catch (e) {}
        location.reload();
      });
    } }
  ];
}

let moreReturnFocus = null;
function buildMoreSheet() {
  if (document.getElementById("ad-more-sheet")) return;
  const items = moreItems();
  const scrim = document.createElement("div");
  scrim.id = "ad-more-scrim"; scrim.className = "ad-more-scrim"; scrim.hidden = true; scrim.setAttribute("aria-hidden", "true");
  const sheet = document.createElement("div");
  sheet.id = "ad-more-sheet"; sheet.className = "ad-more"; sheet.hidden = true;
  sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-modal", "true"); sheet.setAttribute("aria-label", "More");
  sheet.innerHTML = `<span class="ad-more-grab" aria-hidden="true"></span><p class="ad-more-k">MORE</p>` + items.map((it, i) => {
    const inner = `<span class="ad-more-ico">${adIcon(it.icon, 20)}</span><span class="ad-more-txt"><b>${it.title}</b><small${it.subId ? ` id="${it.subId}"` : ""}>${it.sub}</small></span>` +
      (it.href ? "" : `<span class="ad-more-chev">${adIcon("chevron", 20)}</span>`);
    return it.href
      ? `<a class="ad-more-item" href="${it.href}">${inner}</a>`
      : `<button type="button" class="ad-more-item" data-more="${i}">${inner}</button>`;
  }).join("");
  document.body.appendChild(scrim);
  document.body.appendChild(sheet);
  scrim.addEventListener("click", () => closeMoreSheet(true));
  sheet.querySelectorAll("[data-more]").forEach(b => b.addEventListener("click", () => {
    const run = items[Number(b.dataset.more)].run;
    closeMoreSheet(false);
    if (run) run();
  }));
  sheet.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); closeMoreSheet(true); return; }
    if (e.key !== "Tab") return;
    const f = Array.from(sheet.querySelectorAll("a[href], button")).filter(x => !x.disabled);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  paintEventLabels();
}

function toggleMoreSheet() {
  const sheet = document.getElementById("ad-more-sheet");
  if (sheet && !sheet.hidden) { closeMoreSheet(true); return; }
  buildMoreSheet();
  moreReturnFocus = document.activeElement;
  document.getElementById("ad-more-scrim").hidden = false;
  document.getElementById("ad-more-sheet").hidden = false;
  document.querySelectorAll('.admin-dest[data-dest="more"]').forEach(b => b.setAttribute("aria-expanded", "true"));
  document.querySelector("#ad-more-sheet .ad-more-item")?.focus();
}

function closeMoreSheet(restoreFocus) {
  const sheet = document.getElementById("ad-more-sheet");
  if (!sheet || sheet.hidden) return;
  sheet.hidden = true;
  document.getElementById("ad-more-scrim").hidden = true;
  document.querySelectorAll('.admin-dest[data-dest="more"]').forEach(b => b.setAttribute("aria-expanded", "false"));
  if (restoreFocus && moreReturnFocus && moreReturnFocus.focus) moreReturnFocus.focus();
}

function showAdminTab(targetTab) {
  if (!document.getElementById(`panel-${targetTab}`)) targetTab = "overview";
  const dest = destinationOf(targetTab);
  currentAdminTab = targetTab;

  document.querySelectorAll(".admin-dest").forEach(b => {
    const on = b.dataset.dest === dest.id || (b.dataset.dest === "more" && dest.id === "system");
    if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });

  const title = document.getElementById("admin-page-title");
  if (title) title.textContent = dest.label;
  setAdminPageSub("");

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
  document.addEventListener("etm:settings-loaded", paintEventLabels);
  document.querySelectorAll(".admin-tab-btn").forEach(btn => {
    btn.addEventListener("click", () => showAdminTab(btn.dataset.tab));
  });
  document.getElementById("setting-shorten-junior-names")?.addEventListener("click", (ev) => {
    const el = ev.currentTarget;
    el.setAttribute("aria-checked", el.getAttribute("aria-checked") === "true" ? "false" : "true");
  });
  document.getElementById("setting-edit-verification")?.addEventListener("click", (ev) => {
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
    setValue("setting-header-brand-title", adminSettings.header_brand_title || "");
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
    setValue("setting-doors-open-time", adminSettings.doors_open_time || "");
    setValue("setting-post-event-link-url", adminSettings.post_event_link_url || "");
    setValue("setting-event-passcode", adminSettings.event_passcode || "");
    setValue("setting-event-venue", adminSettings.event_venue);
    setValue("setting-event-poster-url", adminSettings.event_poster_url);
    setValue("setting-entry-id-prefix", adminSettings.entry_id_prefix);
    setValue("setting-payment-url", adminSettings.payment_url);
    setValue("setting-hero-tag-primary", adminSettings.hero_tag_primary || "Musical Evening");
    setValue("setting-hero-tag-status", adminSettings.hero_tag_status || "Stage Ready");
    setValue("setting-general-notes", adminSettings.general_notes || "");
    setValue("setting-external-link-url", adminSettings.external_link_url);

    // Rules
    setValue("setting-max-perfs", adminSettings.max_performances_per_participant || 2);
    setValue("setting-max-solo", adminSettings.max_solo_per_participant !== undefined ? adminSettings.max_solo_per_participant : 1);
    setValue("setting-max-audio-mb", adminSettings.max_audio_upload_mb ?? 200);
    setValue("setting-max-video-mb", adminSettings.max_video_upload_mb ?? 500);
    setSwitch("setting-shorten-junior-names", adminSettings.shorten_junior_names !== false);
    setSwitch("setting-edit-verification", !!adminSettings.edit_verification_enabled);

    perfTypes = adminSettings.performance_types || ["Solo", "Duet", "Group"];
    renderPerformanceTypeChips();

    ageGroups = normalizeAgeGroups(adminSettings.age_groups || [
      { name: "Junior", requires_guardian: true },
      { name: "Senior", requires_guardian: false }
    ]);
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
    <span class="as-chip">
      <span>${t}</span>
      <button type="button" onclick="removePerfType(${idx})" aria-label="Remove performance type ${String(t).replace(/"/g, '&quot;')}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </span>
  `).join("");
  if (window.lucide) lucide.createIcons();
}

window.removePerfType = function(idx) {
  perfTypes.splice(idx, 1);
  renderPerformanceTypeChips();
};

function normalizeAgeGroups(groups) {
  if (!Array.isArray(groups)) return [];
  return groups.map((group) => {
    const value = typeof group === "string" ? { name: group } : (group || {});
    const name = typeof value.name === "string" ? value.name.trim() : "";
    return {
      name,
      description: typeof value.description === "string" ? value.description : "",
      requires_guardian: typeof value.requires_guardian === "boolean" ? value.requires_guardian : false
    };
  }).filter((group) => group.name);
}

function renderAgeGroupsTable() {
  const container = document.getElementById("age-groups-table-container");
  if (!container) return;
  ageGroups = normalizeAgeGroups(ageGroups);
  if (!container.ageGroupHandlersBound) {
    const updateGroup = (event) => {
      const input = event.target;
      const index = Number(input.dataset && input.dataset.ageGroupIndex);
      const field = input.dataset && input.dataset.ageGroupField;
      if (!Number.isInteger(index) || !ageGroups[index] || !["name", "description", "requires_guardian"].includes(field)) return;
      ageGroups[index][field] = field === "requires_guardian" ? Boolean(input.checked) : input.value;
    };
    container.addEventListener("input", updateGroup);
    container.addEventListener("change", updateGroup);
    container.ageGroupHandlersBound = true;
  }
  container.innerHTML = ageGroups.map((ag, idx) => `
    <div class="as-age-group-row">
      <label class="as-age-group-field"><span class="as-label">Name</span>
        <input type="text" class="as-input" data-age-group-index="${idx}" data-age-group-field="name" value="${escapeHtml(ag.name)}" aria-label="Age group ${escapeHtml(ag.name)} name">
      </label>
      <label class="as-age-group-field"><span class="as-label">Description</span>
        <textarea class="as-textarea" rows="2" maxlength="200" data-age-group-index="${idx}" data-age-group-field="description" aria-label="Age group ${escapeHtml(ag.name)} description">${escapeHtml(ag.description)}</textarea>
      </label>
      <div class="as-age-group-guardian"><label class="as-checkline"><input type="checkbox" role="switch" data-age-group-index="${idx}" data-age-group-field="requires_guardian" aria-label="${escapeHtml(ag.name)} requires a guardian" ${ag.requires_guardian ? "checked" : ""}><span>Requires guardian</span></label></div>
      <button type="button" onclick="removeAgeGroup(${idx})" aria-label="Remove age group ${escapeHtml(ag.name)}" class="as-btn-icon">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
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
    btn.className = "as-status-btn open";
    btn.innerHTML = `<span class="dot" aria-hidden="true"></span><span>Sign-Ups Open</span>`;
  } else {
    btn.className = "as-status-btn closed";
    btn.innerHTML = `<span class="dot" aria-hidden="true"></span><span>Sign-Ups Closed</span>`;
  }
}

function updateFoodToggleButton(enabled) {
  const btn = document.getElementById("toggle-food-status-btn");
  if (!btn) return;
  if (enabled) {
    btn.className = "ap-status ap-status-on";
    btn.innerHTML = `<span class="ap-dot ap-dot-ok"></span><span>Sign-Up Enabled</span>`;
  } else {
    btn.className = "ap-status ap-status-off";
    btn.innerHTML = `<span class="ap-dot ap-dot-danger"></span><span>Sign-Up Disabled</span>`;
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
