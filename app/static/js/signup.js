let signupConfig = null;
let selectedAgeGroup = null;
let hasPerf2 = false;

document.addEventListener("DOMContentLoaded", async () => {
  if (window.lucide) lucide.createIcons();
  await loadSignupConfig();
  setupEventListeners();
});

async function loadSignupConfig() {
  try {
    const res = await fetch("/api/signup/config");
    if (!res.ok) throw new Error("Failed to load registration configuration");
    signupConfig = await res.json();

    if (signupConfig.header_brand_title) {
      const titleEl = document.getElementById("nav-event-title");
      if (titleEl) titleEl.textContent = signupConfig.header_brand_title;
      document.title = `Event Registration - ${signupConfig.header_brand_title}`;
    }
    if (signupConfig.header_brand_subtitle) {
      const subEl = document.getElementById("nav-event-subtitle");
      if (subEl) subEl.textContent = signupConfig.header_brand_subtitle;
    }

    if (signupConfig.food_serving_note) {
      const noteEl = document.getElementById("food-serving-note-text");
      if (noteEl) noteEl.textContent = signupConfig.food_serving_note;
    }

    if (!signupConfig.food_signup_enabled) {
      const foodSec = document.getElementById("food-section");
      if (foodSec) foodSec.classList.add("hidden");
    }

    if (signupConfig.signup_enabled === false) {
      const closedBanner = document.getElementById("signup-closed-banner");
      if (closedBanner) closedBanner.classList.remove("hidden");
      const submitBtnText = document.getElementById("submit-btn-text");
      if (submitBtnText) submitBtnText.textContent = "Sign-Ups Closed";
      const submitBtn = document.getElementById("submit-btn");
      if (submitBtn) {
        submitBtn.className = "w-full py-4 rounded-2xl bg-slate-800 text-slate-400 font-bold text-sm shadow-md flex items-center justify-center gap-2 transition hover:bg-slate-700 cursor-pointer";
      }
    }

    renderAgeGroups(signupConfig.age_groups || []);
    renderPerformanceTypes(signupConfig.performance_types || ["Solo", "Duet", "Group"]);
    renderPartnerOptions(signupConfig.registered_performers || []);
    renderFoodGroups(signupConfig.food_groups || [], signupConfig.food_items || []);

    if (window.lucide) lucide.createIcons();
  } catch (err) {
    console.error("Config load error:", err);
    showError("Could not load registration settings. Please refresh the page.");
  }
}

function renderAgeGroups(ageGroups) {
  const container = document.getElementById("age-group-options");
  if (!container) return;
  container.innerHTML = "";

  ageGroups.forEach((ag, idx) => {
    const label = document.createElement("label");
    label.className = "flex-1 flex items-center justify-center gap-2 p-2.5 rounded-xl border border-slate-700 bg-slate-950/80 hover:border-orange-500/50 cursor-pointer transition text-xs font-bold text-slate-300";
    
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "age_group";
    input.value = ag.name;
    input.className = "text-orange-500 focus:ring-orange-500";
    if (idx === 0) {
      input.checked = true;
      selectedAgeGroup = ag;
    }

    input.addEventListener("change", () => {
      selectedAgeGroup = ag;
      toggleGuardianRequirement(ag.requires_guardian);
    });

    label.appendChild(input);
    label.appendChild(document.createTextNode(ag.name));
    container.appendChild(label);
  });

  if (selectedAgeGroup) {
    toggleGuardianRequirement(selectedAgeGroup.requires_guardian);
  }
}

function toggleGuardianRequirement(requires) {
  const container = document.getElementById("guardian-container");
  const nameInput = document.getElementById("guardian-name");
  const phoneInput = document.getElementById("guardian-phone");
  if (!container) return;

  if (requires) {
    container.classList.remove("hidden");
    if (nameInput) nameInput.required = true;
    if (phoneInput) phoneInput.required = true;
  } else {
    container.classList.add("hidden");
    if (nameInput) {
      nameInput.required = false;
      nameInput.value = "";
    }
    if (phoneInput) {
      phoneInput.required = false;
      phoneInput.value = "";
    }
  }
}

