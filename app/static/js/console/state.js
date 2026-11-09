// Shared console state. Modules read and write S.<name>; cross-module calls that would
// otherwise form import cycles go through `hooks`, filled in by the defining module.
import { createTransport } from "./transport.js";
import { createGainStore } from "./loudness.js";
import { createReorderLock } from "./reorder.js";

export const S = {
  queue: [],
  filteredQueue: [],
  currentCuedItem: null,
  currentCuedObjectUrl: null,
  wavesurfer: null,
  isPlaying: false,
  isMuted: false,
  userAdminPin: localStorage.getItem('paattukoottam_pin') || '',
  signedIn: false,  // true once the server accepts us: by the saved PIN or by the sign-in cookie from any other page
  searchQuery: '',
  autoSyncInterval: null,
  isSequenceDirty: false,
  lastSyncedAt: null,
  onDeckId: null,
  gainStage: null,
  vaultManifest: null,
  trackBaseGain: 1,
  cachedVaultEntryIds: new Set(),
};

// Late-bound functions: renderQueueList, applyFilter, updateQueueStatsSummary, loadQueue.
export const hooks = {};

export const transport = createTransport();
export const trackGains = createGainStore();
export const reorderLock = createReorderLock();
export const screensState = { announcement: '', fadeBlack: false, lyrics: '' };

export function isAudioPlaying() {
  if (S.wavesurfer) {
    try {
      if (typeof S.wavesurfer.isPlaying === 'function' && S.wavesurfer.isPlaying()) return true;
    } catch (e) {}
  }
  return Boolean(S.isPlaying) || transport.isLive();
}
