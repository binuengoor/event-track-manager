// Food groups, name lookup, profile prefill, song duplicate warning.
// Classic script: shares globals with the other signup files (see load order in the page).

let selectedFoodCategoryId = "all";

function renderFoodGroups() {
  const container = $("food-groups-container");
  const filterContainer = $("food-category-filters");
  const c = state.config;
  if (!container || !c) return;
  const selected = document.querySelector('input[name="food_item_id"]:checked')?.value || "";
  const me = $("performer-name").value.trim().toLowerCase();
  const groups = c.food_groups || [];
  const items = c.food_items || [];
  const groupsWithItems = groups.filter(group => items.some(item => item.group_id === group.group_id));
  if (!groupsWithItems.some(group => group.group_id === selectedFoodCategoryId)) selectedFoodCategoryId = "all";
  if (filterContainer) {
    filterContainer.innerHTML = "";
    filterContainer.hidden = groupsWithItems.length < 2;
    if (groupsWithItems.length >= 2) {
      [{group_id: "all", name: "All"}, ...groupsWithItems].forEach(group => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "su-food-filter";
        button.dataset.groupId = String(group.group_id);
        button.textContent = group.name;
        button.setAttribute("aria-pressed", String(group.group_id === selectedFoodCategoryId));
        button.addEventListener("click", () => {
          selectedFoodCategoryId = group.group_id;
          renderFoodGroups();
          const replacement = Array.from(filterContainer.children)
            .find(candidate => candidate.dataset.groupId === String(group.group_id));
          replacement?.focus();
        });
        filterContainer.appendChild(button);
      });
    }
  }
  container.innerHTML = "";
  let open = 0;

  groups.forEach((group) => {
    const groupItems = items.filter((i) => i.group_id === group.group_id);
    if (!groupItems.length) return;
    const wrap = document.createElement("div");
    wrap.className = "gf-dish-group";
    wrap.hidden = selectedFoodCategoryId !== "all" && group.group_id !== selectedFoodCategoryId;
    const h = document.createElement("h3");
    const gName = document.createElement("span");
    gName.textContent = group.name;
    const gCount = document.createElement("span");
    gCount.textContent = `${groupItems.filter((i) => !i.is_taken).length} open`;
    h.append(gName, gCount);
    wrap.appendChild(h);
    const grid = document.createElement("div");
    grid.className = "gf-dish-grid";

    groupItems.forEach((item) => {
      const taken = Boolean(item.is_taken);
      const mine = taken && me && String(item.signer_name || "").trim().toLowerCase() === me;
      const row = document.createElement(taken ? "div" : "label");
      row.className = "gf-dish" + (taken ? " is-taken" : "");
      const name = document.createElement("span");
      name.className = "gf-dish-name";
      const tag = document.createElement("span");
      tag.className = "gf-dish-tag " + (mine ? "yours" : taken ? "taken" : "open");
      tag.textContent = mine ? "Yours" : taken ? "Taken" : "Open";
      if (!taken) {
        open += 1;
        const input = document.createElement("input");
        input.type = "radio";
        input.name = "food_item_id";
        input.value = item.item_id;
        input.dataset.name = item.name;
        input.checked = item.item_id === selected;
        name.appendChild(input);
      }
      const text = document.createElement("span");
      text.textContent = item.name;
      name.appendChild(text);
      if (taken && !mine && item.signer_name) {
        const who = document.createElement("span");
        who.className = "gf-dish-who";
        who.textContent = item.signer_name;
        text.appendChild(who);
      }
      row.append(name, tag);
      grid.appendChild(row);
    });
    wrap.appendChild(grid);
    container.appendChild(wrap);
  });

  $("food-open-count").textContent = `${open} slot${open === 1 ? "" : "s"} still open.`;
  if (!groups.length) {
    const p = document.createElement("p");
    p.className = "gf-muted";
    p.textContent = "No dishes are listed yet. Check back soon.";
    container.appendChild(p);
  }
  const selectedInput = document.querySelector('input[name="food_item_id"]:checked');
  $("selected-food-box").hidden = !selectedInput || Boolean(state.useFamilyDish);
  const selectionNote = $("food-filter-selection-note");
  if (selectionNote) {
    const selectedItem = items.find(item => item.item_id === selected);
    const selectedGroup = selectedItem && groups.find(group => group.group_id === selectedItem.group_id);
    const filteredOut = selectedGroup && selectedFoodCategoryId !== "all" && selectedGroup.group_id !== selectedFoodCategoryId;
    selectionNote.hidden = !filteredOut;
    selectionNote.textContent = filteredOut ? `Selected: ${selectedItem.name} (${selectedGroup.name}). It remains selected.` : "";
  }
  renderFamilyDishUI();
}

