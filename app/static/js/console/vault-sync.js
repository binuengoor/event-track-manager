// Manifest-driven vault sync. All I/O is injected so the logic is unit-testable.
export const MB = 1024 * 1024;

export function pillText({ready, total, bytes}) {
  const mb = Math.round((bytes || 0) / MB);
  return `Vault ${ready}/${total} ready, ${mb} MB`;
}

// A cached record satisfies a manifest entry when sizes agree (and hash, if both known).
export function recordMatches(entry, rec) {
  if (!rec) return false;
  if (entry.size && rec.size_bytes !== entry.size) return false;
  if (entry.sha256 && rec.sha256 && rec.sha256 !== entry.sha256) return false;
  return true;
}

export function planVaultSync(tracks, cachedMeta) {
  const byId = new Map((cachedMeta || []).map(r => [r.entry_id, r]));
  const missing = [];
  const ready = [];
  for (const entry of tracks || []) {
    (recordMatches(entry, byId.get(entry.entry_id)) ? ready : missing).push(entry);
  }
  const bytes = ready.reduce((n, e) => n + (byId.get(e.entry_id).size_bytes || 0), 0);
  return {ready, missing, bytes, total: (tracks || []).length};
}

export async function sha256Hex(blob, subtle = globalThis.crypto && globalThis.crypto.subtle) {
  if (!subtle || typeof blob.arrayBuffer !== 'function') return null;
  const digest = await subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Returns {ok, sha256, reason}. Hash is only checked when the manifest has one and the browser can compute it.
export async function verifyBlob(entry, blob, hash = sha256Hex) {
  if (entry.size && blob.size !== entry.size) return {ok: false, reason: `size ${blob.size} != ${entry.size}`};
  let digest = null;
  if (entry.sha256) {
    try { digest = await hash(blob); } catch (e) { digest = null; }
    if (digest && digest !== entry.sha256) return {ok: false, reason: 'checksum mismatch'};
  }
  return {ok: true, sha256: digest || entry.sha256 || undefined};
}

export async function fetchManifest(fetchRequest, getHeaders) {
  try {
    const res = await fetchRequest('/api/vault/manifest', {headers: getHeaders()});
    if (!res.ok) return null; // 404 etc: caller falls back to manual cache-all
    const data = await res.json();
    if (!data || !Array.isArray(data.tracks)) return null;
    return data;
  } catch (e) {
    return null;
  }
}

// Downloads every missing entry one at a time. Failures are collected, never thrown.
export async function runVaultSync({tracks, cachedMeta, downloadTrack, saveTrack, onProgress = () => {}, hash}) {
  const plan = planVaultSync(tracks, cachedMeta);
  const failed = [];
  let done = 0;
  for (const entry of plan.missing) {
    try {
      const blob = await downloadTrack(entry);
      const check = await verifyBlob(entry, blob, hash);
      if (!check.ok) throw new Error(check.reason);
      const saved = await saveTrack(entry, blob, check.sha256);
      if (saved === false) throw new Error('could not store in browser');
    } catch (e) {
      failed.push({entry_id: entry.entry_id, reason: e && e.message ? e.message : 'download failed'});
    }
    done += 1;
    onProgress({done, of: plan.missing.length, failed: failed.length});
  }
  return {planned: plan.missing.length, failed, ready: plan.ready.length + plan.missing.length - failed.length, total: plan.total};
}
