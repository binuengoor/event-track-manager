// Schedule: running order (Lineup) and food board (Food) as a segmented switch.
// The public payload carries sequence_order and status (upcoming | now | done) only; no age group or track state.
const NAME_KEY = "etm_guest_name";
const CACHE_KEY = "etm_schedule_cache";

let performancesData = [];
let foodData = null;
let activeTab = "songs";
let eventInfo = {};
let lineupFromCache = false;

const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", async () => {
  if (window.lucide) lucide.createIcons();
  setupTabs();
  setupFilters();
  window.addEventListener("offline", () => showOffline(true));
  window.addEventListener("online", () => refreshAll());
  await loadEventInfo();
  await refreshAll();
  applyDeepLink();
});

function myName() {
  try { return (localStorage.getItem(NAME_KEY) || "").trim().toLowerCase(); } catch (_) { return ""; }
}

async function refreshAll() {
  await Promise.all([loadPerformances(), loadFood()]);
}

// ---------------------------------------------------------------------------------------------- event info and tabs
async function loadEventInfo() {
  try {
    const res = await fetch("/api/event-info");
    if (!res.ok) return;
    eventInfo = await res.json();
    if (eventInfo.header_brand_title) {
      const titleEl = $("nav-event-title");
      if (titleEl) titleEl.textContent = eventInfo.header_brand_title;
      document.title = `${eventInfo.stage_performances_enabled === false ? "Food board" : "Schedule"} - ${eventInfo.header_brand_title}`;
    }
    if (eventInfo.header_brand_subtitle) {
      const subEl = $("nav-event-subtitle");
      if (subEl) subEl.textContent = eventInfo.header_brand_subtitle;
    }
    const stage = eventInfo.stage_performances_enabled !== false;
    const food = eventInfo.food_signup_enabled !== false;
    const title = $("dashboard-header-title");
    const desc = $("dashboard-header-desc");
    const seg = $("dashboard-tabs-container");

    if (!stage && food) {
      title.textContent = "Food board";
      desc.textContent = "Dishes people are bringing and the slots still open.";
      seg.hidden = true;
      selectTab("food");
    } else if (stage && !food) {
      title.textContent = "Schedule";
      desc.textContent = "The running order for the show.";
      seg.hidden = true;
      selectTab("songs");
    } else if (stage && food && eventInfo.dashboard_enabled === false) {
      selectTab("food");
    }
    window.adaptNavigationForEventConfig?.(eventInfo);
  } catch (e) {
    console.warn("Could not load event info:", e);
  }
}

function selectTab(tab) {
  activeTab = tab;
  const songsBtn = $("tab-songs-btn");
  const foodBtn = $("tab-food-btn");
  songsBtn.setAttribute("aria-pressed", String(tab === "songs"));
  foodBtn.setAttribute("aria-pressed", String(tab === "food"));
  $("section-songs").hidden = tab !== "songs";
  $("section-food").hidden = tab !== "food";
}

function setupTabs() {
  $("tab-songs-btn").addEventListener("click", () => selectTab("songs"));
  $("tab-food-btn").addEventListener("click", () => selectTab("food"));
  $("refresh-dashboard-btn")?.addEventListener("click", refreshAll);
}

function applyDeepLink() {
  const view = new URLSearchParams(location.search).get("view");
  if (view === "food" || view === "potluck") selectTab("food");
}

function setupFilters() {
  $("song-search-input")?.addEventListener("input", renderLineup);
  $("type-filter-select")?.addEventListener("change", renderLineup);
}

// ---------------------------------------------------------------------------------------------- offline banner and cache
function formatClock(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function showOffline(on, ts) {
  const banner = $("offline-banner");
  if (!banner) return;
  if (on) {
    let stamp = ts;
    if (!stamp) {
      try { stamp = (JSON.parse(localStorage.getItem(CACHE_KEY) || "null") || {}).savedAt; } catch (_) { stamp = null; }
    }
    $("offline-time").textContent = stamp ? formatClock(stamp) : "your last visit";
  }
  banner.hidden = !on;
}

function saveCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), performances: performancesData, food: foodData }));
  } catch (_) { /* storage full or private mode */ }
}

function loadCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "null"); } catch (_) { return null; }
}

