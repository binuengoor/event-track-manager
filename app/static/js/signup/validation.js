// Errors, validators, event binding.
// Classic script: shares globals with the other signup files (see load order in the page).

// ---------------------------------------------------------------------------------------------- errors
function setErr(field, msg) {
  const err = $(`err-${field}`);
  const input = $(field);
  if (err) {
    err.textContent = msg || "";
    err.hidden = !msg;
  }
  if (input && "ariaInvalid" in input) input.setAttribute("aria-invalid", msg ? "true" : "false");
  refreshErrorSummary();
  return !msg;
}

// Summary box above the fields: one link per visible error, so a keyboard or screen-reader user can jump to each.
let errorSummarySig = "";
function errorTargetFor(errEl) {
  return $(errEl.id.replace(/^err-/, "")) || errEl.closest("fieldset")?.querySelector("input") || errEl.closest(".gf-field")?.querySelector("input");
}
function refreshErrorSummary() {
  const box = $("error-summary");
  const list = $("error-summary-list");
  if (!box || !list) return;
  const errs = Array.from(document.querySelectorAll("#signup-form .gf-error"))
    .filter((e) => !e.hidden && e.textContent.trim() && !e.parentElement.closest("[hidden]"));
  const sig = errs.map((e) => `${e.id}:${e.textContent}`).join("|");
  if (sig === errorSummarySig) return;
  errorSummarySig = sig;
  list.innerHTML = "";
  if (!errs.length) { box.hidden = true; return; }
  $("error-summary-heading").textContent = `Fix ${errs.length} thing${errs.length === 1 ? "" : "s"} to continue`;
  errs.forEach((e) => {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = "#";
    a.textContent = e.textContent;
    a.addEventListener("click", (ev) => { ev.preventDefault(); errorTargetFor(e)?.focus(); });
    li.appendChild(a);
    list.appendChild(li);
  });
  box.hidden = false;
}

function showFormError(msg) {
  const el = $("form-error");
  el.textContent = msg;
  el.hidden = !msg;
  if (msg) el.scrollIntoView({ block: "center", behavior: "smooth" });
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
      if (!usingGuardianPhone()) {
        if (!phone) fail("contact-info", "Enter your phone number, or tick the box to use the guardian's.");
        else if (!isValidPhone(phone)) fail("contact-info", "Enter a 10-digit phone number, or use the guardian's.");
      }
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
          if (partnerNeedsGuardian()) {
            if (!$('partner-guardian-name').value.trim()) fail('partner-guardian-name', "Enter your partner's guardian name.");
            if (!isValidPhone($('partner-guardian-phone').value.trim())) fail('partner-guardian-phone', "Enter a 10-digit guardian phone number.");
          }
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
    updateJuniorPrivacy();
    state.profileChecked = state.profileChecked === nameInput.value.trim().toLowerCase() ? state.profileChecked : "";
    updateNameLookup();
  });
  $("contact-info").addEventListener("input", () => { setErr("contact-info", ""); $("phone-note").hidden = true; });
  $("guardian-name").addEventListener("input", () => setErr("guardian-name", ""));
  $("guardian-phone").addEventListener("input", () => { setErr("guardian-phone", ""); syncGuardianPhone(); });
  $("use-guardian-phone").addEventListener("change", syncGuardianPhone);

  $("song-title").addEventListener("input", updateSongWarning);
  $("acoustic").addEventListener("change", () => { syncBarNotes(); });

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
      syncBarNotes();
    }
  });

  $("back-btn").addEventListener("click", () => {
    if (state.step > 0) { state.step -= 1; showStep(); }
  });
  $("signup-form").addEventListener("submit", handleSubmit);
  $("skip-dish-btn").addEventListener("click", skipDish);
  $("add-song-btn").addEventListener("click", () => { setChoice("both"); window.scrollTo({ top: 0 }); });

  $("done-add-act").addEventListener("click", () => restartForm("perform"));
  $("done-add-dish").addEventListener("click", () => restartForm("dish"));
}
