// Console IndexedDB storage. Keep the existing database and record format.
const VAULT_DB_NAME = 'PaattukoottamAudioVault';
export const VAULT_STORE_NAME = 'audio_tracks';
const VAULT_DB_VERSION = 1;

let vaultDbPromise = null;

export function getVaultDb() {
  if (vaultDbPromise) return vaultDbPromise;
  vaultDbPromise = new Promise((resolve) => {
    if (!window.indexedDB) {
      console.warn('IndexedDB not supported in this browser.');
      resolve(null);
      return;
    }
    const req = indexedDB.open(VAULT_DB_NAME, VAULT_DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(VAULT_STORE_NAME)) {
        db.createObjectStore(VAULT_STORE_NAME, { keyPath: 'entry_id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      console.error('IndexedDB open error:', req.error);
      resolve(null);
    };
  });
  return vaultDbPromise;
}

export async function getCachedTrack(entryId) {
  const db = await getVaultDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(VAULT_STORE_NAME, 'readonly');
      const store = tx.objectStore(VAULT_STORE_NAME);
      const req = store.get(entryId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch (e) {
      resolve(null);
    }
  });
}

export async function saveCachedTrack(entryId, blob, metadata = {}) {
  const db = await getVaultDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(VAULT_STORE_NAME, 'readwrite');
      const store = tx.objectStore(VAULT_STORE_NAME);
      const record = {
        entry_id: entryId,
        blob: blob,
        size_bytes: blob.size,
        content_type: blob.type || 'audio/mpeg',
        timestamp: Date.now(),
        ...metadata
      };
      const req = store.put(record);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    } catch (e) {
      resolve(false);
    }
  });
}

export async function getVaultTrackIds() {
  const db = await getVaultDb();
  if (!db) return new Set();
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(VAULT_STORE_NAME, 'readonly');
      const store = tx.objectStore(VAULT_STORE_NAME);
      const req = store.getAllKeys();
      req.onsuccess = () => resolve(new Set(req.result || []));
      req.onerror = () => resolve(new Set());
    } catch (e) {
      resolve(new Set());
    }
  });
}


// Metadata for every cached track, without the blobs.
export async function getAllCachedMeta() {
  const db = await getVaultDb();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(VAULT_STORE_NAME, 'readonly');
      const req = tx.objectStore(VAULT_STORE_NAME).getAll();
      req.onsuccess = () => resolve((req.result || []).map(({blob, ...meta}) => ({
        ...meta, size_bytes: meta.size_bytes || (blob ? blob.size : 0),
      })));
      req.onerror = () => resolve([]);
    } catch (e) {
      resolve([]);
    }
  });
}