function renderPerformanceTypes(types) {
  ["perf-type-1", "perf-type-2"].forEach((containerId, idx) => {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";
    const cardNum = idx + 1;

    types.forEach((t, tIdx) => {
      const label = document.createElement("label");
      label.className = `flex-1 flex items-center justify-center gap-2 p-2.5 rounded-xl border border-slate-700 bg-slate-900 hover:border-orange-500/50 cursor-pointer transition text-xs font-semibold text-slate-300 perf-type-opt-${cardNum}`;
      
      const input = document.createElement("input");
      input.type = "radio";
      input.name = `perf_type_${cardNum}`;
      input.value = t;
      input.className = "text-orange-500 focus:ring-orange-500";
      if (cardNum === 1 && tIdx === 0) input.checked = true;
      if (cardNum === 2 && tIdx === 1) input.checked = true;

      input.addEventListener("change", () => {
        handleTypeChange(cardNum, t);
        checkSoloLimit();
      });

      label.appendChild(input);
      label.appendChild(document.createTextNode(t));
      container.appendChild(label);
    });
  });
}

function renderPartnerAgeGroups(cardNum, ageGroups) {
  const container = document.getElementById(`partner-age-options-${cardNum}`);
  if (!container) return;
  container.innerHTML = "";

  const groups = (ageGroups && ageGroups.length > 0) ? ageGroups : [{ name: "Senior" }, { name: "Junior" }];
  groups.forEach((ag, idx) => {
    const label = document.createElement("label");
    label.className = `flex-1 flex items-center justify-center gap-2 p-2.5 rounded-xl border border-slate-700 bg-slate-900 hover:border-orange-500/50 cursor-pointer transition text-xs font-semibold text-slate-300 partner-age-opt-${cardNum}`;

    const input = document.createElement("input");
    input.type = "radio";
    input.name = `partner_age_group_${cardNum}`;
    input.value = ag.name;
    input.className = "text-orange-500 focus:ring-orange-500";
    if (idx === 0) input.checked = true;

    label.appendChild(input);
    label.appendChild(document.createTextNode(ag.name));
    container.appendChild(label);
  });
}