function renderFamilyDishUI() {
  const c = state.config || {};
  const groups = c.food_groups || [];
  const items = c.food_items || [];
  const groupNames = Object.fromEntries(groups.map(g => [g.group_id, g.name]));
  const takenItems = items.filter(it => it.is_taken);

  const banner = $("family-dish-banner");
  const toggleBtn = $("family-dish-toggle-btn");
  const box = $("family-dish-box");
  const select = $("family-dish-select");
  const last4Box = $("family-dish-last4-box");
  const openFieldset = $("food-open-fieldset");
  const openIntro = $("food-open-intro");
  if (!select || !box || !toggleBtn || !banner) return;

  const prevVal = select.value;
  select.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = takenItems.length ? "-- Select a claimed dish --" : "No claimed dishes yet";
  select.appendChild(placeholder);

  takenItems.forEach(item => {
    const opt = document.createElement("option");
    opt.value = item.item_id;
    const grp = groupNames[item.group_id] || "Dish";
    const signerLabel = item.signer_name ? " — " + item.signer_name : "";
    opt.textContent = `[${grp}] ${item.name}${signerLabel}`;
    opt.dataset.name = item.name;
    select.appendChild(opt);
  });

  const matchedId = state.familyDish?.item_id || "";
  if (matchedId && takenItems.some(it => it.item_id === matchedId)) {
    select.value = matchedId;
  } else if (prevVal && takenItems.some(it => it.item_id === prevVal)) {
    select.value = prevVal;
  }

  const hasMatched = Boolean(state.familyDish && state.familyDish.autoMatched && takenItems.some(it => it.item_id === state.familyDish.item_id));
  if (hasMatched) {
    const d = state.familyDish;
    const who = d.signer_name || "Your family";
    $("family-dish-banner-text").textContent = `${who} already signed up for ${d.item_name}. Use your family's dish, or pick a different dish below.`;
    banner.hidden = false;
    $("family-dish-use-btn").hidden = Boolean(state.useFamilyDish);
    $("family-dish-change-btn").hidden = !state.useFamilyDish;
  } else {
    banner.hidden = true;
  }

  const usingFamily = Boolean(state.useFamilyDish) && takenItems.length > 0;
  if (openFieldset) openFieldset.hidden = usingFamily;
  if (openIntro) openIntro.hidden = usingFamily;
  if ($("selected-food-box") && usingFamily) $("selected-food-box").hidden = true;
  box.hidden = !usingFamily;
  toggleBtn.hidden = usingFamily || !takenItems.length || state.choice === "dish";

  const isAutoMatchedSelection = hasMatched && select.value === state.familyDish.item_id;
  if (last4Box) last4Box.hidden = !usingFamily || isAutoMatchedSelection;
}

