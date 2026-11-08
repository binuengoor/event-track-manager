// -------------------------------------------------------------
let allActivityLogs = [];
let currentActivityFilter = "all";
let currentActivitySearch = "";

function formatLogTimestamp(isoStr) {
  if (!isoStr) return { relative: "Unknown time", full: "" };
  const d = new Date(isoStr.endsWith("Z") ? isoStr : isoStr + "Z");
  if (isNaN(d.getTime())) return { relative: isoStr, full: isoStr };
  
  const now = new Date();
  const diffSec = Math.floor((now - d) / 1000);
  let relative = "";
  if (diffSec < 45) {
    relative = "just now";
  } else if (diffSec < 3600) {
    const mins = Math.max(1, Math.floor(diffSec / 60));
    relative = `${mins}m ago`;
  } else if (diffSec < 86400) {
    const hours = Math.floor(diffSec / 3600);
    relative = `${hours}h ago`;
  } else if (diffSec < 604800) {
    const days = Math.floor(diffSec / 86400);
    relative = `${days}d ago`;
  } else {
    relative = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  
  const full = d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  });
  return { relative, full };
}

async function loadActivityLogs() {
  const container = document.getElementById("activity-list-container");
  const countBadge = document.getElementById("activity-count-badge");
  const daysSelect = document.getElementById("activity-days-filter");
  const days = daysSelect ? daysSelect.value : "7";

  if (container && (!allActivityLogs || allActivityLogs.length === 0)) {
    container.innerHTML = `
      <div class="p-8 text-center text-slate-500 flex flex-col items-center justify-center gap-2">
        <i data-lucide="loader-2" class="w-6 h-6 animate-spin text-orange-500"></i>
        <span class="text-xs">Loading activity audit trail...</span>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
  }

  try {
    const res = await fetch(`/api/admin/activity-logs?days=${days}&limit=300`);
    if (!res.ok) {
      if (countBadge) countBadge.textContent = "Error loading activity logs";
      return;
    }
    const data = await res.json();
    allActivityLogs = Array.isArray(data) ? data : (data.logs || []);
    filterAndRenderActivityLogs();
  } catch (err) {
    console.error("Failed to load activity logs:", err);
    if (countBadge) countBadge.textContent = "Failed to load activity logs";
  }
}

function filterAndRenderActivityLogs() {
  const container = document.getElementById("activity-list-container");
  const countBadge = document.getElementById("activity-count-badge");
  if (!container) return;

  let filtered = allActivityLogs;

  // Filter by category
  if (currentActivityFilter && currentActivityFilter !== "all") {
    filtered = filtered.filter(item => {
      const act = item.action_type || item.action || "";
      if (currentActivityFilter === "name_change") return act === "rename" || act === "name_change";
      if (currentActivityFilter === "food") return act.startsWith("food_");
      if (currentActivityFilter === "track") return act === "track_upload";
      if (currentActivityFilter === "song") return act.startsWith("song_") || act.startsWith("performance_");
      if (currentActivityFilter === "signup") return act === "signup";
      if (currentActivityFilter === "admin") return act.startsWith("admin_");
      return true;
    });
  }

  // Filter by search query
  if (currentActivitySearch) {
    const q = currentActivitySearch.toLowerCase();
    filtered = filtered.filter(item => {
      return (item.summary && item.summary.toLowerCase().includes(q)) ||
        (item.performer_name && item.performer_name.toLowerCase().includes(q)) ||
        (item.details && item.details.toLowerCase().includes(q)) ||
        (item.entry_id && item.entry_id.toLowerCase().includes(q)) ||
        (item.source && item.source.toLowerCase().includes(q)) ||
        (item.action_type && item.action_type.toLowerCase().includes(q));
    });
  }

  const daysSelect = document.getElementById("activity-days-filter");
  const daysText = daysSelect ? daysSelect.options[daysSelect.selectedIndex]?.text : "Recent";
  if (countBadge) {
    countBadge.textContent = `Showing ${filtered.length} of ${allActivityLogs.length} entries (${daysText})`;
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="p-8 text-center text-slate-500 bg-slate-950/60 rounded-2xl border border-slate-800 flex flex-col items-center justify-center gap-2">
        <i data-lucide="inbox" class="w-8 h-8 text-slate-600"></i>
        <p class="text-xs font-semibold text-slate-400">No activity logs found matching your criteria</p>
        <p class="text-[11px] text-slate-600">Changes and submissions will appear here automatically.</p>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
    return;
  }

  // Action visual styles mapping
  const actionStyles = {
    rename: { icon: "user-check", bg: "bg-purple-500/10", text: "text-purple-400", border: "border-purple-500/25", label: "Name Change" },
    name_change: { icon: "user-check", bg: "bg-purple-500/10", text: "text-purple-400", border: "border-purple-500/25", label: "Name Change" },
    food_claim: { icon: "utensils", bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/25", label: "Potluck Claimed" },
    food_update: { icon: "edit-3", bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/25", label: "Potluck Updated" },
    food_release: { icon: "trash-2", bg: "bg-rose-500/10", text: "text-rose-400", border: "border-rose-500/25", label: "Potluck Released" },
    song_update: { icon: "music", bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/25", label: "Song Updated" },
    performance_update: { icon: "mic", bg: "bg-indigo-500/10", text: "text-indigo-400", border: "border-indigo-500/25", label: "Performance Update" },
    track_upload: { icon: "disc", bg: "bg-cyan-500/10", text: "text-cyan-400", border: "border-cyan-500/25", label: "Track Uploaded" },
    signup: { icon: "user-plus", bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/25", label: "New Sign-Up" },
    admin_participant_update: { icon: "shield-alert", bg: "bg-orange-500/10", text: "text-orange-400", border: "border-orange-500/25", label: "Admin Edit" },
    admin_participant_delete: { icon: "user-x", bg: "bg-rose-500/10", text: "text-rose-400", border: "border-rose-500/25", label: "Admin Delete" }
  };

  container.innerHTML = filtered.map(item => {
    const act = item.action_type || item.action || "activity";
    const style = actionStyles[act] || {
      icon: "activity",
      bg: "bg-slate-800/60",
      text: "text-slate-300",
      border: "border-slate-700",
      label: act.replace(/_/g, " ")
    };

    const time = formatLogTimestamp(item.timestamp || item.created_at);

    // Actor badge
    let actorBadge = "";
    const src = (item.source || item.actor || "").toLowerCase();
    if (src.includes("admin")) {
      actorBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">Admin</span>`;
    } else if (src.includes("signup")) {
      actorBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20">Sign-Up Form</span>`;
    } else {
      actorBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/10 text-purple-400 border border-purple-500/20">Performer Hub</span>`;
    }

    if (item.role) {
      actorBadge += ` <span class="act-role" title="Who did it">Role: ${escapeHtml(String(item.role))}</span>`;
    }

    // Try to parse details JSON for diff display
    let parsedDetails = null;
    if (item.details) {
      try {
        parsedDetails = JSON.parse(item.details);
      } catch (e) {}
    }

    let diffHtml = "";
    if (parsedDetails) {
      if (parsedDetails.old_name && parsedDetails.new_name) {
        diffHtml = `
          <div class="mt-2 text-xs bg-slate-900/80 border border-slate-800/80 rounded-xl p-2.5 flex flex-wrap items-center gap-2">
            <span class="text-slate-400 font-medium text-[11px]">Name changed:</span>
            <span class="px-2 py-0.5 rounded bg-rose-500/10 text-rose-300 line-through text-[11px] font-mono break-all">${escapeHtml(parsedDetails.old_name)}</span>
            <span class="text-slate-500 font-bold">→</span>
            <span class="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 font-bold text-[11px] font-mono break-all">${escapeHtml(parsedDetails.new_name)}</span>
          </div>
        `;
      } else if (Array.isArray(parsedDetails.changes) && parsedDetails.changes.length > 0) {
        diffHtml = `
          <div class="mt-2 text-xs bg-slate-900/80 border border-slate-800/80 rounded-xl p-2.5 space-y-1">
            <div class="text-[11px] text-slate-400 font-semibold mb-1">Updated Fields:</div>
            ${parsedDetails.changes.map(ch => `<div class="text-[11px] text-slate-300 font-mono flex items-center gap-1.5"><span class="w-1.5 h-1.5 rounded-full bg-orange-400"></span>${escapeHtml(ch)}</div>`).join("")}
          </div>
        `;
      }
    }

    return `
      <div class="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800/90 hover:border-slate-700 transition flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div class="flex items-start gap-3 flex-1 min-w-0">
          <div class="w-8 h-8 rounded-xl ${style.bg} ${style.border} border flex items-center justify-center shrink-0 mt-0.5">
            <i data-lucide="${style.icon}" class="w-4 h-4 ${style.text}"></i>
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="px-2 py-0.5 rounded-lg text-[10px] font-bold ${style.bg} ${style.text} border ${style.border}">
                ${style.label}
              </span>
              ${actorBadge}
              ${item.performer_name ? `<span class="text-xs font-bold text-slate-200 truncate max-w-xs">${escapeHtml(item.performer_name)}</span>` : ""}
            </div>
            <p class="text-xs text-slate-300 font-medium mt-1 leading-relaxed break-words">
              ${escapeHtml(item.summary || "")}
            </p>
            ${diffHtml}
          </div>
        </div>

        <div class="flex sm:flex-col items-center sm:items-end justify-between sm:justify-start gap-1 shrink-0 pt-1 border-t sm:border-t-0 border-slate-800/50">
          <span class="text-xs font-semibold text-slate-400" title="${escapeHtml(time.full)}">${time.relative}</span>
          <span class="text-[10px] text-slate-500 font-mono">${escapeHtml(time.full)}</span>
        </div>
      </div>
    `;
  }).join("");

  if (window.lucide) lucide.createIcons();
}