function renderPartnerOptions(registeredNames) {
  [1, 2].forEach(cardNum => {
    const select = document.getElementById(`partner-select-${cardNum}`);
    if (!select) return;

    select.innerHTML = '<option value="">-- Choose from registered performers --</option>';
    registeredNames.forEach(name => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      select.appendChild(opt);
    });

    renderPartnerAgeGroups(cardNum, signupConfig?.age_groups || []);

    const toggleBtn = document.getElementById(`toggle-custom-partner-${cardNum}`);
    const selectWrap = document.getElementById(`partner-select-wrap-${cardNum}`);
    const customWrap = document.getElementById(`partner-custom-wrap-${cardNum}`);
    const customInput = document.getElementById(`partner-custom-name-${cardNum}`);
    const hiddenPartner = document.getElementById(`partner-name-${cardNum}`);
    const dupBox = document.getElementById(`partner-dup-box-${cardNum}`);
    const matchedListEl = document.getElementById(`partner-matched-list-${cardNum}`);
    const dismissBtn = document.getElementById(`dismiss-partner-dup-${cardNum}`);

    if (toggleBtn && !toggleBtn._configured) {
      toggleBtn._configured = true;
      toggleBtn.addEventListener("click", () => {
        const isCustomHidden = customWrap.classList.contains("hidden");
        if (isCustomHidden) {
          // Switch to custom text input
          customWrap.classList.remove("hidden");
          selectWrap.classList.add("hidden");
          toggleBtn.textContent = "← Choose from registered list";
          select.value = "";
          hiddenPartner.value = customInput.value.trim();
          customInput.focus();
        } else {
          // Switch back to select dropdown
          customWrap.classList.add("hidden");
          selectWrap.classList.remove("hidden");
          toggleBtn.textContent = "+ Add other participant";
          customInput.value = "";
          hiddenPartner.value = select.value.trim();
          if (dupBox) dupBox.classList.add("hidden");
        }
      });
    }

    if (select && !select._configured) {
      select._configured = true;
      select.addEventListener("change", () => {
        hiddenPartner.value = select.value.trim();
      });
    }

    if (customInput && !customInput._configured) {
      customInput._configured = true;
      customInput.addEventListener("input", () => {
        const rawVal = customInput.value;
        hiddenPartner.value = rawVal.trim();

        const currentType = document.querySelector(`input[name="perf_type_${cardNum}"]:checked`)?.value?.toLowerCase() || "duet";
        const isGroup = currentType === "group";

        let activePart = "";
        let parts = [];
        let excluded = [];

        if (isGroup) {
          parts = rawVal.split(',');
          activePart = parts[parts.length - 1].trim().toLowerCase();
          excluded = parts.slice(0, -1).map(p => p.trim().toLowerCase());
        } else {
          activePart = rawVal.trim().toLowerCase();
        }

        // Check if >= 3 characters entered
        if (activePart.length < 3 || !signupConfig || !signupConfig.registered_performers) {
          if (dupBox) dupBox.classList.add("hidden");
          return;
        }

        const registered = signupConfig.registered_performers;
        const matches = registered
          .filter(p => !excluded.includes(p.trim().toLowerCase()))
          .filter(p => {
            const norm = p.trim().toLowerCase();
            return norm === activePart || norm.startsWith(activePart) || norm.includes(activePart);
          });

        if (matches.length > 0 && dupBox && matchedListEl) {
          matchedListEl.innerHTML = "";
          matches.forEach(m => {
            const pill = document.createElement("button");
            pill.type = "button";
            pill.className = "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs shadow transition";

            const nameSpan = document.createElement("span");
            nameSpan.textContent = m;
            pill.appendChild(nameSpan);

            const icon = document.createElement("i");
            icon.setAttribute("data-lucide", isGroup ? "plus" : "check");
            icon.className = "w-3 h-3";
            pill.appendChild(icon);

            pill.addEventListener("click", () => {
              if (isGroup) {
                parts[parts.length - 1] = " " + m;
                customInput.value = parts.map(p => p.trim()).filter(Boolean).join(", ") + ", ";
                hiddenPartner.value = customInput.value.trim();
                dupBox.classList.add("hidden");
                customInput.focus();
              } else {
                // Ensure option exists in select
                let opt = Array.from(select.options).find(o => o.value.toLowerCase() === m.toLowerCase());
                if (!opt) {
                  opt = document.createElement("option");
                  opt.value = m;
                  opt.textContent = m;
                  select.appendChild(opt);
                }
                select.value = opt.value;
                hiddenPartner.value = opt.value;

                // Switch back to select mode
                customWrap.classList.add("hidden");
                selectWrap.classList.remove("hidden");
                toggleBtn.textContent = "+ Add other participant";
                customInput.value = "";
                dupBox.classList.add("hidden");
              }
            });

            matchedListEl.appendChild(pill);
          });
          dupBox.classList.remove("hidden");
          if (window.lucide) lucide.createIcons();
        } else {
          if (dupBox) dupBox.classList.add("hidden");
        }
      });
    }

    if (dismissBtn && !dismissBtn._configured) {
      dismissBtn._configured = true;
      dismissBtn.addEventListener("click", () => {
        if (dupBox) dupBox.classList.add("hidden");
      });
    }
  });
}

function handleTypeChange(cardNum, type) {
  const partnerBox = document.getElementById(`partner-box-1`);
  const partnerBox2 = document.getElementById(`partner-box-2`);
  const hiddenPartner = document.getElementById(`partner-name-${cardNum}`);
  const selectWrap = document.getElementById(`partner-select-wrap-${cardNum}`);
  const customWrap = document.getElementById(`partner-custom-wrap-${cardNum}`);
  const toggleBtn = document.getElementById(`toggle-custom-partner-${cardNum}`);

  const targetBox = cardNum === 1 ? partnerBox : partnerBox2;
  const label = targetBox ? targetBox.querySelector('label') : null;
  const t = type.toLowerCase();

  if (targetBox) {
    if (t === "duet" || t === "group") {
      targetBox.classList.remove("hidden");
      if (t === "group") {
        if (label) label.textContent = "Group Members *";
        if (customWrap && selectWrap) {
          customWrap.classList.remove("hidden");
          selectWrap.classList.add("hidden");
        }
        if (toggleBtn) toggleBtn.classList.add("hidden");
        const customInput = document.getElementById(`partner-custom-name-${cardNum}`);
        if (customInput) customInput.placeholder = "Comma-separated names (e.g. Alice, Bob, Charlie)";
      } else {
        if (label) label.textContent = "Duet Partner Name *";
        if (toggleBtn) {
          toggleBtn.classList.remove("hidden");
          toggleBtn.textContent = customWrap && !customWrap.classList.contains("hidden") 
            ? "← Choose from registered list" 
            : "+ Add other participant";
        }
        const customInput = document.getElementById(`partner-custom-name-${cardNum}`);
        if (customInput) customInput.placeholder = "Enter participant's full name";
      }
    } else {
      targetBox.classList.add("hidden");
      if (hiddenPartner) hiddenPartner.value = "";
      const select = document.getElementById(`partner-select-${cardNum}`);
      if (select) select.value = "";
      const customInput = document.getElementById(`partner-custom-name-${cardNum}`);
      if (customInput) customInput.value = "";
      const dupBox = document.getElementById(`partner-dup-box-${cardNum}`);
      if (dupBox) dupBox.classList.add("hidden");
    }
  }
}

