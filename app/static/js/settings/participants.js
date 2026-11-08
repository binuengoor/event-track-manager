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
      el.className = "is-active";
    } else {
      el.textContent = "↕";
      el.className = "";
    }
  });
}

function setCategoryFilter(filter) {
  activeCategoryFilter = filter;
  document.querySelectorAll(".part-filter-pill").forEach(pill => {
    const f = pill.dataset.filter;
    pill.className = f === filter ? "part-filter-pill ap-pill is-on" : "part-filter-pill ap-pill";
    pill.setAttribute("aria-pressed", f === filter ? "true" : "false");
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
      tbody.innerHTML = `<tr><td colspan="6" class="is-empty" style="color:var(--status-danger-fg)">Failed to load participants</td></tr>`;
      return;
    }
    allParticipants = await res.json();
    groupedParticipants = groupPerformancesByParticipant(allParticipants);
    updateParticipantCounters();
    renderParticipantsTable();
  } catch (err) {
    console.error("loadParticipants error:", err);
    tbody.innerHTML = `<tr><td colspan="6" class="is-empty" style="color:var(--status-danger-fg)">Error loading participants</td></tr>`;
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
    if (groupedParticipants.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="is-empty"><div class="ap-empty">
        <span class="ap-empty-ico"><i data-lucide="users"></i></span>
        <h3>No acts yet</h3>
        <p>Performers sign up themselves. Share the sign-up link and acts will appear here as they arrive.</p>
        <a class="ap-btn ap-btn-primary" href="/signup" target="_blank" rel="noopener">Open the sign-up page</a>
      </div></td></tr>`;
    } else {
      tbody.innerHTML = `<tr><td colspan="6" class="is-empty">No participants found matching criteria.</td></tr>`;
    }
    if (window.lucide) lucide.createIcons();
    return;
  }

  tbody.innerHTML = list.map(p => {
    const isJunior = (p.age_group || "").toLowerCase().includes("junior");
    const ageBadgeClass = isJunior ? "ap-chip ap-chip-warn" : "ap-chip ap-chip-muted";

    // Seq display
    const seqDisplay = p.seq_list.length > 0
      ? p.seq_list.sort((a, b) => a - b).map(s => `<span class="ap-seq">#${s}</span>`).join(", ")
      : `<span class="ap-meta">-</span>`;

    // Track status display
    let trackStatusHtml = "";
    if (p.readyCount === p.totalActs && p.totalActs > 0) {
      if (p.acousticCount === p.totalActs) {
        trackStatusHtml = `<span class="ap-chip ap-chip-info"><i data-lucide="guitar"></i><span>${p.totalActs}/${p.totalActs} Acoustic</span></span>`;
      } else {
        trackStatusHtml = `<span class="ap-chip ap-chip-ok"><i data-lucide="check-circle"></i><span>${p.totalActs}/${p.totalActs} Ready</span></span>`;
      }
    } else if (p.readyCount > 0) {
      trackStatusHtml = `<span class="ap-chip ap-chip-warn"><i data-lucide="clock"></i><span>${p.readyCount}/${p.totalActs} Ready</span></span>`;
    } else {
      trackStatusHtml = `<span class="ap-chip ap-chip-muted"><i data-lucide="alert-circle"></i><span>0/${p.totalActs} Pending</span></span>`;
    }

    // Food sign-up display
    let foodHtml = "";
    if (p.food_signup) {
      foodHtml = `
        <div class="ap-person">
          <span class="ap-chip ap-chip-ok"><i data-lucide="utensils"></i><span>${escapeHtml(p.food_signup.item_name)}</span></span>
          ${p.food_signup.dish_description ? `<span class="ap-meta" title="${escapeHtml(p.food_signup.dish_description)}">${escapeHtml(p.food_signup.dish_description)}</span>` : ''}
        </div>
      `;
    } else {
      foodHtml = `<span class="ap-chip ap-chip-muted">No dish</span>`;
    }

    // Acts list with individual Edit / Delete actions
    const actsHtml = `
      <div class="ap-acts-count">${p.totalActs} ${p.totalActs === 1 ? 'Act' : 'Acts'}</div>
      ${p.performances.map((perf, idx) => `
        <div class="ap-act">
          <div class="ap-act-main">
            <b>${escapeHtml(perf.performance_type || 'Solo')}</b>:
            ${perf.song_title ? escapeHtml(perf.song_title) : '<i>No song</i>'}
            ${perf.display_partner ? `<small>w/ ${escapeHtml(perf.display_partner)}${perf.partner_phone && perf.display_partner === perf.partner_name ? ` <span class="ap-mono">(${escapeHtml(perf.partner_phone)})</span>` : (perf.contact_info && perf.display_partner === perf.performer_name ? ` <span class="ap-mono">(${escapeHtml(perf.contact_info)})</span>` : '')}</small>` : ''}
          </div>
          <div class="ap-act-btns">
            <button type="button" data-action="edit-participant" data-entry-id="${escapeHtml(perf.entry_id)}" class="ap-iconbtn" title="Edit ${escapeHtml(perf.entry_id)}" aria-label="Edit entry ${escapeHtml(perf.entry_id)}">
              <i data-lucide="edit-3"></i>
            </button>
            <button type="button" data-action="delete-participant" data-entry-id="${escapeHtml(perf.entry_id)}" data-name="${escapeHtml(p.performer_name)}" class="ap-iconbtn ap-iconbtn-danger" title="Delete ${escapeHtml(perf.entry_id)}" aria-label="Delete entry ${escapeHtml(perf.entry_id)}">
              <i data-lucide="trash-2"></i>
            </button>
          </div>
        </div>
      `).join('')}
    `;

    return `
      <tr>
        <td data-label="Seq">${seqDisplay}</td>
        <td data-label="Participant">
          <div class="ap-person">
            <b><span>${escapeHtml(p.performer_name)}</span><span class="${ageBadgeClass}">${escapeHtml(p.age_group)}</span></b>
            ${p.contact_info ? `<span class="ap-meta"><i data-lucide="phone"></i><span class="ap-mono">${escapeHtml(p.contact_info)}</span></span>` : ''}
            ${p.guardian_name ? `<span class="ap-meta"><i data-lucide="shield"></i><span>${escapeHtml(p.guardian_name)}</span>${p.guardian_phone ? `<span class="ap-mono">(${escapeHtml(p.guardian_phone)})</span>` : ''}</span>` : (!p.contact_info && p.guardian_phone ? `<span class="ap-meta ap-mono">${escapeHtml(p.guardian_phone)}</span>` : '')}
          </div>
        </td>
        <td data-label="Performances">${actsHtml}</td>
        <td data-label="Track status">${trackStatusHtml}</td>
        <td data-label="Dish">${foodHtml}</td>
        <td data-label="Hub" style="text-align:right">
          <a href="/performer?name=${encodeURIComponent(p.performer_name)}" target="_blank" rel="noopener" class="ap-hub" title="Open Performer Hub">
            <span>Hub</span>
            <i data-lucide="external-link"></i>
          </a>
        </td>
      </tr>
    `;
  }).join("");

  if (window.lucide) lucide.createIcons();
}
