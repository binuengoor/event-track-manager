// Food groups, name lookup, profile prefill, song duplicate warning.
// Classic script: shares globals with the other signup files (see load order in the page).

function renderFoodGroups() {
  const container = $("food-groups-container");
  const c = state.config;
  if (!container || !c) return;
  const selected = document.querySelector('input[name="food_item_id"]:checked')?.value || "";
  const me = $("performer-name").value.trim().toLowerCase();
  const groups = c.food_groups || [];
  const items = c.food_items || [];
  container.innerHTML = "";
  let open = 0;

  groups.forEach((group) => {
    const groupItems = items.filter((i) => i.group_id === group.group_id);
    if (!groupItems.length) return;
    const wrap = document.createElement("div");
    wrap.className = "gf-dish-group";
    const h = document.createElement("h4");
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
  $("selected-food-box").hidden = !document.querySelector('input[name="food_item_id"]:checked');
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

  if (exact && state.nameDecision !== key) {
    const ids = exact.ids;
    const n = ids.length;
    const detail = n === 0 ? "" : n === 1
      ? ` with one act (${ids[0]}${exact.titles[0] ? ", " + exact.titles[0] : ""})`
      : ` with ${n} acts (${ids.join(", ")})`;
    text.textContent = `${exact.name} is already signed up${detail}.`;
    const targets = ids.length ? ids : [""];
    targets.forEach((id) => {
      const a = document.createElement("a");
      a.className = "gf-btn gf-btn-small gf-btn-primary";
      a.href = `/my-entry?name=${encodeURIComponent(exact.name)}`;
      a.textContent = id ? `Edit ${id}` : "Edit my entry";
      actions.appendChild(a);
    });
    const no = document.createElement("button");
    no.type = "button";
    no.className = "gf-btn gf-btn-small";
    no.textContent = "No, new act";
    no.addEventListener("click", () => {
      state.nameDecision = key;
      box.hidden = true;
      prefillFromProfile(exact.name);
      $("contact-info").focus();
    });
    actions.appendChild(no);
    box.hidden = false;
    prefillFromProfile(exact.name);
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