function checkSoloLimit() {
  const type1 = document.querySelector('input[name="perf_type_1"]:checked')?.value || "Solo";
  const soloRadio2 = document.querySelector('input[name="perf_type_2"][value="Solo"]');
  const warnEl = document.getElementById("perf-2-solo-warn");

  if (type1.toLowerCase() === "solo") {
    if (soloRadio2) {
      soloRadio2.disabled = true;
      soloRadio2.parentElement.classList.add("opacity-50", "cursor-not-allowed");
      if (soloRadio2.checked) {
        const duetRadio2 = document.querySelector('input[name="perf_type_2"][value="Duet"]');
        if (duetRadio2) {
          duetRadio2.checked = true;
          handleTypeChange(2, "Duet");
        }
      }
    }
    if (warnEl) warnEl.classList.remove("hidden");
  } else {
    if (soloRadio2) {
      soloRadio2.disabled = false;
      soloRadio2.parentElement.classList.remove("opacity-50", "cursor-not-allowed");
    }
    if (warnEl) warnEl.classList.add("hidden");
  }
}

function renderFoodGroups(groups, allItems) {
  const container = document.getElementById("food-groups-container");
  if (!container) return;
  container.innerHTML = "";

  groups.forEach(group => {
    const groupItems = allItems.filter(i => i.group_id === group.group_id);
    if (groupItems.length === 0) return;

    const groupWrapper = document.createElement("div");
    groupWrapper.className = "p-4 rounded-2xl bg-slate-950/60 border border-slate-800 space-y-3";

    const header = document.createElement("div");
    header.className = "flex items-center justify-between";
    header.innerHTML = `
      <h4 class="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
        <i data-lucide="utensils" class="w-3.5 h-3.5"></i>
        <span>${group.name}</span>
      </h4>
      <span class="text-[11px] font-semibold text-slate-400">
        ${group.taken_count || 0}/${groupItems.length} taken
      </span>
    `;
    groupWrapper.appendChild(header);

    const itemsGrid = document.createElement("div");
    itemsGrid.className = "grid grid-cols-1 sm:grid-cols-2 gap-2";

    groupItems.forEach(item => {
      const itemRow = document.createElement("label");
      if (item.is_taken) {
        itemRow.className = "flex items-center justify-between p-2.5 rounded-xl bg-slate-900/40 border border-slate-800/80 opacity-60 text-xs text-slate-400 cursor-not-allowed";
        itemRow.innerHTML = `
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-rose-500"></span>
            <span class="font-medium">${item.name}</span>
          </div>
          <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20">
            Taken (${item.signer_name || "Signed Up"})
          </span>
        `;
      } else {
        itemRow.className = "flex items-center justify-between p-2.5 rounded-xl bg-slate-900 border border-slate-700/80 hover:border-emerald-500/60 cursor-pointer transition text-xs text-slate-200";
        itemRow.innerHTML = `
          <div class="flex items-center gap-2">
            <input type="radio" name="food_item_id" value="${item.item_id}" data-name="${item.name}" class="text-emerald-500 focus:ring-emerald-500">
            <span class="font-medium text-white">${item.name}</span>
          </div>
          <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            OPEN
          </span>
        `;
      }
      itemsGrid.appendChild(itemRow);
    });

    groupWrapper.appendChild(itemsGrid);
    container.appendChild(groupWrapper);
  });
}

function isPlaceholderSong(title) {
  if (!title) return true;
  const t = title.trim().toLowerCase();
  if (!t) return true;
  const placeholders = [
    'tbd', 'tba', 'to be decided', 'to be announced',
    'test', 'testing', 'n/a', 'na', 'none', 'unknown',
    'song title missing', 'missing', 'pending', 'null'
  ];
  if (placeholders.includes(t)) return true;
  if (/^performance\s+\d+$/i.test(t)) return true;
  if (/^song\s+\d+$/i.test(t)) return true;
  return false;
}

