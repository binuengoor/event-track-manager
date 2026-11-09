// 
// Classic script: shares globals with the other signup files (see load order in the page).

// Guest sign-up: one progressive form (About you -> Your act -> Dish), then a "what next" card.
// Choices: Perform / Bring a dish. Backend: POST /api/signup (registration_type performer | food_only | both).
const NAME_KEY = "etm_guest_name";
const STEP_LABELS = { about: "About you", act: "Your song", dish: "Your dish" };
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
