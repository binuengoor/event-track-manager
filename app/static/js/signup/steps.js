// Availability, entries and stepper.
// Classic script: shares globals with the other signup files (see load order in the page).

function performanceTypes() {
  const c = state.config || {};
  if (c.allow_duets === false) return ["Solo"];
  return c.performance_types || ["Solo", "Duet", "Group"];
}

function performEnabled() {
  const c = state.config || {};
  return c.signup_enabled !== false && c.stage_performances_enabled !== false;
}
function dishEnabled() {
  return (state.config || {}).food_signup_enabled !== false;
}

// registered_entries is the preferred source ({name, entry_id | entry_ids, song_title}); fall back to names only.
function normalizeEntries(c) {
  const byName = new Map();
  const add = (name, ids, titles) => {
    name = String(name || "").trim();
    if (!name) return;
    const key = name.toLowerCase();
    const rec = byName.get(key) || { name, ids: [], titles: [] };
    ids.filter(Boolean).forEach((id) => { if (!rec.ids.includes(id)) rec.ids.push(id); });
    titles.filter(Boolean).forEach((t) => rec.titles.push(t));
    byName.set(key, rec);
  };
  if (Array.isArray(c.registered_entries)) {
    c.registered_entries.forEach((e) => {
      if (typeof e === "string") return add(e, [], []);
      const ids = Array.isArray(e.entry_ids) ? e.entry_ids : [e.entry_id];
      const titles = Array.isArray(e.song_titles) ? e.song_titles : [e.song_title];
      add(e.performer_name || e.name, ids, titles);
    });
  }
  (c.registered_performers || []).forEach((n) => add(n, [], []));
  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function findEntry(name) {
  const key = String(name || "").trim().toLowerCase();
  return key ? state.entries.find((e) => e.name.toLowerCase() === key) : null;
}

// ---------------------------------------------------------------------------------------------- availability and steps
function applyAvailability() {
  const perform = performEnabled();
  const dish = dishEnabled();
  const closed = !perform && !dish;
  $("signup-closed-banner").hidden = !closed;
  $("signup-form").hidden = closed;

  const choices = { perform: perform, dish: dish, both: perform && dish };
  Object.entries(choices).forEach(([k, on]) => {
    $(`choice-${k}-label`).hidden = !on;
    const input = document.querySelector(`input[name="signup_choice"][value="${k}"]`);
    if (input) input.disabled = !on;
  });
  // Only one possible choice: no chooser, just the matching heading.
  const available = Object.keys(choices).filter((k) => choices[k]);
  $("choice-section").hidden = available.length <= 1;
  const wanted = new URLSearchParams(location.search).get("choice");  // home page "Bring a dish" link
  if (wanted && choices[wanted] && !state.choiceFromUrlApplied) { state.choiceFromUrlApplied = true; setChoice(wanted); }
  else if (!choices[state.choice] && available.length) setChoice(available[0]);

  const title = $("signup-banner-title");
  const desc = $("signup-banner-desc");
  if (closed) {
    title.textContent = "Sign-up status";
    desc.textContent = "Sign-ups are closed.";
  } else if (perform && !dish) {
    title.textContent = "Sign up to perform";
    desc.textContent = "Register your song for the stage lineup.";
  } else if (dish && !perform) {
    title.textContent = "Bring a dish";
    desc.textContent = "Choose a dish to share at the potluck. One sign-up per family is enough.";
  } else {
    title.textContent = "Sign up";
    desc.textContent = "Perform on stage, bring a dish, or both. It takes about a minute.";
  }
  state.baseTitle = title.textContent;
  // Links on the closed card only show when the matching page is in the site navigation.
  document.querySelectorAll("[data-needs-nav]").forEach((el) => {
    el.hidden = !document.querySelector(`.guest-navigation a[href="${el.dataset.needsNav}"]`);
  });
  syncChoiceUI();
}

// Dish-only sign-ups are one page (name, phone, dish); every other choice is a stepper.
function singlePage() { return state.choice === "dish"; }

function steps() { return STEP_SEQUENCE[state.choice] || STEP_SEQUENCE.perform; }

function setChoice(value) {
  state.choice = value;
  const input = document.querySelector(`input[name="signup_choice"][value="${value}"]`);
  if (input) input.checked = true;
  syncChoiceUI();
}

function syncChoiceUI() {
  const wantsAct = state.choice !== "dish";
  if (state.baseTitle === "Sign up") {
    $("signup-banner-title").textContent = state.choice === "dish" ? "Bring a dish" : "Sign up";
  }
  $("age-group-wrap").hidden = !wantsAct;
  updateGuardian();
  $("performer-name-label").textContent = state.choice === "dish" ? "Your name or family name" : "Your name";
  if (state.step >= steps().length || singlePage()) state.step = 0;
  showStep();
}

function showStep() {
  const seq = steps();
  const single = singlePage();
  document.querySelectorAll("[data-step]").forEach((el) => {
    el.hidden = single ? !seq.includes(el.dataset.step) : el.dataset.step !== seq[state.step];
  });
  $("signup-form").classList.toggle("is-single", single);
  const last = single || state.step === seq.length - 1;
  $("back-btn").hidden = state.step === 0;
  $("home-link").hidden = state.step !== 0;
  const nextKey = seq[state.step + 1];
  $("submit-btn-text").textContent = last
    ? "Submit"
    : (nextKey === "act" ? "Continue to your song" : "Continue to dish");
  const current = seq[state.step];
  $("step-status").textContent = single ? "" : `Step ${state.step + 1} of ${seq.length} · ${STEP_LABELS[current]}`;
  const onDish = single || current === "dish";
  $("skip-dish-btn").hidden = !(state.choice === "both" && current === "dish");
  $("add-song-btn").hidden = !(single && performEnabled());
  if (onDish) renderFoodGroups();
  renderStepper();
  hideFormError();
  syncBarNotes();
  refreshErrorSummary();
}

// Small notes under the primary button: the upload hint (song step) and the picked dish (dish step).
function syncBarNotes() {
  const seq = steps();
  const onAct = !singlePage() && seq[state.step] === "act";
  const onDish = singlePage() || seq[state.step] === "dish";
  $("upload-hint").hidden = !onAct || $("acoustic").checked;
  const picked = document.querySelector('input[name="food_item_id"]:checked');
  const note = $("dish-selected-note");
  note.hidden = !(onDish && picked);
  if (picked) note.textContent = `${picked.dataset.name || "Your dish"} selected. You can change it later in My entry.`;
}

function renderStepper() {
  const ol = $("stepper");
  const n = singlePage() ? 1 : steps().length;
  ol.innerHTML = "";
  for (let i = 0; i < n; i++) {
    const li = document.createElement("li");
    li.dataset.state = i < state.step ? "done" : i === state.step ? "current" : "todo";
    ol.appendChild(li);
  }
}

function goToStep(key) {
  const idx = steps().indexOf(key);
  if (idx >= 0) { state.step = singlePage() ? 0 : idx; showStep(); }
}
