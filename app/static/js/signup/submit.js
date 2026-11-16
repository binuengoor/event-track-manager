// Submit, done card, restart, refresh.
// Classic script: shares globals with the other signup files (see load order in the page).

async function handleSubmit(e) {
  e.preventDefault();
  hideFormError();
  const seq = steps();
  const key = seq[state.step];

  if (singlePage()) {
    // Dish-only sign-up: one page, so check every section before sending.
    const results = seq.map((k) => VALIDATORS[k]());
    if (results.every(Boolean)) await submitSignup();
    else if (!results[results.length - 1]) $("food-groups-container").querySelector("input")?.focus();
    return;
  }
  if (!VALIDATORS[key]()) return;
  if (state.step < seq.length - 1) {
    state.step += 1;
    showStep();
    window.scrollTo({ top: 0 });
    return;
  }
  // Final step: re-check earlier steps so nothing slips through.
  for (const k of seq.slice(0, -1)) {
    if (!VALIDATORS[k]()) { goToStep(k); return; }
  }
  await submitSignup();
}

// The act currently shown in the form.
function readCurrentAct() {
  const t = currentType();
  const partner = $("partner-name").value.trim();
  const isDuet = t.toLowerCase() === "duet";
  const needsPartnerPhone = isDuet && (!findEntry(partner) || state.partnerSame === false);
  return {
    performance_type: t,
    partner_name: partner || null,
    partner_same_person: isDuet && findEntry(partner) ? state.partnerSame : null,
    partner_age_group: needsPartnerPhone ? (document.querySelector('input[name="partner_age_group"]:checked')?.value || null) : null,
    partner_phone: needsPartnerPhone ? $("partner-phone").value.trim() : "",
    partner_guardian_name: needsPartnerPhone && partnerNeedsGuardian() ? $("partner-guardian-name").value.trim() : "",
    partner_guardian_phone: needsPartnerPhone && partnerNeedsGuardian() ? $("partner-guardian-phone").value.trim() : "",
    song_title: $("song-title").value.trim(),
    movie_name: $("movie-name").value.trim(),
    stage_notes: $("stage-notes").value.trim(),
    is_acoustic: $("acoustic").checked,
  };
}

// After "Add another song" the form is empty again; an untouched empty form is not sent as an extra song.
function currentActIsBlank() {
  const a = readCurrentAct();
  return !a.song_title && !a.movie_name && !a.stage_notes && !a.partner_name && !a.is_acoustic;
}

function allActs() {
  return state.acts.length && currentActIsBlank() ? [...state.acts] : [...state.acts, readCurrentAct()];
}

function maxSongs() { return parseInt((state.config || {}).max_performances_per_participant, 10) || 2; }
function maxSolos() {
  const v = parseInt((state.config || {}).max_solo_per_participant, 10);
  return Number.isNaN(v) ? 1 : v;
}
function soloCount(list) { return list.filter((a) => (a.performance_type || "").toLowerCase() === "solo").length; }

function resetActFields() {
  ["song-title", "movie-name", "stage-notes", "partner-name", "partner-phone"].forEach((id) => { $(id).value = ""; });
  $("acoustic").checked = false;
  $("song-dup-box").hidden = true;
  state.partnerSame = null;
  const firstType = document.querySelector('input[name="perf_type"]');
  if (firstType) firstType.checked = true;
  syncPartnerUI();
}

