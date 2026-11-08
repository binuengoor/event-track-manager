async function loadSummary() {
  try {
    const res = await fetch("/api/admin/summary");
    if (!res.ok) return;
    const s = await res.json();

    document.getElementById("stat-total-performers").textContent = s.total_participants;
    document.getElementById("stat-total-performances").textContent = s.total_performances;
    document.getElementById("stat-juniors").textContent = s.juniors;
    document.getElementById("stat-seniors").textContent = s.seniors;
    document.getElementById("stat-solo").textContent = s.solo;
    document.getElementById("stat-duet").textContent = s.duet;
    document.getElementById("stat-group").textContent = s.group;
    if (document.getElementById("stat-junior-acts")) {
      document.getElementById("stat-junior-acts").textContent = s.junior_acts ?? 0;
    }
    if (document.getElementById("stat-senior-acts")) {
      document.getElementById("stat-senior-acts").textContent = s.senior_acts ?? 0;
    }

    document.getElementById("stat-food-claimed").textContent = s.food_taken;
    document.getElementById("stat-food-total").textContent = s.food_total;
    const pct = s.food_total > 0 ? Math.round((s.food_taken / s.food_total) * 100) : 0;
    document.getElementById("stat-food-percent").textContent = `${pct}%`;
  } catch (e) {
    console.error("Summary error:", e);
  }
}

async function loadBackupStatus() {
  try {
    const res = await fetch("/api/admin/backup-status");
    if (!res.ok) return;
    const b = await res.json();

    const card = document.getElementById("backup-status-card");
    const last = b.last_backup;

    card.innerHTML = `
      <div class="flex items-center justify-between">
        <span class="font-bold text-white flex items-center gap-2">
          <span class="w-2.5 h-2.5 rounded-full ${b.enabled ? 'bg-emerald-500' : 'bg-slate-600'}"></span>
          <span>Export file:</span>
          <code class="text-orange-400">${b.backup_target_file}</code>
        </span>
        <span class="text-[11px] font-semibold ${last && last.status === 'success' ? 'text-emerald-400' : 'text-slate-400'}">
          ${last ? `Status: ${last.status.toUpperCase()}` : 'No backups run yet'}
        </span>
      </div>
      <p class="text-slate-400">
        ${last ? `Last snapshot: ${last.completed_at || last.triggered_at} (${last.rows_backed || 0} rows backed up)` : 'Backups trigger automatically on data changes.'}
      </p>
    `;

    const tbody = document.getElementById("backup-history-body");
    const history = b.history || [];
    if (history.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="px-4 py-6 text-center text-slate-500">No backup records found.</td></tr>`;
      return;
    }

    tbody.innerHTML = history.map(h => `
      <tr class="hover:bg-slate-900/50">
        <td class="px-4 py-2 font-mono text-[11px]">${h.completed_at || h.triggered_at}</td>
        <td class="px-4 py-2">
          <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${h.status === 'success' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}">
            ${h.status}
          </span>
        </td>
        <td class="px-4 py-2 font-mono">${h.rows_backed || 0}</td>
        <td class="px-4 py-2 text-slate-400 truncate max-w-xs">${h.error_msg || '—'}</td>
      </tr>
    `).join("");
  } catch (e) {
    console.error("Backup status error:", e);
  }
}

// -------------------------------------------------------------
// Activity Audit Trail Logic
