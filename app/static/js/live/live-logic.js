// Pure logic for the venue /live screen and the stage monitor.
// Dual export: browser global EtmLive, Node require().
(function (root) {
  'use strict';

  const ANNOUNCEMENT_MAX = 140;

  function cleanAnnouncement(text) {
    return String(text == null ? '' : text).replace(/\s+/g, ' ').trim().slice(0, ANNOUNCEMENT_MAX);
  }

  function has(list) { return Array.isArray(list) && list.length > 0; }

  // off | prestart | live | ended
  //  off      live display disabled by the organiser
  //  ended    the show ran and nothing is left to perform (never shows Now on Stage again)
  //  prestart start time is in the future and nothing is on stage
  //  live     everything else (including "waiting for the next act")
  function selectState(data, nowMs, startMs) {
    if (!data) return 'live';
    if (data.live_display_enabled === false) return 'off';
    const onStage = Boolean(data.now_performing && data.now_performing.entry_id);
    if (onStage) return 'live';
    const remaining = has(data.up_next) || has(data.upcoming) || has(data.on_hold);
    if (!remaining && has(data.performed)) return 'ended';
    if (Number.isFinite(startMs) && Number.isFinite(nowMs) && startMs - nowMs > 0) return 'prestart';
    return 'live';
  }

  // Apply a BroadcastChannel message to {status, announcement}; returns a new object (or the same one if ignored).
  function applyBroadcast(current, msg) {
    if (!msg || typeof msg !== 'object') return current;
    if (msg.type === 'LIVE_STATE' && msg.status && typeof msg.status === 'object') {
      return { status: msg.status, announcement: cleanAnnouncement(msg.status.announcement) };
    }
    if (msg.type === 'ANNOUNCEMENT') {
      const text = cleanAnnouncement(msg.text);
      const status = current.status ? Object.assign({}, current.status, { announcement: text }) : current.status;
      return { status, announcement: text };
    }
    return current;
  }

  // One display name for an act: "A" or "A & B". Plain text; callers escape.
  function actName(item) {
    if (!item) return '';
    const a = String(item.performer_name || '').trim();
    const b = String(item.partner_name || '').trim();
    return b ? `${a} & ${b}` : a;
  }

  // Acoustic status is sent to public screens as a boolean so raw track status stays private.
  function isAcousticAct(item) {
    return Boolean(item && (item.is_acoustic === true || item.track_status === 'Acoustic' || /acoustic/i.test(item.performance_type || '')));
  }

  // Long names must wrap on a TV, never truncate. Returned classes are defined in live.html.
  const WRAP_CLASS = 'tv-wrap';
  const CLAMP_CLASS = 'tv-clamp2';
  function nameClasses(clamp) { return clamp ? `${WRAP_CLASS} ${CLAMP_CLASS}` : WRAP_CLASS; }

  function pad2(n) { return String(n).padStart(2, '0'); }
  function seqLabel(item) { return `#${pad2((item && item.sequence_order) || 0)}`; }

  function countdownParts(diffMs) {
    const d = Math.max(0, diffMs);
    return {
      days: Math.floor(d / 86400000),
      hours: Math.floor(d / 3600000) % 24,
      mins: Math.floor(d / 60000) % 60,
      secs: Math.floor(d / 1000) % 60,
    };
  }

  // Stage monitor liveness: connected while a message arrived within the window.
  const DISCONNECT_MS = 8000;
  function isConnected(lastMsgMs, nowMs, windowMs) {
    return Number.isFinite(lastMsgMs) && (nowMs - lastMsgMs) < (windowMs || DISCONNECT_MS);
  }

  // Stage monitor mode: black | lyrics | video | name | standby (priority order).
  function monitorMode(s) {
    if (s.fadeBlack) return 'black';
    if (s.lyrics && String(s.lyrics).trim()) return 'lyrics';
    if (s.entryId && s.mediaType === 'video' && s.streamUrl) return 'video';
    if (s.entryId) return 'name';
    return 'standby';
  }

  const api = { ANNOUNCEMENT_MAX, DISCONNECT_MS, cleanAnnouncement, selectState, applyBroadcast, actName, isAcousticAct, nameClasses, WRAP_CLASS, CLAMP_CLASS, seqLabel, countdownParts, isConnected, monitorMode };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.EtmLive = api;
})(typeof self !== 'undefined' ? self : this);