function findDuplicateSongSignup(title) {
  if (!title || isPlaceholderSong(title) || !signupConfig || !signupConfig.existing_songs) return null;
  const cleanTitle = title.trim().toLowerCase();
  if (cleanTitle.length < 3) return null;

  for (const s of signupConfig.existing_songs) {
    const existingTitle = (s.song_title || '').trim();
    if (isPlaceholderSong(existingTitle)) continue;

    const existingLower = existingTitle.toLowerCase();
    if (existingLower === cleanTitle || 
        (cleanTitle.length >= 4 && (existingLower.includes(cleanTitle) || cleanTitle.includes(existingLower)))) {
      return s;
    }
  }
  return null;
}

function setupEventListeners() {
  // Add 2nd Performance
  const addPerfBtn = document.getElementById("add-perf-btn");
  const perfCard2 = document.getElementById("perf-card-2");
  const removePerf2Btn = document.getElementById("remove-perf-2-btn");

  if (addPerfBtn) {
    addPerfBtn.addEventListener("click", () => {
      hasPerf2 = true;
      perfCard2.classList.remove("hidden");
      addPerfBtn.classList.add("hidden");
      checkSoloLimit();
      if (window.lucide) lucide.createIcons();
    });
  }

  if (removePerf2Btn) {
    removePerf2Btn.addEventListener("click", () => {
      hasPerf2 = false;
      perfCard2.classList.add("hidden");
      addPerfBtn.classList.remove("hidden");
      document.getElementById("song-title-2").value = "";
      document.getElementById("movie-name-2").value = "";
      document.getElementById("stage-notes-2").value = "";
      const partner2 = document.getElementById("partner-name-2");
      if (partner2) partner2.value = "";
    });
  }

  // Food selection listeners
  const container = document.getElementById("food-groups-container");
  const selectedFoodBox = document.getElementById("selected-food-box");
  const selectedNameEl = document.getElementById("selected-food-item-name");
  const skipCheckbox = document.getElementById("skip-food-checkbox");

  if (container) {
    container.addEventListener("change", (e) => {
      if (e.target && e.target.name === "food_item_id") {
        if (skipCheckbox) skipCheckbox.checked = false;
        if (selectedFoodBox) selectedFoodBox.classList.remove("hidden");
        if (selectedNameEl) selectedNameEl.textContent = e.target.dataset.name;
      }
    });
  }

  if (skipCheckbox) {
    skipCheckbox.addEventListener("change", (e) => {
      if (e.target.checked) {
        const checkedRadio = document.querySelector('input[name="food_item_id"]:checked');
        if (checkedRadio) checkedRadio.checked = false;
        if (selectedFoodBox) selectedFoodBox.classList.add("hidden");
      }
    });
  }

  // Live duplicate registration check on performer name
  const nameInput = document.getElementById("performer-name");
  const dupWarningBox = document.getElementById("duplicate-warning-box");
  const matchedListEl = document.getElementById("matched-performers-list");
  const dismissDupBtn = document.getElementById("dismiss-dup-warning-btn");

  if (nameInput && dupWarningBox) {
    nameInput.addEventListener("input", () => {
      const val = nameInput.value.trim().toLowerCase();
      // Only start looking up once at least 3 characters are entered
      if (val.length < 3 || !signupConfig || !signupConfig.registered_performers) {
        dupWarningBox.classList.add("hidden");
        return;
      }

      // Find ALL matching registered performers
      const registered = signupConfig.registered_performers;
      const matches = registered.filter(p => {
        const norm = p.trim().toLowerCase();
        return norm === val || norm.startsWith(val) || norm.includes(val);
      });

      if (matches.length > 0) {
        if (matchedListEl) {
          matchedListEl.innerHTML = "";
          matches.forEach(m => {
            const btn = document.createElement("a");
            btn.href = `/performer?name=${encodeURIComponent(m)}`;
            btn.className = "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs shadow transition";
            
            const nameSpan = document.createElement("span");
            nameSpan.textContent = m;
            btn.appendChild(nameSpan);

            const icon = document.createElement("i");
            icon.setAttribute("data-lucide", "arrow-right");
            icon.className = "w-3.5 h-3.5";
            btn.appendChild(icon);

            matchedListEl.appendChild(btn);
          });
        }
        dupWarningBox.classList.remove("hidden");
        if (window.lucide) lucide.createIcons();
      } else {
        dupWarningBox.classList.add("hidden");
      }
    });

    if (dismissDupBtn) {
      dismissDupBtn.addEventListener("click", () => {
        dupWarningBox.classList.add("hidden");
      });
    }
  }

  // Live duplicate check on song titles
  [1, 2].forEach(cardNum => {
    const songInput = document.getElementById(`song-title-${cardNum}`);
    const songDupBox = document.getElementById(`song-dup-box-${cardNum}`);
    if (songInput && songDupBox) {
      songInput.addEventListener("input", () => {
        const val = songInput.value.trim();
        const dup = findDuplicateSongSignup(val);
        if (dup) {
          const singer = dup.partner_name 
            ? `${dup.performer_name} & ${dup.partner_name}` 
            : dup.performer_name;
          songDupBox.innerHTML = `
            <div class="flex items-start gap-2">
              <i data-lucide="alert-circle" class="w-4 h-4 text-amber-400 shrink-0 mt-0.5"></i>
              <div>
                <span class="font-bold text-amber-300">Song already chosen:</span>
                <span>"<strong>${escapeHtml(dup.song_title)}</strong>" has already been selected by <strong>${escapeHtml(singer)}</strong> (${escapeHtml(dup.performance_type || 'Solo')}).</span>
              </div>
            </div>
          `;
          songDupBox.classList.remove("hidden");
          if (window.lucide) lucide.createIcons();
        } else {
          songDupBox.classList.add("hidden");
          songDupBox.innerHTML = "";
        }
      });
    }
  });

  // Signup form submit
  const form = document.getElementById("signup-form");
  if (form) {
    form.addEventListener("submit", handleSignupSubmit);
  }
}