// Songs added so far (chips with Remove) and the "Add another song" button with its limit note.
function renderAddedActs() {
  const list = $("added-acts-list");
  list.innerHTML = "";
  state.acts.forEach((act, i) => {
    const li = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = `${i + 1}. ${act.song_title || "Song to be decided"} (${act.performance_type.toLowerCase()}${act.partner_name ? " with " + act.partner_name : ""})`;
    const rm = document.createElement("button");
    rm.type = "button";
    rm.textContent = "Remove";
    rm.setAttribute("aria-label", `Remove song ${i + 1}`);
    rm.addEventListener("click", () => { state.acts.splice(i, 1); renderAddedActs(); });
    li.append(label, rm);
    list.appendChild(li);
  });
  $("added-acts").hidden = !state.acts.length;
  $("added-acts-title").textContent = `Songs added so far. You are now adding song ${state.acts.length + 1} of ${maxSongs()}.`;
  const btn = $("add-another-song-btn");
  const note = $("add-another-song-note");
  const queued = state.acts.length + 1;            // added songs plus the one in the form
  const wantsAct = state.choice !== "dish" && performEnabled();
  // Event limits: total songs and solos. Solo is greyed out once the added songs use up the solo allowance.
  const soloFull = soloCount(state.acts) >= maxSolos();
  const soloRadio = Array.from(document.querySelectorAll('input[name="perf_type"]')).find((r) => r.value.toLowerCase() === "solo");
  if (soloRadio) {
    soloRadio.disabled = soloFull;
    soloRadio.closest("label")?.classList.toggle("is-disabled", soloFull);
    if (soloFull && soloRadio.checked) {
      const other = Array.from(document.querySelectorAll('input[name="perf_type"]')).find((r) => r !== soloRadio);
      if (other) { other.checked = true; syncPartnerUI(); }
    }
  }
  const othersAllowed = performanceTypes().some((t) => t.toLowerCase() !== "solo");
  const nextSolos = soloCount([...state.acts, readCurrentAct()]);
  const room = queued < maxSongs() && (nextSolos < maxSolos() || othersAllowed);
  btn.hidden = !(wantsAct && room);
  $("add-another-song-label").textContent = `Add another song (you have ${queued} of ${maxSongs()})`;
  note.hidden = !wantsAct;
  const soloNote = maxSolos() < maxSongs() ? ` (at most ${maxSolos()} solo)` : "";
  note.textContent = room
    ? `You can sign up for up to ${maxSongs()} songs${soloNote}. Add them all now, or add more later in My Entry.`
    : `This is song ${queued} of ${maxSongs()}, the most allowed per person${soloNote}.`;
}

// Saves the song in the form to the list and clears the form for the next one.
function addAnotherSong() {
  if (!VALIDATORS.act()) return;
  const act = readCurrentAct();
  if (state.acts.length + 1 >= maxSongs()) return;
  state.acts.push(act);
  resetActFields();
  renderAddedActs();
  $("song-title").focus();
}

function buildPayload() {
  const choice = state.choice;
  const name = $("performer-name").value.trim();
  const food = document.querySelector('input[name="food_item_id"]:checked');
  const payload = {
    performer_name: name,
    contact_info: $("contact-info").value.trim(),
    age_group: choice === "dish" ? "" : (document.querySelector('input[name="age_group"]:checked')?.value || ""),
    guardian_name: isJunior() ? $("guardian-name").value.trim() : "",
    guardian_phone: isJunior() ? $("guardian-phone").value.trim() : "",
    registration_type: choice === "dish" ? "food_only" : choice === "both" ? "both" : "performer",
    performances: [],
    food_signup: null,
  };
  if (choice !== "dish") payload.performances = allActs();
  if (dishEnabled() && food) {
    payload.food_signup = { item_id: food.value, dish_description: $("dish-description").value.trim() };
  }
  return payload;
}

// Step 3 is optional for "Both": skipping it signs up to perform only.
async function skipDish() {
  for (const k of ["about", "act"]) {
    if (!VALIDATORS[k]()) { goToStep(k); return; }
  }
  document.querySelectorAll('input[name="food_item_id"]').forEach((r) => { r.checked = false; });
  setChoice("perform");
  state.step = steps().length - 1;
  showStep();
  await submitSignup();
}

