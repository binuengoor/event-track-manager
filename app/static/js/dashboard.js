let performancesData = [];
let foodData = null;
let activeTab = "songs";

document.addEventListener("DOMContentLoaded", async () => {
  if (window.lucide) lucide.createIcons();
  await loadEventInfo();
  setupTabs();
  await Promise.all([loadPerformances(), loadFood()]);
  setupFilters();
});

async function loadEventInfo() {
  try {
    const res = await fetch("/api/event-info");
    if (res.ok) {
      const data = await res.json();
      window.eventInfo = data;
      if (data.header_brand_title) {
        const titleEl = document.getElementById("nav-event-title");
        if (titleEl) titleEl.textContent = data.header_brand_title;
        document.title = `Transparency Dashboard - ${data.header_brand_title}`;
      }
      if (data.header_brand_subtitle) {
        const subEl = document.getElementById("nav-event-subtitle");
        if (subEl) subEl.textContent = data.header_brand_subtitle;
      }
      const isStageEnabled = Boolean(data.stage_performances_enabled !== false);
      const isFoodEnabled = Boolean(data.food_signup_enabled !== false);

      const tabSongs = document.getElementById("tab-songs-btn");
      const tabFood = document.getElementById("tab-food-btn");
      const secSongs = document.getElementById("section-songs");
      const secFood = document.getElementById("section-food");
      const headerTitle = document.getElementById("dashboard-header-title");
      const headerDesc = document.getElementById("dashboard-header-desc");
      const tabsContainer = document.getElementById("dashboard-tabs-container");

      // Case 1: Potluck-Only Event (Stage performances disabled, Food enabled)
      if (!isStageEnabled && isFoodEnabled) {
        if (headerTitle) headerTitle.textContent = "Community Potluck Board";
        if (headerDesc) headerDesc.textContent = "Coordination board for community potluck dishes, commitments, and needed food items.";
        if (tabsContainer) tabsContainer.classList.add("hidden");
        if (tabSongs) tabSongs.classList.add("hidden");
        if (secSongs) secSongs.classList.add("hidden");
        if (secFood) secFood.classList.remove("hidden");
        activeTab = "food";
      }
      // Case 2: Performance-Only Event (Food disabled, Stage performances enabled)
      else if (isStageEnabled && !isFoodEnabled) {
        if (headerTitle) headerTitle.textContent = "Performance Setlist Dashboard";
        if (headerDesc) headerDesc.textContent = "Live view of all registered stage performances, acts, and audio track statuses.";
        if (tabsContainer) tabsContainer.classList.add("hidden");
        if (tabFood) tabFood.classList.add("hidden");
        if (secFood) secFood.classList.add("hidden");
        if (secSongs) secSongs.classList.remove("hidden");
        activeTab = "songs";
      }
      // Case 3: Both enabled (Full Event)
      else if (isStageEnabled && isFoodEnabled) {
        if (tabsContainer) tabsContainer.classList.remove("hidden");
        if (tabSongs) tabSongs.classList.remove("hidden");
        if (tabFood) tabFood.classList.remove("hidden");
        if (data.dashboard_enabled === false) {
          // Private setlists mode (e.g. competition)
          if (tabFood) tabFood.click();
        }
      }

      if (window.adaptNavigationForEventConfig) {
        window.adaptNavigationForEventConfig(data);
      }
    }
  } catch (e) {
    console.warn("Could not load event info:", e);
  }
}

function setupTabs() {
  const tabSongs = document.getElementById("tab-songs-btn");
  const tabFood = document.getElementById("tab-food-btn");
  const secSongs = document.getElementById("section-songs");
  const secFood = document.getElementById("section-food");

  tabSongs.addEventListener("click", () => {
    activeTab = "songs";
    tabSongs.className = "px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 bg-orange-500 text-white shadow";
    tabFood.className = "px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 text-slate-400 hover:text-white";
    secSongs.classList.remove("hidden");
    secFood.classList.add("hidden");
  });

  tabFood.addEventListener("click", () => {
    activeTab = "food";
    tabFood.className = "px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 bg-emerald-600 text-white shadow";
    tabSongs.className = "px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 text-slate-400 hover:text-white";
    secFood.classList.remove("hidden");
    secSongs.classList.add("hidden");
  });

  document.getElementById("refresh-dashboard-btn")?.addEventListener("click", async () => {
    await Promise.all([loadPerformances(), loadFood()]);
  });
}

