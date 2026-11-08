// Per-track loudness gain (SPEC 6.9). The server measures once at ingest and publishes gain_db in the vault
// manifest; the console remembers it locally so it still applies with no network. Originals are never changed.
export const MIN_GAIN_DB = -12;
export const MAX_GAIN_DB = 9;
const STORAGE_KEY = 'etm-track-gain-db';

export function clampGainDb(db) {
  const n = Number(db);
  if (!Number.isFinite(n)) return 0;
  return Math.max(MIN_GAIN_DB, Math.min(MAX_GAIN_DB, n));
}

export function dbToLinear(db) {
  return Math.pow(10, clampGainDb(db) / 20);
}

export function createGainStore(storage = globalThis.localStorage) {
  let map = {};
  try { map = JSON.parse(storage.getItem(STORAGE_KEY) || '{}') || {}; } catch (e) { map = {}; }
  return {
    // Adopts gain_db from manifest tracks; entries the server has not measured yet keep any earlier value.
    update(tracks) {
      for (const t of tracks || []) {
        if (t && t.entry_id && Number.isFinite(t.gain_db)) map[t.entry_id] = clampGainDb(t.gain_db);
      }
      try { storage.setItem(STORAGE_KEY, JSON.stringify(map)); } catch (e) { /* quota or private mode: in-memory only */ }
    },
    linear(entryId) {
      return Object.prototype.hasOwnProperty.call(map, entryId) ? dbToLinear(map[entryId]) : 1;
    },
  };
}