async function handleSignupSubmit(e) {
  e.preventDefault();
  hideError();

  if (signupConfig && signupConfig.signup_enabled === false) {
    showError("Thanks for your interest, but the sign-ups for this event are currently closed. Please reach out to the organizers for more information.");
    return;
  }

  const name = document.getElementById("performer-name").value.trim();
  const contact = document.getElementById("contact-info").value.trim();
  const ageGroup = document.querySelector('input[name="age_group"]:checked')?.value || "";

  if (!name) {
    showError("Please enter your full name.");
    return;
  }

  const guardianName = document.getElementById("guardian-name")?.value.trim() || "";
  const guardianPhone = document.getElementById("guardian-phone")?.value.trim() || "";

  if (selectedAgeGroup && selectedAgeGroup.requires_guardian) {
    if (!guardianName || !guardianPhone) {
      showError("Parent/Guardian name and phone are required for Junior registration.");
      return;
    }
  }

  // Performance 1
  const type1 = document.querySelector('input[name="perf_type_1"]:checked')?.value || "Solo";
  const partner1 = document.getElementById("partner-name-1")?.value.trim() || null;
  const song1 = document.getElementById("song-title-1")?.value.trim() || "";
  const movie1 = document.getElementById("movie-name-1")?.value.trim() || "";
  const notes1 = document.getElementById("stage-notes-1")?.value.trim() || "";
  const acoustic1 = Boolean(document.getElementById("acoustic-1")?.checked);

  const isCustomPartner1 = !document.getElementById("partner-custom-wrap-1")?.classList.contains("hidden");
  const partnerAgeGroup1 = (type1.toLowerCase() === "duet" && isCustomPartner1)
    ? (document.querySelector('input[name="partner_age_group_1"]:checked')?.value || "Senior")
    : null;

  if (type1.toLowerCase() === "duet" && !partner1) {
    showError("Please specify your duet partner's name for Performance 1.");
    return;
  }

  const performances = [
    {
      performance_type: type1,
      partner_name: partner1,
      partner_age_group: partnerAgeGroup1,
      song_title: song1,
      movie_name: movie1,
      stage_notes: notes1,
      is_acoustic: acoustic1
    }
  ];

  // Performance 2
  if (hasPerf2) {
    const type2 = document.querySelector('input[name="perf_type_2"]:checked')?.value || "Duet";
    const partner2 = document.getElementById("partner-name-2")?.value.trim() || null;
    const song2 = document.getElementById("song-title-2")?.value.trim() || "";
    const movie2 = document.getElementById("movie-name-2")?.value.trim() || "";
    const notes2 = document.getElementById("stage-notes-2")?.value.trim() || "";
    const acoustic2 = Boolean(document.getElementById("acoustic-2")?.checked);

    const isCustomPartner2 = !document.getElementById("partner-custom-wrap-2")?.classList.contains("hidden");
    const partnerAgeGroup2 = (type2.toLowerCase() === "duet" && isCustomPartner2)
      ? (document.querySelector('input[name="partner_age_group_2"]:checked')?.value || "Senior")
      : null;

    if (type2.toLowerCase() === "duet" && !partner2) {
      showError("Please specify your duet partner's name for Performance 2.");
      return;
    }

    performances.push({
      performance_type: type2,
      partner_name: partner2,
      partner_age_group: partnerAgeGroup2,
      song_title: song2,
      movie_name: movie2,
      stage_notes: notes2,
      is_acoustic: acoustic2
    });
  }

  // Food sign-up
  let foodSignup = null;
  const skipFood = document.getElementById("skip-food-checkbox")?.checked;
  const foodRadio = document.querySelector('input[name="food_item_id"]:checked');

  if (!skipFood && foodRadio) {
    const dishDesc = document.getElementById("dish-description")?.value.trim() || "";
    foodSignup = {
      item_id: foodRadio.value,
      dish_description: dishDesc
    };
  }

  const payload = {
    performer_name: name,
    contact_info: contact,
    age_group: ageGroup,
    guardian_name: guardianName,
    guardian_phone: guardianPhone,
    performances: performances,
    food_signup: foodSignup
  };

  const submitBtn = document.getElementById("submit-btn");
  const submitText = document.getElementById("submit-btn-text");
  submitBtn.disabled = true;
  submitText.textContent = "Registering...";

  try {
    const res = await fetch("/api/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || "Registration failed. Please try again.");
    }

    showSuccessModal(data, payload);
  } catch (err) {
    showError(err.message);
  } finally {
    submitBtn.disabled = false;
    submitText.textContent = "Complete Registration";
  }
}