// ---------------------------------------------------------------------------------------------- lineup
function sequenceOf(p) {
  const n = Number(p.sequence_order);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Running order: scheduled acts by sequence_order, unscheduled last (by name). One row per act; partners stay together.
function sortedActs(list) {
  return list.slice().sort((a, b) => {
    const sa = sequenceOf(a);
    const sb = sequenceOf(b);
    if (sa !== null && sb !== null) return sa - sb || String(a.entry_id).localeCompare(String(b.entry_id));
    if (sa !== null) return -1;
    if (sb !== null) return 1;
    return String(a.performer_name || "").localeCompare(String(b.performer_name || ""));
  });
}

async function loadPerformances() {
  if (eventInfo.stage_performances_enabled === false) return;
  try {
    const res = await fetch("/api/dashboard/performances");
    if (!res.ok) throw new Error("Failed to fetch performances");
    performancesData = await res.json();
    window.auroraEffect?.setActive(true, 1200);
    lineupFromCache = false;
    showOffline(false);
    saveCache();
  } catch (err) {
    console.error("Performances error:", err);
    const cached = loadCache();
    if (cached && Array.isArray(cached.performances)) {
      performancesData = cached.performances;
      lineupFromCache = true;
      showOffline(true, cached.savedAt);
    } else {
      $("lineup-list").innerHTML = '<li class="gf-muted" style="padding:1.5rem;text-align:center">Could not load the lineup. Check your connection and tap Refresh.</li>';
      showOffline(!navigator.onLine);
      return;
    }
  }

  if (eventInfo.dashboard_enabled === false) {
    $("songs-count-badge").textContent = "Locked";
    $("lineup-list").innerHTML = '<li class="gf-muted" style="padding:1.5rem;text-align:center">The lineup is private for this event and stays hidden until stage time.</li>';
    return;
  }
  $("songs-count-badge").textContent = performancesData.length;
  renderLineup();
}

function hasRealTitle(t) {
  const v = String(t || "").trim();
  return Boolean(v) && !/song title missing|^(performance|song)\s*#?\d*$|^(tbd|tba)$/i.test(v);
}

function singers(p) {
  const partner = (p.partner_name || "").trim();
  const name = (p.performer_name || "").trim();
  if (!partner || partner.toLowerCase() === name.toLowerCase()) return name;
  return `${name} & ${partner}`;
}

function renderLineup() {
  const list = $("lineup-list");
  const query = ($("song-search-input")?.value || "").trim().toLowerCase();
  const typeFilter = ($("type-filter-select")?.value || "").toLowerCase();
  const me = myName();

  const filtered = sortedActs(performancesData).filter((p) => {
    const hay = [p.performer_name, p.partner_name, p.song_title, p.movie_name].join(" ").toLowerCase();
    return (!query || hay.includes(query)) && (!typeFilter || String(p.performance_type || "").toLowerCase().includes(typeFilter));
  });

  list.innerHTML = "";
  if (!filtered.length) {
    const li = document.createElement("li");
    li.className = "gf-muted";
    li.style.cssText = "padding:1.5rem;text-align:center";
    li.textContent = performancesData.length ? "No acts match your search." : "No acts are scheduled yet.";
    list.appendChild(li);
    return;
  }

  let laterShown = false;
  filtered.forEach((p) => {
    const seq = sequenceOf(p);
    const status = p.status === "now" || p.status === "done" ? p.status : "upcoming";
    const li = document.createElement("li");
    li.className = "gf-act" + (status === "now" ? " is-now" : status === "done" ? " is-done" : "");

    const num = document.createElement("span");
    num.className = "gf-act-num";
    num.textContent = seq !== null ? String(seq).padStart(2, "0") : "--";

    const body = document.createElement("div");
    const title = document.createElement("div");
    title.className = "gf-act-title";
    title.textContent = hasRealTitle(p.song_title) ? p.song_title : "Song to be announced";
    const sub = document.createElement("div");
    sub.className = "gf-act-sub";
    sub.textContent = `${singers(p)} · ${p.performance_type || "Solo"}`;
    if (p.movie_name) sub.textContent += ` · ${p.movie_name}`;
    body.append(title, sub);
    if (me && String(p.performer_name || "").trim().toLowerCase() === me) {
      const a = document.createElement("a");
      a.href = `/my-entry?name=${encodeURIComponent(p.performer_name)}`;
      a.textContent = " Yours: open my entry";
      a.className = "gf-act-sub";
      sub.appendChild(document.createElement("br"));
      sub.appendChild(a);
    }

    const tag = document.createElement("span");
    if (status === "now") { tag.className = "gf-act-tag"; tag.textContent = "On stage"; }
    else if (status === "done") { tag.className = "gf-act-tag done"; tag.textContent = "Done"; }
    else if (!laterShown && status === "upcoming" && seq !== null) { tag.className = "gf-act-tag up"; tag.textContent = "Up next"; laterShown = true; }

    li.append(num, body, tag);
    list.appendChild(li);
  });
}

// ---------------------------------------------------------------------------------------------- food board
async function loadFood() {
  try {
    const res = await fetch("/api/dashboard/food");
    if (!res.ok) throw new Error("Failed to fetch food board");
    foodData = await res.json();
    saveCache();
  } catch (err) {
    console.error("Food error:", err);
    const cached = loadCache();
    if (cached && cached.food) {
      foodData = cached.food;
      showOffline(true, cached.savedAt);
    } else {
      return;
    }
  }

  const foodBtn = $("tab-food-btn");
  if (foodData.enabled === false) foodBtn.hidden = true;
  else foodBtn.hidden = false;

  $("dashboard-serving-note").textContent = foodData.serving_note ? `Open slots: ${foodData.open_items ?? 0} · ${foodData.serving_note}` : "";
  $("food-stats-pill").textContent = `${foodData.taken_items} of ${foodData.total_items} taken`;
  $("food-count-badge").textContent = `${foodData.taken_items}/${foodData.total_items}`;
  renderFoodGroups();
}

function renderFoodGroups() {
  const container = $("dashboard-food-groups");
  if (!container || !foodData) return;
  const me = myName();
  const groups = foodData.groups || [];
  const items = foodData.items || [];
  container.innerHTML = "";

  if (!groups.length) {
    const p = document.createElement("p");
    p.className = "gf-card gf-muted";
    p.textContent = "No dishes are listed yet.";
    container.appendChild(p);
    return;
  }

  groups.forEach((group) => {
    const groupItems = items.filter((i) => i.group_id === group.group_id);
    if (!groupItems.length) return;
    const wrap = document.createElement("div");
    wrap.className = "gf-card gf-dish-group";
    wrap.style.marginTop = ".75rem";
    const h = document.createElement("h4");
    const gName = document.createElement("span");
    gName.textContent = group.name;
    const gCount = document.createElement("span");
    gCount.textContent = `${groupItems.filter((i) => !i.is_taken).length} open`;
    h.append(gName, gCount);
    const grid = document.createElement("div");
    grid.className = "gf-dish-grid";

    groupItems.forEach((item) => {
      const row = document.createElement("div");
      row.className = "gf-dish" + (item.is_taken ? " is-taken" : "");
      const name = document.createElement("span");
      name.className = "gf-dish-name";
      const text = document.createElement("span");
      text.textContent = item.name;
      name.appendChild(text);

      const mine = item.is_taken && me && String(item.signer_name || "").trim().toLowerCase() === me;
      if (item.is_taken && !mine) {
        // Someone else's slot: show who, and the dish note if they left one.
        const who = document.createElement("span");
        who.className = "gf-dish-who";
        who.textContent = [item.signer_name, item.dish_description].filter(Boolean).join(" · ");
        text.appendChild(who);
      } else if (mine && item.dish_description) {
        const who = document.createElement("span");
        who.className = "gf-dish-who";
        who.textContent = item.dish_description;
        text.appendChild(who);
      }

      let right;
      if (mine) {
        right = document.createElement("a");
        right.href = `/my-entry?name=${encodeURIComponent(item.signer_name)}`;
        right.className = "gf-dish-tag yours";
        right.textContent = "Yours";
      } else if (item.is_taken) {
        right = document.createElement("span");
        right.className = "gf-dish-tag taken";
        right.textContent = "Taken";
      } else {
        right = document.createElement("a");
        right.href = `/my-entry?food_item=${encodeURIComponent(item.item_id)}`;
        right.className = "gf-btn gf-btn-small";
        right.textContent = "I'll bring it";
      }
      row.append(name, right);
      grid.appendChild(row);
    });
    wrap.append(h, grid);
    container.appendChild(wrap);
  });
}