async function loadPerformances() {
  if (window.eventInfo && window.eventInfo.stage_performances_enabled === false) {
    return;
  }
  try {
    const res = await fetch("/api/dashboard/performances");
    if (!res.ok) throw new Error("Failed to fetch performances");
    performancesData = await res.json();
    window.auroraEffect?.setActive(true, 1200);
    
    if (window.eventInfo && window.eventInfo.dashboard_enabled === false) {
      const badge = document.getElementById("songs-count-badge");
      if (badge) badge.textContent = "Locked";
      document.getElementById("songs-table-body").innerHTML = `
        <tr>
          <td colspan="6" class="px-5 py-12 text-center">
            <div class="max-w-md mx-auto space-y-2">
              <div class="w-10 h-10 rounded-2xl bg-amber-500/20 text-amber-400 mx-auto flex items-center justify-center">
                <i data-lucide="lock" class="w-5 h-5"></i>
              </div>
              <h4 class="text-sm font-bold text-white">Private Setlist Mode</h4>
              <p class="text-xs text-slate-400 leading-relaxed">Performance setlist transparency is currently locked for this event (e.g. Solo Competition Mode). Songs remain private until stage time.</p>
            </div>
          </td>
        </tr>
      `;
      if (window.lucide) lucide.createIcons();
      return;
    }

    document.getElementById("songs-count-badge").textContent = performancesData.length;
    renderSongsTable();
  } catch (err) {
    console.error("Performances error:", err);
    document.getElementById("songs-table-body").innerHTML = `
      <tr><td colspan="6" class="px-5 py-6 text-center text-rose-400">Failed to load performances. Please refresh.</td></tr>
    `;
  }
}

