// Guest sign-up: one progressive form (About you -> Your act -> Dish), then a "what next" card.
// Choices: Perform / Bring a dish / Both. Backend: POST /api/signup (registration_type performer | food_only | both).
const NAME_KEY = "etm_guest_name";
const STEP_LABELS = { about: "About you", act: "Your song", dish: "Dish" };
const STEP_SEQUENCE = { perform: ["about", "act"], dish: ["about", "dish"], both: ["about", "act", "dish"] };

const state = {
  config: null,
  choice: "perform",
  step: 0,
  ageGroup: null,
  entries: [],            // normalised registered entries: {name, ids[], titles[]}
  nameDecision: "",       // lower-case name for which the user chose "No, new act"
  profileChecked: "",     // lower-case name already looked up for phone pre-fill
  partnerSame: null,      // true / false / null (not answered or no match)
  lastResult: null,
};

const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", async () => {
  if (window.lucide) lucide.createIcons();
  bindEvents();
  await loadSignupConfig();
  renderStepper();
});

// ---------------------------------------------------------------------------------------------- config
async function loadSignupConfig() {
  try {
    const res = await fetch("/api/signup/config");
    if (!res.ok) throw new Error("Failed to load registration configuration");
    state.config = await res.json();
    window.auroraEffect?.setActive(true, 1200);
    const c = state.config;

    const brand = c.header_brand_title || c.event_name;
    if (brand) {
      const titleEl = $("nav-event-title");
      if (titleEl) titleEl.textContent = c.header_brand_title || brand;
      document.title = `Sign up - ${brand}`;
    }
    if (c.header_brand_subtitle) {
      const subEl = $("nav-event-subtitle");
      if (subEl) subEl.textContent = c.header_brand_subtitle;
    }
    if (c.food_serving_note) $("food-serving-note-text").textContent = c.food_serving_note;

    state.entries = normalizeEntries(c);
    renderAgeGroups(c.age_groups || []);
    renderPerformanceTypes(performanceTypes());
    renderPartnerAgeGroups(c.age_groups || []);
    renderPartnerDatalist();
    renderFoodGroups();
    applyAvailability();
    window.adaptNavigationForEventConfig?.(c);
    if (window.lucide) lucide.createIcons();
  } catch (err) {
    console.error("Config load error:", err);
    showFormError("Could not load sign-up settings. Please refresh the page.");
  }
}

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
  if (!choices[state.choice] && available.length) setChoice(available[0]);

  const title = $("signup-banner-title");
  const desc = $("signup-banner-desc");
  if (closed) {
    title.textContent = "Sign up";
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
  syncChoiceUI();
}

function steps() { return STEP_SEQUENCE[state.choice] || STEP_SEQUENCE.perform; }

function setChoice(value) {
  state.choice = value;
  const input = document.querySelector(`input[name="signup_choice"][value="${value}"]`);
  if (input) input.checked = true;
  syncChoiceUI();
}

function syncChoiceUI() {
  const wantsAct = state.choice !== "dish";
  $("age-group-wrap").hidden = !wantsAct;
  updateGuardian();
  $("performer-name-label").textContent = state.choice === "dish" ? "Your name or family name" : "Your name";
  if (state.step >= steps().length) state.step = 0;
  showStep();
}

function showStep() {
  const seq = steps();
  document.querySelectorAll("[data-step]").forEach((el) => { el.hidden = el.dataset.step !== seq[state.step]; });
  const last = state.step === seq.length - 1;
  $("back-btn").hidden = state.step === 0;
  const nextKey = seq[state.step + 1];
  $("submit-btn-text").textContent = last
    ? (seq.length === 1 ? "Sign up" : "Complete sign-up")
    : (nextKey === "act" ? "Continue to your song" : "Continue to dish");
  $("step-status").textContent = `Step ${state.step + 1} of ${seq.length} · ${STEP_LABELS[seq[state.step]]}`;
  if (seq[state.step] === "dish") renderFoodGroups();
  renderStepper();
  hideFormError();
}

function renderStepper() {
  const ol = $("stepper");
  const n = steps().length;
  ol.innerHTML = "";
  for (let i = 0; i < n; i++) {
    const li = document.createElement("li");
    li.dataset.state = i < state.step ? "done" : i === state.step ? "current" : "todo";
    ol.appendChild(li);
  }
}

