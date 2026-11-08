const FEATURE_DEFINITIONS = [
  {
    key: "stage_performances_enabled",
    name: "Stage Performances / Song Acts",
    desc: "Master switch for stage acts. When disabled (e.g. Potluck Social / Dinner), all songs, audio tracks, and stage acts are suppressed.",
    icon: "music-2",
    category: "Performances"
  },
  {
    key: "food_signup_enabled",
    name: "Potluck & Food Sign-Up",
    desc: "Enables potluck menu catalog, public dish selection in registration, and the food board.",
    icon: "utensils",
    category: "Hospitality"
  },
  {
    key: "signup_enabled",
    name: "Public Song Sign-Ups",
    desc: "Allows attendees to register new performances online. When disabled, roster is frozen.",
    icon: "mic",
    category: "Performances"
  },
  {
    key: "track_upload_enabled",
    name: "Backing Track Audio Uploads",
    desc: "Enables MP3/WAV uploads and YouTube extraction. When disabled, defaults to live/acoustic.",
    icon: "music",
    category: "Performances"
  },
  {
    key: "allow_duets",
    name: "Duets & Group Performances",
    desc: "Allows multi-performer acts with partner linking. When disabled, restricts to Solo only.",
    icon: "users",
    category: "Performances"
  },
  {
    key: "performer_edits_enabled",
    name: "Performer Hub Self-Service Edits",
    desc: "Allows performers to rename songs, swap audio tracks, and edit notes post-registration.",
    icon: "edit-3",
    category: "Performances"
  },
  {
    key: "live_display_enabled",
    name: "Live Audience Stage Display",
    desc: "Enables the full-screen projector / stage display showing Now Performing & Up Next.",
    icon: "radio",
    category: "Stage"
  },
  {
    key: "console_enabled",
    name: "Sound Engineer Console",
    desc: "Enables the playback console at /console for audio playback, queue reordering, and offline exports.",
    icon: "sliders",
    category: "Stage"
  },
  {
    key: "dashboard_enabled",
    name: "Setlist Transparency Dashboard",
    desc: "Public dashboard of registered songs. Disable for secret setlists or blind auditions.",
    icon: "layout-dashboard",
    category: "Community"
  },
  {
    key: "payment_enabled",
    name: "Ticketing & Payment Links",
    desc: "Displays ticket purchase, donation links, and payment QR callouts across pages.",
    icon: "credit-card",
    category: "Finance"
  }
];

function renderFeatureToggles() {
  const container = document.getElementById("feature-modules-grid");
  if (!container || !adminSettings) return;

  container.innerHTML = FEATURE_DEFINITIONS.map(feat => {
    const isEnabled = Boolean(adminSettings[feat.key] !== false);
    return `
      <div class="as-switch-row">
        <div class="as-switch-text">
          <span id="feat-label-${feat.key}" class="as-switch-name">${feat.name}<span class="as-switch-state ${isEnabled ? "on" : ""}" aria-hidden="true">${isEnabled ? "On" : "Off"}</span></span>
          <span id="feat-desc-${feat.key}" class="as-switch-desc">${feat.desc}</span>
        </div>
        <button type="button" role="switch" class="as-switch feature-toggle-btn" aria-checked="${isEnabled}" aria-labelledby="feat-label-${feat.key}" aria-describedby="feat-desc-${feat.key}" data-feature-key="${feat.key}"></button>
      </div>
    `;
  }).join("");

  container.querySelectorAll(".feature-toggle-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const key = btn.dataset.featureKey;
      const current = Boolean(adminSettings[key] !== false);
      const nextVal = !current;

      try {
        btn.disabled = true;
        const res = await fetch("/api/admin/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [key]: nextVal })
        });
        if (res.ok) {
          adminSettings[key] = nextVal;
          if (key === "signup_enabled") updateSignupToggleButton(nextVal);
          if (key === "food_signup_enabled") updateFoodToggleButton(nextVal);
          renderFeatureToggles();
          container.querySelector(`[data-feature-key="${key}"]`)?.focus();
          showToast(`Feature updated: ${key} is now ${nextVal ? 'enabled' : 'disabled'}`);
        } else {
          showToast("Failed to update feature", true);
        }
      } catch (err) {
        showToast("Error updating feature toggle", true);
      }
    });
  });
}