// ---------------------------------------------------------------------------------------------- name lookup
function updateNameLookup() {
  const raw = $("performer-name").value.trim();
  const box = $("name-lookup-box");
  const text = $("name-lookup-text");
  const actions = $("name-lookup-actions");
  actions.innerHTML = "";
  const key = raw.toLowerCase();

  if (raw.length < 3) { box.hidden = true; return; }
  const exact = findEntry(raw);

  if (exact && exact.ids.length && state.choice !== "dish") {
    const ids = exact.ids;
    const n = ids.length;
    const detail = n === 0 ? "" : n === 1
      ? ` with one act (${ids[0]}${exact.titles[0] ? ", " + exact.titles[0] : ""})`
      : ` with ${n} acts (${ids.join(", ")})`;
    text.textContent = `${exact.name} is already signed up${detail}. No need to sign up again: open My Entry to add another song or change details.`;
    [ids[0]].forEach((id) => {
      const a = document.createElement("a");
      a.className = "gf-btn gf-btn-small gf-btn-primary";
      a.href = `/my-entry?name=${encodeURIComponent(exact.name)}`;
      a.textContent = "Open My Entry";
      actions.appendChild(a);
    });
    box.hidden = false;
    return;
  }

  if (!exact) {
    // Partial matches: offer to fill the full registered name.
    const partial = state.entries.filter((e) => e.name.toLowerCase().includes(key)).slice(0, 4);
    if (partial.length) {
      text.textContent = "Already signed up? Tap your name:";
      partial.forEach((e) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "gf-btn gf-btn-small";
        b.textContent = e.name;
        b.addEventListener("click", () => {
          $("performer-name").value = e.name;
          setErr("performer-name", "");
          updateNameLookup();
          $("performer-name").focus();
        });
        actions.appendChild(b);
      });
      box.hidden = false;
      return;
    }
  }
  box.hidden = true;
}

// A public profile does not expose contact details or age. Ask the returning
// person to choose their own age group instead of guessing the adult default.
async function prefillFromProfile(name) {
  const key = name.trim().toLowerCase();
  if (state.profileChecked === key) return;
  state.profileChecked = key;
  document.querySelectorAll('input[name="age_group"]').forEach((radio) => { radio.checked = false; });
  state.ageGroup = null;
  updateGuardian();
  try {
    const res = await fetch(`/api/performer/profile?name=${encodeURIComponent(name)}`);
    if (res.status === 409 && $("performer-name").value.trim().toLowerCase() === key) {
      setErr("performer-name", "This display name matches more than one person. Please contact an organizer.");
    }
  } catch (e) {
    console.warn("Profile lookup failed:", e);
  }
}

// ---------------------------------------------------------------------------------------------- song duplicate hint
function isPlaceholderSong(title) {
  const t = String(title || "").trim().toLowerCase();
  if (!t) return true;
  if (["tbd", "tba", "to be decided", "to be announced", "test", "testing", "n/a", "na", "none", "unknown", "missing", "pending", "null", "untitled"].includes(t)) return true;
  if (t.includes("song title missing")) return true;
  return /^(performance|song)\s*(?:#?\d+)?$/i.test(t);
}

function findDuplicateSong(title) {
  const clean = String(title || "").trim().toLowerCase();
  if (clean.length < 3 || isPlaceholderSong(clean)) return null;
  for (const s of (state.config?.existing_songs || [])) {
    const existing = String(s.song_title || "").trim().toLowerCase();
    if (!existing || isPlaceholderSong(existing)) continue;
    if (existing === clean || (clean.length >= 4 && (existing.includes(clean) || clean.includes(existing)))) return s;
  }
  return null;
}

function updateSongWarning() {
  const box = $("song-dup-box");
  const dup = findDuplicateSong($("song-title").value);
  box.innerHTML = "";
  if (!dup) { box.hidden = true; return; }
  const singer = dup.partner_name ? `${dup.performer_name} & ${dup.partner_name}` : dup.performer_name;
  const strong1 = document.createElement("strong");
  strong1.textContent = `"${dup.song_title}"`;
  const strong2 = document.createElement("strong");
  strong2.textContent = singer;
  box.append("Song already chosen: ", strong1, " is taken by ", strong2, ` (${dup.performance_type || "Solo"}). You can still keep it.`);
  box.hidden = false;
}
