// Form sections: age groups, partner, types.
// Classic script: shares globals with the other signup files (see load order in the page).

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
  const adultBox = $("adult-privacy-box");
  if (adultBox) adultBox.hidden = show;
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
    const { label, input } = makeRadio("partner_age_group", ag.name, ag.name, ag.description || "", idx === (def < 0 ? 0 : def));
    input.addEventListener("change", syncPartnerGuardian);
    box.appendChild(label);
  });
  syncPartnerGuardian();
}

function partnerNeedsGuardian() {
  const value = document.querySelector('input[name="partner_age_group"]:checked')?.value || "";
  const group = (state.config?.age_groups || []).find(g => g.name === value);
  return group ? Boolean(group.requires_guardian) : value.toLowerCase() === "junior";
}

function syncPartnerGuardian() {
  $("partner-guardian-box").hidden = !partnerNeedsGuardian();
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
