// Classic-script wake lock for TV pages (feature detected; re-requested on visibilitychange).
(function (root) {
  'use strict';
  function start() {
    const nav = root.navigator, doc = root.document;
    if (!nav || !nav.wakeLock || typeof nav.wakeLock.request !== 'function') return { supported: false };
    let sentinel = null;
    async function acquire() {
      if (doc.visibilityState !== 'visible' || (sentinel && !sentinel.released)) return;
      try {
        sentinel = await nav.wakeLock.request('screen');
        sentinel.addEventListener('release', () => { sentinel = null; });
      } catch (e) { sentinel = null; }
    }
    doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'visible') acquire(); });
    doc.addEventListener('pointerdown', acquire);
    acquire();
    return { supported: true };
  }
  root.EtmWakeLock = { start };
})(typeof self !== 'undefined' ? self : this);
