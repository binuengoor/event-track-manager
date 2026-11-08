import { S, hooks, isAudioPlaying, screensState } from "./state.js";
import { createScreens } from "./screens.js";
import { createStageMonitorSync } from "./stage-monitor-sync.js";
import { getAuthHeaders } from "./util.js";
import { findNextEligible } from "./deck-policy.js";

// =============================================================================
// POP-OUT STAGE CONFIDENCE MONITOR (BroadcastChannel Sync)
// =============================================================================
export const stageMonitor = createStageMonitorSync(() => ({
  item: S.currentCuedItem,
  wavesurfer: S.wavesurfer,
  isPlaying: isAudioPlaying(),
  next: findNextEligible(S.queue, S.currentCuedItem ? S.currentCuedItem.entry_id : null)
}));
export const broadcastStageMonitor = stageMonitor.broadcast;

// Screens: announcement, fade to black and lyrics go to the stage monitor; LIVE_STATE and
// ANNOUNCEMENT go to /live over etm-live. Both channels are optional.
export function openChannel(name) {
  try { return (typeof BroadcastChannel !== 'undefined') ? new BroadcastChannel(name) : null; } catch (e) { return null; }
}
export const monitorChannel = openChannel('stage_monitor_channel');
export const liveChannel = openChannel('etm-live');
export const screens = createScreens({ monitorChannel, liveChannel, getHeaders: () => getAuthHeaders() });
let relayTimer = null;
export function relayLiveSoon() {
  clearTimeout(relayTimer);
  relayTimer = setTimeout(() => { screens.relayLiveState(); }, 400);
}
if (monitorChannel) {
  // A monitor opened late asks for state; replay the screen settings it cannot get from the cue.
  monitorChannel.addEventListener('message', event => {
    if (!event.data || event.data.type !== 'REQUEST_STATE') return;
    monitorChannel.postMessage({ type: 'ANNOUNCEMENT', text: screensState.announcement });
    monitorChannel.postMessage({ type: 'FADE_BLACK', on: screensState.fadeBlack });
    if (screensState.lyrics) monitorChannel.postMessage({ type: 'LYRICS', text: screensState.lyrics });
  });
}

export function adoptServerAnnouncement(text) {
  const input = document.getElementById('announcement-input');
  screensState.announcement = text;
  if (input && document.activeElement !== input && !input.dataset.dirty) input.value = text;
  const state = document.getElementById('announcement-state');
  if (state) state.textContent = text ? 'Currently showing.' : '';
}