function goToStep(key) {
  const idx = steps().indexOf(key);
  if (idx >= 0) { state.step = idx; showStep(); }
}

// ---------------------------------------------------------------------------------------------- rendering helpers
function makeRadio(name, value, label, desc, checked) {
  const l = document.createElement("label");
  l.className = "gf-radio";
  const input = document.createElement("input");
  input.type = "radio";
  input.name = name;
  input.value = value;
  input.checked = Boolean(checked);
  const span = document.createElement("span");
  span.textContent = label;
  l.append(input, span);
  if (desc) {
    const small = document.createElement("small");
    small.textContent = desc;
    l.appendChild(small);
  }
  return { label: l, input };
}

function renderAgeGroups(groups) {
  const box = $("age-group-options");
  box.innerHTML = "";
  state.ageGroup = null;
  // Start on the first group that needs no guardian (an adult), so the guardian block stays closed until chosen.
  const defIdx = Math.max(0, groups.findIndex((g) => !g.requires_guardian));
  groups.forEach((ag, idx) => {
    const { label, input } = makeRadio("age_group", ag.name, ag.name, ag.description || ag.hint || "", idx === defIdx);
    if (idx === defIdx) state.ageGroup = ag;
    input.addEventListener("change", () => {
      state.ageGroup = ag;
      updateGuardian();
      setErr("age-group", "");
    });
    box.appendChild(label);
  });
  updateGuardian();
}

function isJunior() {
  return state.choice !== "dish" && Boolean(state.ageGroup && state.ageGroup.requires_guardian);
}

function updateGuardian() {
  const box = $("guardian-container");
  const show = isJunior();
  box.hidden = !show;
  if (!show) {
    $("guardian-name").value = "";
    $("guardian-phone").value = "";
    setErr("guardian-name", "");
    setErr("guardian-phone", "");
  }
}

function renderPerformanceTypes(types) {
  const box = $("perf-type");
  box.innerHTML = "";
  types.forEach((t, i) => {
    const { label, input } = makeRadio("perf_type", t, t, "", i === 0);
    input.addEventListener("change", syncPartnerUI);
    box.appendChild(label);
  });
  $("perf-type-wrap").hidden = types.length <= 1;
  syncPartnerUI();
}

function renderPartnerAgeGroups(groups) {
  const box = $("partner-age-options");
  box.innerHTML = "";
  const list = groups && groups.length ? groups : [{ name: "Adult" }, { name: "Junior" }];
  // Default to the group that does not need a guardian (an adult) when we can tell.
  const def = list.findIndex((g) => !g.requires_guardian);
  list.forEach((ag, idx) => {
    const { label } = makeRadio("partner_age_group", ag.name, ag.name, ag.description || "", idx === (def < 0 ? 0 : def));
    box.appendChild(label);
  });
}

function renderPartnerDatalist() {
  const dl = $("partner-names");
  dl.innerHTML = "";
  state.entries.forEach((e) => {
    const o = document.createElement("option");
    o.value = e.name;
    dl.appendChild(o);
  });
}

function currentType() {
  return document.querySelector('input[name="perf_type"]:checked')?.value || "Solo";
}

function syncPartnerUI() {
  const t = currentType().toLowerCase();
  const box = $("partner-box");
  const hasPartner = t === "duet" || t === "group";
  box.hidden = !hasPartner;
  $("partner-label").textContent = t === "group" ? "Group members (separate names with commas)" : "Partner name";
  $("partner-name").placeholder = t === "group" ? "e.g. Alice, Bob, Charlie" : "Partner's full name";
  if (!hasPartner) {
    $("partner-name").value = "";
    $("partner-phone").value = "";
    state.partnerSame = null;
  }
  updatePartnerMatch();
}