function showSuccessModal(response, request) {
  const modal = document.getElementById("success-modal");
  const msgEl = document.getElementById("success-message-text");
  const detailsBox = document.getElementById("success-details-box");
  const perfLink = document.getElementById("success-performer-link");

  if (!modal) return;

  msgEl.textContent = `Thank you, ${response.performer_name}! You are registered for Paattukoottam 2026.`;
  perfLink.href = `/performer?name=${encodeURIComponent(response.performer_name)}`;

  let detailsHtml = `
    <p class="font-bold text-white border-b border-slate-800 pb-1.5 mb-2">Registration Summary</p>
    <div class="space-y-1">
      <p><strong class="text-orange-400">Entry ID(s):</strong> ${response.entry_ids.join(", ")}</p>
      <p><strong class="text-slate-400">Performances:</strong> ${request.performances.length} act(s)</p>
  `;

  request.performances.forEach((p, idx) => {
    detailsHtml += `
      <p class="text-[11px] text-slate-400 pl-2">&bull; Act ${idx + 1}: ${p.performance_type} ${p.song_title ? `— "${p.song_title}"` : "(Song name TBD)"}</p>
    `;
  });

  if (response.food_signup_id) {
    detailsHtml += `
      <p class="mt-2 pt-1.5 border-t border-slate-800/80"><strong class="text-emerald-400">🍽 Potluck Dish:</strong> Claimed item confirmed! Thanks for bringing food.</p>
    `;
  } else {
    detailsHtml += `
      <p class="mt-2 pt-1.5 border-t border-slate-800/80 text-amber-300">🍽 You skipped food sign-up. You can pick an open dish anytime from the Transparency Dashboard.</p>
    `;
  }

  detailsHtml += `</div>`;
  detailsBox.innerHTML = detailsHtml;

  modal.classList.remove("hidden");
  if (window.lucide) lucide.createIcons();
}

function showError(msg) {
  const errEl = document.getElementById("form-error");
  if (errEl) {
    errEl.textContent = msg;
    errEl.classList.remove("hidden");
  }
}

function hideError() {
  const errEl = document.getElementById("form-error");
  if (errEl) errEl.classList.add("hidden");
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