async function submitSignup() {
  const payload = buildPayload();
  const btn = $("submit-btn");
  const text = $("submit-btn-text");
  const label = text.textContent;
  btn.disabled = true;
  text.textContent = "Signing you up...";
  try {
    const res = await fetch("/api/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    let data = {};
    try { data = await res.json(); } catch (_) { /* non-JSON error body */ }
    if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Sign-up did not go through. Please try again.");
    state.lastResult = { response: data, request: payload, dishName: document.querySelector('input[name="food_item_id"]:checked')?.dataset.name || "" };
    try { localStorage.setItem(NAME_KEY, payload.performer_name); } catch (_) { /* private mode */ }
    showDone(data, payload);
  } catch (err) {
    showFormError(err.message || "Sign-up did not go through. Please try again.");
  } finally {
    btn.disabled = false;
    text.textContent = label;
  }
}

// ---------------------------------------------------------------------------------------------- done card
function eventLabel() {
  const c = state.config || {};
  return c.event_name || c.header_brand_title || "the event";
}

function showDone(response, request) {
  const c = state.config || {};
  const name = response.performer_name || request.performer_name;
  const ids = response.entry_ids || [];
  const acts = request.performances || [];
  const hasDish = Boolean(response.food_signup_id || request.food_signup);

  $("signup-form").hidden = true;
  const done = $("signup-done");
  done.hidden = false;

  const idBox = $("done-entry-ids");
  idBox.innerHTML = "";
  ids.forEach((id) => {
    const s = document.createElement("span");
    s.className = "gf-entry-id";
    s.textContent = id;
    idBox.appendChild(s);
    idBox.appendChild(document.createTextNode(" "));
  });

  const parts = [];
  acts.forEach((act) => parts.push(`${act.song_title ? act.song_title + ", " : ""}${act.performance_type.toLowerCase()}`));
  if (hasDish) parts.push(state.lastResult?.dishName ? `dish: ${state.lastResult.dishName}` : "your dish is on the food board");
  const editsLocked = c.performer_edits_enabled === false;
  const tail = ids.length && !editsLocked ? " Keep this entry id; you can edit from My entry." : "";
  $("done-message").textContent = `Thank you, ${name}! You are signed up for ${eventLabel()}.${parts.length ? " " + parts.join("; ") + "." : ""}${tail}`;

  const upload = $("done-upload");
  const wantsTrack = acts.some((act) => !act.is_acoustic);
  const canUpload = wantsTrack && c.track_upload_enabled !== false;
  upload.hidden = !canUpload;
  $("done-uploads-closed").hidden = !(wantsTrack && c.track_upload_enabled === false);
  $("done-edits-locked").hidden = !editsLocked;
  upload.href = `/my-entry?name=${encodeURIComponent(name)}`;

  const canAddAct = performEnabled() && acts.length && ids.length < maxSongs();
  $("done-add-act").hidden = !canAddAct;
  $("done-add-act").href = `/my-entry?name=${encodeURIComponent(name)}`;
  state.acts = [];
  $("done-add-dish").hidden = !(dishEnabled() && !hasDish);

  const pay = $("done-payment");
  if (c.payment_url && c.payment_enabled !== false) {
    $("done-payment-link").href = c.payment_url;
    pay.hidden = false;
  } else {
    pay.hidden = true;
  }
  window.scrollTo({ top: 0 });
  done.focus();
}

// Reset the form for another act or a dish. Name, phone, age group and guardian stay.
async function restartForm(choice) {
  resetActFields();
  $("dish-description").value = "";
  document.querySelectorAll('input[name="food_item_id"]').forEach((r) => { r.checked = false; });
  state.acts = [];
  $("name-lookup-box").hidden = true;

  $("signup-done").hidden = true;
  $("signup-form").hidden = false;
  setChoice(choice);
  await refreshConfig();
  goToStep(choice === "dish" ? "dish" : "act");
  window.scrollTo({ top: 0 });
}

// Refresh registered names and dish availability without wiping what the guest typed.
async function refreshConfig() {
  try {
    const res = await fetch("/api/signup/config");
    if (!res.ok) return;
    state.config = await res.json();
    state.entries = normalizeEntries(state.config);
    renderPartnerDatalist();
    renderFoodGroups();
  } catch (e) {
    console.warn("Could not refresh sign-up settings:", e);
  }
}
