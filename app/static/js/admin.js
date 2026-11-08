// EMA Paattukoottam Stage Playback Console: entry point. All behaviour lives in ./console/*.js;
// this file only wires the modules together on page load.
import { S } from "./console/state.js";
import { showToast } from "./console/util.js";
import { initWaveSurfer } from "./console/audio-engine.js";
import { setupDisruptionModal } from "./console/disruption.js";
import { updateVaultStatusDisplay, autoVaultSync } from "./console/vault-ui.js";
import { updateNetworkStatusDisplay, syncOfflineActions } from "./console/offline-sync.js";
import { updateSyncStatusBadge } from "./console/sync-order.js";
import { setupSearch } from "./console/queue-render.js";
import { fetchEventInfo, setupAuth, showAuthModal, testAuthAndLoad, loadQueue } from "./console/queue-load.js";
import { setupKeyboardHotkeys } from "./console/hotkeys.js";
import { setupActionButtons } from "./console/action-buttons.js";
import { setupConsoleUpgrades } from "./console/console-upgrades.js";

document.addEventListener('DOMContentLoaded', async () => {
  setupAuth();
  initWaveSurfer();
  setupKeyboardHotkeys();
  setupActionButtons();
  setupDisruptionModal();
  setupSearch();
  setupConsoleUpgrades();
  fetchEventInfo();

  // Register Service Worker for offline app loading
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('Service Worker registration skipped:', err);
    });
  }

  // Network online/offline event listeners
  window.addEventListener('online', () => {
    updateNetworkStatusDisplay();
    showToast('✓ Internet restored. Connected to server.', 'success');
    syncOfflineActions();
    autoVaultSync();
  });
  window.addEventListener('offline', () => {
    updateNetworkStatusDisplay();
    showToast('⚠️ Wi-Fi / Internet disconnected. Console running in offline mode.', 'warning');
  });

  updateNetworkStatusDisplay();
  updateVaultStatusDisplay();

  if (S.userAdminPin) {
    await testAuthAndLoad();
  } else {
    showAuthModal();
  }

  // Periodic background sync every 45s (only if online and sequence is not dirty)
  S.autoSyncInterval = setInterval(() => {
    if (navigator.onLine && S.userAdminPin && !S.isSequenceDirty && !document.getElementById('auth-modal').classList.contains('hidden') === false) {
      loadQueue(true); // silent background sync
      syncOfflineActions();
    }
  }, 45000);

  // Update time-ago badge every 10 seconds
  setInterval(updateSyncStatusBadge, 10000);
});
