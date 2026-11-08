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
    const badgeColor = isEnabled ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" : "bg-slate-800 text-slate-400 border-slate-700";
    const statusText = isEnabled ? "ACTIVE" : "DISABLED";
    const btnStyle = isEnabled
      ? "bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/30"
      : "bg-slate-800 hover:bg-slate-700 text-slate-400 border border-slate-700";
    const btnLabel = isEnabled ? "Enabled" : "Disabled";

    return `
      <div class="p-4 rounded-2xl bg-slate-950 border border-slate-800/90 flex flex-col justify-between gap-3 transition hover:border-slate-700">
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2.5">
              <div class="w-8 h-8 rounded-xl ${isEnabled ? 'bg-orange-500/20 text-orange-400' : 'bg-slate-800 text-slate-500'} flex items-center justify-center shrink-0">
                <i data-lucide="${feat.icon}" class="w-4 h-4"></i>
              </div>
              <div>
                <h4 class="text-xs font-bold text-white">${feat.name}</h4>
                <span class="text-[10px] text-slate-400">${feat.category}</span>
              </div>
            </div>
            <span class="text-[9px] font-bold px-2 py-0.5 rounded-full border ${badgeColor}">${statusText}</span>
          </div>
          <p class="text-[11px] text-slate-400 leading-relaxed">${feat.desc}</p>
        </div>
        <div class="pt-2 border-t border-slate-800/80 flex items-center justify-between">
          <span class="text-[11px] text-slate-400 font-medium">Toggle Status:</span>
          <button type="button" class="feature-toggle-btn px-3 py-1.5 rounded-xl text-xs font-bold shadow transition flex items-center gap-1.5 ${btnStyle}" data-feature-key="${feat.key}">
            <i data-lucide="${isEnabled ? 'check' : 'x'}" class="w-3.5 h-3.5"></i>
            <span>${btnLabel}</span>
          </button>
        </div>
      </div>
    `;
  }).join("");

  if (window.lucide) lucide.createIcons();

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
