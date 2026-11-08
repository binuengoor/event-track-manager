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

  const getOrCreate = (name, initialData) => {
    const key = name.trim().toLowerCase();
    if (!map.has(key)) {
      map.set(key, {
        performer_name: name.trim(),
        age_group: initialData.age_group || "Senior",
        guardian_name: initialData.guardian_name || "",
        guardian_phone: initialData.guardian_phone || "",
        contact_info: initialData.contact_info || "",
        food_signup: initialData.food_signup || null,
        performances: [],
        min_seq: (initialData.sequence_order && initialData.sequence_order > 0) ? initialData.sequence_order : 9999,
        seq_list: []
      });
    }
    return map.get(key);
  };

  performances.forEach(perf => {
    const normName = (perf.performer_name || "").trim();
    if (!normName) return;

    // 1. Primary Performer
    const primary = getOrCreate(normName, {
      age_group: perf.age_group,
      guardian_name: perf.guardian_name,
      guardian_phone: perf.guardian_phone || perf.phone,
      contact_info: perf.contact_info,
      food_signup: perf.food_signup,
      sequence_order: perf.sequence_order
    });

    primary.performances.push({
      ...perf,
      display_partner: perf.partner_name || ""
    });
    if (perf.sequence_order && perf.sequence_order > 0) {
      primary.seq_list.push(perf.sequence_order);
      if (perf.sequence_order < primary.min_seq) {
        primary.min_seq = perf.sequence_order;
      }
    }
    if (perf.age_group && perf.age_group.toLowerCase().includes("junior")) {
      primary.age_group = perf.age_group;
    }
    if (!primary.guardian_name && perf.guardian_name) primary.guardian_name = perf.guardian_name;
    if (!primary.guardian_phone && (perf.guardian_phone || perf.phone)) primary.guardian_phone = perf.guardian_phone || perf.phone;
    if (!primary.contact_info && perf.contact_info) primary.contact_info = perf.contact_info;
    if (!primary.food_signup && perf.food_signup) primary.food_signup = perf.food_signup;

    // 2. Duet / Co-performer Partner(s)
    const rawPartner = (perf.partner_name || "").trim();
    if (rawPartner) {
      const partnerTokens = rawPartner.split(/[&,]|(?:\band\b)/i).map(s => s.trim()).filter(Boolean);
      partnerTokens.forEach(pName => {
        if (pName.toLowerCase() === normName.toLowerCase()) return;

        const isPartnerJunior = (perf.partner_age_group || perf.age_group || "").toLowerCase().includes("junior");
        const partner = getOrCreate(pName, {
          age_group: perf.partner_age_group || perf.age_group || "Senior",
          guardian_name: isPartnerJunior ? (perf.guardian_name || "") : "",
          guardian_phone: isPartnerJunior ? (perf.partner_phone || perf.guardian_phone || perf.phone || "") : "",
          contact_info: perf.partner_phone || "",
          food_signup: perf.partner_food_signup || null,
          sequence_order: perf.sequence_order
        });

        partner.performances.push({
          ...perf,
          display_partner: normName
        });
        if (perf.sequence_order && perf.sequence_order > 0) {
          partner.seq_list.push(perf.sequence_order);
          if (perf.sequence_order < partner.min_seq) {
            partner.min_seq = perf.sequence_order;
          }
        }
        if (perf.partner_age_group && (perf.partner_age_group.toLowerCase().includes("junior") || !partner.age_group || partner.age_group === "Senior")) {
          partner.age_group = perf.partner_age_group;
        } else if (perf.age_group && perf.age_group.toLowerCase().includes("junior") && (!partner.age_group || partner.age_group === "Senior")) {
          partner.age_group = perf.age_group;
        }
        if (perf.partner_phone && !partner.contact_info) {
          partner.contact_info = perf.partner_phone;
        }
        if (!partner.guardian_name && (perf.partner_age_group || partner.age_group || "").toLowerCase().includes("junior") && perf.guardian_name) {
          partner.guardian_name = perf.guardian_name;
          partner.guardian_phone = perf.partner_phone || perf.guardian_phone || perf.phone || "";
        }
        if (!partner.food_signup && perf.partner_food_signup) {
          partner.food_signup = perf.partner_food_signup;
        }
      });
    }
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
    const matchPhone = (p.guardian_phone || "").toLowerCase().includes(query) || (p.contact_info || "").toLowerCase().includes(query);
    const matchFood = p.food_signup ? (p.food_signup.item_name || "").toLowerCase().includes(query) || (p.food_signup.dish_description || "").toLowerCase().includes(query) : false;
    const matchSong = p.performances.some(perf => 
      (perf.song_title || "").toLowerCase().includes(query) || 
      (perf.movie_name || "").toLowerCase().includes(query) ||
      (perf.entry_id || "").toLowerCase().includes(query) ||
      (perf.partner_name || "").toLowerCase().includes(query) ||
      (perf.partner_phone || "").toLowerCase().includes(query)
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
                ${perf.display_partner ? `<span class="text-[9px] text-amber-300 block truncate">w/ ${escapeHtml(perf.display_partner)}${perf.partner_phone && perf.display_partner === perf.partner_name ? ` <span class="text-slate-400 font-mono text-[9px]">(${escapeHtml(perf.partner_phone)})</span>` : (perf.contact_info && perf.display_partner === perf.performer_name ? ` <span class="text-slate-400 font-mono text-[9px]">(${escapeHtml(perf.contact_info)})</span>` : '')}</span>` : ''}
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
          ${p.contact_info ? `
            <div class="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
              <i data-lucide="phone" class="w-3 h-3 text-slate-500"></i>
              <span class="font-mono text-[10px]">${escapeHtml(p.contact_info)}</span>
            </div>
          ` : ''}
          ${p.guardian_name ? `
            <div class="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
              <i data-lucide="shield" class="w-3 h-3 text-slate-500"></i>
              <span>${escapeHtml(p.guardian_name)}</span>
              ${p.guardian_phone ? `<span class="text-slate-500 font-mono text-[10px]">(${escapeHtml(p.guardian_phone)})</span>` : ''}
            </div>
          ` : (!p.contact_info && p.guardian_phone ? `<div class="text-[10px] text-slate-500 font-mono mt-0.5">${escapeHtml(p.guardian_phone)}</div>` : '')}
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
