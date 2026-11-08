// -------------------------------------------------------------
let allActivityLogs = [];
let currentActivityFilter = "all";
let currentActivitySearch = "";

function formatLogTimestamp(isoStr) {
  if (!isoStr) return { relative: "Unknown time", full: "" };
  const d = new Date(/(Z|[+-]\d{2}:?\d{2})$/.test(isoStr) ? isoStr : isoStr + "Z");
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
    container.innerHTML = `<p class="ad-empty" style="border:0">Loading activity...</p>`;
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
    container.innerHTML = `<p class="ad-empty" style="border:0">No activity found for these filters. Changes and submissions appear here automatically.</p>`;
    return;
  }

  // Short action labels (the machine name stays visible, as in the design board)
  const WHO = {
    admin: { cls: "accent", label: "Admin" },
    signup: { cls: "", label: "Sign-up form" },
    guest: { cls: "", label: "Guest" }
  };

  container.innerHTML = `<div class="ad-log-h" aria-hidden="true"><span>TIME</span><span>WHO</span><span>ACTION</span><span>SUMMARY</span></div>` + filtered.map(item => {
    const act = item.action_type || item.action || "activity";
    const time = formatLogTimestamp(item.timestamp || item.created_at);

    const src = (item.source || item.actor || "").toLowerCase();
    const who = src.includes("admin") ? WHO.admin : src.includes("signup") ? WHO.signup : WHO.guest;
    let whoHtml = `<span class="ad-pill ${who.cls}">${who.label}</span>`;
    if (item.role) {
      whoHtml += `<span class="act-role" title="Who did it">Role: ${escapeHtml(String(item.role))}</span>`;
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
        diffHtml = `<div class="ad-diff"><span>Name changed:</span><code class="old">${escapeHtml(parsedDetails.old_name)}</code><span aria-hidden="true">&rarr;</span><code class="new">${escapeHtml(parsedDetails.new_name)}</code></div>`;
      } else if (Array.isArray(parsedDetails.changes) && parsedDetails.changes.length > 0) {
        diffHtml = `<div class="ad-diff"><span>Updated fields:</span>${parsedDetails.changes.map(ch => `<code>${escapeHtml(ch)}</code>`).join("")}</div>`;
      }
    }

    return `<div class="ad-log-row">
      <span class="ad-log-time" title="${escapeHtml(time.full)}">${escapeHtml(time.full || time.relative)}</span>
      <span class="ad-log-who">${whoHtml}</span>
      <span class="ad-log-act">${escapeHtml(String(act))}</span>
      <span class="ad-log-sum">${item.performer_name ? `<small>${escapeHtml(item.performer_name)}</small>` : ""}${escapeHtml(item.summary || "")}${diffHtml}</span>
    </div>`;
  }).join("");
}