// Duet partner: exact match with someone already signed up asks "Same person?"
function updatePartnerMatch() {
  const duet = currentType().toLowerCase() === "duet";
  const name = $("partner-name").value.trim();
  const match = duet ? findEntry(name) : null;
  const matchBox = $("partner-match-box");
  const newBox = $("partner-new-box");

  if (!duet || !name) {
    matchBox.hidden = true;
    newBox.hidden = true;
    state.partnerSame = null;
    return;
  }
  if (match) {
    const ids = match.ids.length ? ` (${match.ids.join(", ")})` : "";
    $("partner-match-text").textContent = `${match.name} is already signed up${ids}. Same person?`;
    matchBox.hidden = false;
    if (state.partnerSame === false) {
      $("partner-new-note").textContent = `Got it. This is a different ${match.name}, so we need their phone.`;
    }
    newBox.hidden = state.partnerSame !== false;
  } else {
    matchBox.hidden = true;
    state.partnerSame = null;
    $("partner-new-note").textContent = "We need your partner's phone so the organizers can reach them.";
    newBox.hidden = false;
  }
}

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

// Phone (and age group) pre-fill goes through the existing exact-name profile API only.
async function prefillFromProfile(name) {
  const key = name.trim().toLowerCase();
  if (state.profileChecked === key) return;
  state.profileChecked = key;
  try {
    const res = await fetch(`/api/performer/profile?name=${encodeURIComponent(name)}`);
    if (!res.ok) return;
    const data = await res.json();
    const perf = (data.performances || []).find((p) => (p.performer_name || "").trim().toLowerCase() === key) || (data.performances || [])[0] || {};
    const phone = data.contact_info || data.phone || perf.contact_info || "";
    const input = $("contact-info");
    if (phone && !input.value.trim()) {
      input.value = phone;
      const note = $("phone-note");
      note.textContent = "Filled in from your earlier sign-up. Change it if it is different.";
      note.hidden = false;
    }
    const ag = perf.age_group;
    if (ag) {
      const radio = Array.from(document.querySelectorAll('input[name="age_group"]')).find((r) => r.value === ag);
      if (radio && !radio.checked) { radio.checked = true; radio.dispatchEvent(new Event("change")); }
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

// ---------------------------------------------------------------------------------------------- errors
function setErr(field, msg) {
  const err = $(`err-${field}`);
  const input = $(field);
  if (err) {
    err.textContent = msg || "";
    err.hidden = !msg;
  }
  if (input && "ariaInvalid" in input) input.setAttribute("aria-invalid", msg ? "true" : "false");
  return !msg;
}

function showFormError(msg) {
  const el = $("form-error");
  el.textContent = msg;
  el.hidden = !msg;
}
function hideFormError() { showFormError(""); }

function isValidPhone(phone) {
  return String(phone || "").replace(/\D/g, "").length >= 10;
}

// Each validator sets inline errors and returns true when the step is fine.
const VALIDATORS = {
  about() {
    let ok = true;
    const name = $("performer-name").value.trim();
    const phone = $("contact-info").value.trim();
    const wantsAct = state.choice !== "dish";
    let firstBad = null;
    const fail = (field, msg) => { setErr(field, msg); ok = false; firstBad = firstBad || $(field); };

    setErr("performer-name", ""); setErr("contact-info", ""); setErr("guardian-name", ""); setErr("guardian-phone", ""); setErr("age-group", "");
    if (!name) fail("performer-name", "Please enter your name.");
    if (wantsAct && !state.ageGroup && (state.config?.age_groups || []).length) fail("age-group", "Choose an age group.");

    if (isJunior()) {
      if (!$("guardian-name").value.trim()) fail("guardian-name", "Enter a parent or guardian name.");
      const gp = $("guardian-phone").value.trim();
      if (!gp) fail("guardian-phone", "Enter a guardian phone number.");
      else if (!isValidPhone(gp)) fail("guardian-phone", "Enter a 10-digit phone number for the guardian.");
      if (phone && !isValidPhone(phone)) fail("contact-info", "Enter a 10-digit phone number, or leave it blank to use the guardian's.");
    } else if (!phone) {
      fail("contact-info", "Enter your phone number.");
    } else if (!isValidPhone(phone)) {
      fail("contact-info", "Enter a 10-digit phone number.");
    }
    firstBad?.focus();
    return ok;
  },

  act() {
    let ok = true;
    setErr("partner-name", ""); setErr("partner-phone", "");
    const t = currentType().toLowerCase();
    const partner = $("partner-name").value.trim();
    let firstBad = null;
    const fail = (field, msg) => { setErr(field, msg); ok = false; firstBad = firstBad || $(field); };

    if (t === "duet" || t === "group") {
      if (!partner) {
        fail("partner-name", t === "group" ? "Add the names of your group members." : "Enter your partner's name.");
      } else if (t === "duet") {
        const match = findEntry(partner);
        if (match && state.partnerSame === null) {
          fail("partner-name", "Choose Yes or No above to continue.");
        } else if (!match || state.partnerSame === false) {
          const pp = $("partner-phone").value.trim();
          if (!pp) fail("partner-phone", "Enter your partner's phone number.");
          else if (!isValidPhone(pp)) fail("partner-phone", "Enter a 10-digit phone number for your partner.");
        }
      }
    }
    firstBad?.focus();
    return ok;
  },

  dish() {
    setErr("food", "");
    if (!document.querySelector('input[name="food_item_id"]:checked')) {
      setErr("food", "Pick an open dish to continue.");
      return false;
    }
    return true;
  },
};

// ---------------------------------------------------------------------------------------------- events
function bindEvents() {
  document.querySelectorAll('input[name="signup_choice"]').forEach((r) => {
    r.addEventListener("change", (e) => setChoice(e.target.value));
  });

  const nameInput = $("performer-name");
  nameInput.addEventListener("input", () => {
    setErr("performer-name", "");
    state.profileChecked = state.profileChecked === nameInput.value.trim().toLowerCase() ? state.profileChecked : "";
    updateNameLookup();
  });
  $("contact-info").addEventListener("input", () => { setErr("contact-info", ""); $("phone-note").hidden = true; });
  $("guardian-name").addEventListener("input", () => setErr("guardian-name", ""));
  $("guardian-phone").addEventListener("input", () => setErr("guardian-phone", ""));

  $("song-title").addEventListener("input", updateSongWarning);
  $("acoustic").addEventListener("change", () => { $("upload-hint").hidden = $("acoustic").checked; });

  $("partner-name").addEventListener("input", () => {
    setErr("partner-name", "");
    state.partnerSame = null;
    updatePartnerMatch();
  });
  $("partner-phone").addEventListener("input", () => setErr("partner-phone", ""));
  $("partner-same-yes").addEventListener("click", () => {
    state.partnerSame = true;
    setErr("partner-name", "");
    $("partner-match-text").textContent = `${$("partner-name").value.trim()} is linked as your partner.`;
    $("partner-new-box").hidden = true;
  });
  $("partner-same-no").addEventListener("click", () => {
    state.partnerSame = false;
    setErr("partner-name", "");
    updatePartnerMatch();
    $("partner-phone").focus();
  });

  $("food-groups-container").addEventListener("change", (e) => {
    if (e.target && e.target.name === "food_item_id") {
      setErr("food", "");
      $("selected-food-box").hidden = false;
    }
  });

  $("back-btn").addEventListener("click", () => {
    if (state.step > 0) { state.step -= 1; showStep(); }
  });
  $("signup-form").addEventListener("submit", handleSubmit);

  $("done-add-act").addEventListener("click", () => restartForm("perform"));
  $("done-add-dish").addEventListener("click", () => restartForm("dish"));
}

async function handleSubmit(e) {
  e.preventDefault();
  hideFormError();
  const seq = steps();
  const key = seq[state.step];

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
      partner_age_group: needsPartnerPhone ? (document.querySelector('input[name="partner_age_group"]:checked')?.value || null) : null,
      partner_phone: needsPartnerPhone ? $("partner-phone").value.trim() : "",
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
  const tail = ids.length ? " Keep this entry id; you can edit from My entry." : "";
  $("done-message").textContent = `Thank you, ${name}! You are signed up for ${eventLabel()}.${parts.length ? " " + parts.join("; ") + "." : ""}${tail}`;

  const upload = $("done-upload");
  const canUpload = Boolean(act) && !act.is_acoustic && c.track_upload_enabled !== false;
  upload.hidden = !canUpload;
  upload.href = `/my-entry?name=${encodeURIComponent(name)}`;

  const canAddAct = performEnabled();
  $("done-add-act").hidden = !canAddAct;
  $("done-add-act").firstChild.textContent = act ? "Add another act" : "Add an act";
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
  $("upload-hint").hidden = false;
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
