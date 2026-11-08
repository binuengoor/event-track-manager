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
    public_first_name_only: !isJunior() && Boolean($("public-first-name-only")?.checked),
    registration_type: choice === "dish" ? "food_only" : choice === "both" ? "both" : "performer",
    performances: [],
    food_signup: null,
  };
  if (choice !== "dish") {
    const t = currentType();
    const partner = $("partner-name").value.trim();
    const isDuet = t.toLowerCase() === "duet";
    const needsPartnerPhone = isDuet && (!findEntry(partner) || state.partnerSame === false);
    payload.performances.push({
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
    });
  }
  if (choice !== "perform" && food) {
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
  const act = request.performances[0];
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
  if (act) parts.push(`${act.song_title ? act.song_title + ", " : ""}${act.performance_type.toLowerCase()}`);
  if (hasDish) parts.push(state.lastResult?.dishName ? `dish: ${state.lastResult.dishName}` : "your dish is on the food board");
  const editsLocked = c.performer_edits_enabled === false;
  const tail = ids.length && !editsLocked ? " Keep this entry id; you can edit from My entry." : "";
  $("done-message").textContent = `Thank you, ${name}! You are signed up for ${eventLabel()}.${parts.length ? " " + parts.join("; ") + "." : ""}${tail}`;

  const upload = $("done-upload");
  const wantsTrack = Boolean(act) && !act.is_acoustic;
  const canUpload = wantsTrack && c.track_upload_enabled !== false;
  upload.hidden = !canUpload;
  $("done-uploads-closed").hidden = !(wantsTrack && c.track_upload_enabled === false);
  $("done-edits-locked").hidden = !editsLocked;
  upload.href = `/my-entry?name=${encodeURIComponent(name)}`;

  const canAddAct = performEnabled();
  $("done-add-act").hidden = !canAddAct;
  $("done-add-act-title").textContent = act ? "Add another act" : "Add an act";
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
  ["song-title", "movie-name", "stage-notes", "partner-name", "partner-phone", "dish-description"].forEach((id) => { $(id).value = ""; });
  $("acoustic").checked = false;
  $("song-dup-box").hidden = true;
  document.querySelectorAll('input[name="food_item_id"]').forEach((r) => { r.checked = false; });
  state.partnerSame = null;
  state.nameDecision = $("performer-name").value.trim().toLowerCase();
  $("name-lookup-box").hidden = true;
  const firstType = document.querySelector('input[name="perf_type"]');
  if (firstType) firstType.checked = true;
  syncPartnerUI();

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