function renderSongsTable() {
  const tbody = document.getElementById("songs-table-body");
  const query = document.getElementById("song-search-input")?.value.toLowerCase() || "";
  const typeFilter = document.getElementById("type-filter-select")?.value.toLowerCase() || "";

  // Expand performances: if partner exists, create entries for both so both appear alphabetically
  const expanded = [];
  performancesData.forEach(p => {
    // Primary performer
    expanded.push({
      ...p,
      display_performer: p.performer_name,
      display_partner: p.partner_name || "",
      link_performer: p.performer_name
    });

    // If there is a distinct partner name, also create an entry under the partner
    if (p.partner_name && p.partner_name.trim().toLowerCase() !== p.performer_name.trim().toLowerCase()) {
      expanded.push({
        ...p,
        display_performer: p.partner_name.trim(),
        display_partner: p.performer_name.trim(),
        link_performer: p.partner_name.trim()
      });
    }
  });

  // Sort alphabetically by the displayed performer's name
  expanded.sort((a, b) => a.display_performer.localeCompare(b.display_performer));

  const filtered = expanded.filter(p => {
    const matchQuery = (
      p.display_performer.toLowerCase().includes(query) ||
      p.display_partner.toLowerCase().includes(query) ||
      (p.song_title || "").toLowerCase().includes(query) ||
      (p.movie_name || "").toLowerCase().includes(query)
    );
    const matchType = !typeFilter || (p.performance_type || "").toLowerCase().includes(typeFilter);
    return matchQuery && matchType;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr><td colspan="6" class="px-5 py-8 text-center text-slate-500">No performances match the filter criteria.</td></tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map(p => {
    const safeName = encodeURIComponent(p.link_performer);
    const songName = p.song_title || '<span class="text-amber-400 italic">Song name TBD</span>';
    const movieName = p.movie_name ? `<span class="text-[11px] text-slate-500 block">${p.movie_name}</span>` : '';
    const partner = p.display_partner ? `<span class="text-[11px] text-amber-400 block font-normal">w/ ${p.display_partner}</span>` : '';

    let trackBadge = '';
    if (p.track_status === "Acoustic") {
      trackBadge = '<span class="inline-flex items-center gap-1 text-[11px] font-bold text-sky-400 bg-sky-500/10 px-2 py-0.5 rounded-full border border-sky-500/20"><i data-lucide="guitar" class="w-3 h-3"></i> Acoustic</span>';
    } else if (p.has_track || p.track_status === "Uploaded") {
      trackBadge = '<span class="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20"><i data-lucide="check-circle" class="w-3 h-3"></i> Ready</span>';
    } else {
      trackBadge = '<span class="inline-flex items-center gap-1 text-[11px] font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20"><i data-lucide="clock" class="w-3 h-3"></i> Pending</span>';
    }

    const agePill = p.age_group ? `<span class="px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 text-[11px] font-semibold">${p.age_group}</span>` : '—';

    return `
      <tr class="hover:bg-slate-800/40 transition">
        <td class="px-5 py-3.5">
          <a href="/performer?name=${safeName}" class="text-orange-400 hover:text-orange-300 font-bold inline-flex items-center gap-1 group" title="Click to view performer hub & edit details">
            <span>${p.display_performer}</span>
            <i data-lucide="arrow-up-right" class="w-3 h-3 opacity-60 group-hover:opacity-100 transition"></i>
          </a>
          ${partner}
        </td>
        <td class="px-5 py-3.5">
          <span class="font-semibold text-white">${songName}</span>
          ${movieName}
        </td>
        <td class="px-4 py-3.5">
          <span class="px-2 py-0.5 rounded-md bg-slate-800/90 text-slate-300 font-semibold text-[11px]">${p.performance_type || 'Solo'}</span>
        </td>
        <td class="px-4 py-3.5">${agePill}</td>
        <td class="px-4 py-3.5">${trackBadge}</td>
        <td class="px-4 py-3.5 text-right">
          <a href="/performer?name=${safeName}" class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-[11px] font-semibold transition">
            Edit
          </a>
        </td>
      </tr>
    `;
  }).join("");

  if (window.lucide) lucide.createIcons();
}

function setupFilters() {
  document.getElementById("song-search-input")?.addEventListener("input", renderSongsTable);
  document.getElementById("type-filter-select")?.addEventListener("change", renderSongsTable);
}

async function loadFood() {
  try {
    const res = await fetch("/api/dashboard/food");
    if (!res.ok) throw new Error("Failed to fetch food dashboard");
    foodData = await res.json();

    const tabFoodBtn = document.getElementById("tab-food-btn");
    if (foodData.enabled === false) {
      if (tabFoodBtn) tabFoodBtn.classList.add("hidden");
    } else {
      if (tabFoodBtn) tabFoodBtn.classList.remove("hidden");
    }

    document.getElementById("dashboard-serving-note").textContent = foodData.serving_note || "Bring one dish to share";
    document.getElementById("food-stats-pill").textContent = `${foodData.taken_items} / ${foodData.total_items} Taken`;
    document.getElementById("food-count-badge").textContent = `${foodData.taken_items}/${foodData.total_items}`;

    renderFoodGroups();
  } catch (err) {
    console.error("Food error:", err);
  }
}

function renderFoodGroups() {
  const container = document.getElementById("dashboard-food-groups");
  if (!container || !foodData) return;

  const groups = foodData.groups || [];
  const allItems = foodData.items || [];

  if (groups.length === 0) {
    container.innerHTML = `
      <div class="p-8 text-center bg-slate-900 border border-slate-800 rounded-3xl text-slate-400">
        No food categories currently defined.
      </div>
    `;
    return;
  }

  container.innerHTML = groups.map(group => {
    const items = allItems.filter(i => i.group_id === group.group_id);
    if (items.length === 0) return "";

    const itemsHtml = items.map(item => {
      if (item.is_taken) {
        return `
          <div class="p-3.5 rounded-2xl bg-slate-900/60 border border-slate-800 flex items-center justify-between gap-3">
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-rose-500 shrink-0"></span>
                <span class="font-bold text-slate-200 text-xs truncate">${item.name}</span>
              </div>
              <p class="text-[11px] text-slate-400 mt-1 pl-4 truncate">
                <span class="text-orange-400 font-semibold">${item.signer_name}</span>
                ${item.dish_description ? ` &bull; <span class="text-slate-300 italic">"${item.dish_description}"</span>` : ''}
              </p>
            </div>
            <span class="px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 text-[10px] font-bold uppercase shrink-0">
              Taken
            </span>
          </div>
        `;
      } else {
        return `
          <div class="p-3.5 rounded-2xl bg-slate-900/90 border border-slate-700/80 hover:border-emerald-500/60 flex items-center justify-between gap-3 transition">
            <div class="flex items-center gap-2 min-w-0">
              <span class="w-2 h-2 rounded-full bg-emerald-500 shrink-0"></span>
              <span class="font-bold text-white text-xs truncate">${item.name}</span>
            </div>
            <a href="/performer?food_item=${item.item_id}" class="px-3 py-1 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow flex items-center gap-1 transition shrink-0">
              <span>Sign up</span>
              <i data-lucide="arrow-right" class="w-3.5 h-3.5"></i>
            </a>
          </div>
        `;
      }
    }).join("");

    return `
      <div class="bg-slate-900/80 border border-slate-800 p-5 rounded-3xl space-y-3">
        <div class="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
          <h3 class="text-sm font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-2">
            <i data-lucide="utensils" class="w-4 h-4"></i>
            <span>${group.name}</span>
          </h3>
          <span class="text-xs font-semibold text-slate-400">
            ${group.taken_count || 0} of ${items.length} slots claimed
          </span>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          ${itemsHtml}
        </div>
      </div>
    `;
  }).join("");

  if (window.lucide) lucide.createIcons();
}
