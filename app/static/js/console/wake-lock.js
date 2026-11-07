// Screen wake lock with re-request on visibility change. Feature detected.
export function createWakeLock(nav = globalThis.navigator, doc = globalThis.document) {
  let sentinel = null;
  let wanted = false;
  const supported = Boolean(nav && nav.wakeLock && typeof nav.wakeLock.request === 'function');

  async function acquire() {
    if (!supported || !wanted) return false;
    if (doc && doc.visibilityState && doc.visibilityState !== 'visible') return false;
    if (sentinel && !sentinel.released) return true;
    try {
      sentinel = await nav.wakeLock.request('screen');
      if (sentinel && typeof sentinel.addEventListener === 'function') {
        sentinel.addEventListener('release', () => { sentinel = null; });
      }
      return true;
    } catch (e) {
      sentinel = null;
      return false;
    }
  }

  if (supported && doc && typeof doc.addEventListener === 'function') {
    doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'visible') acquire(); });
  }

  return {
    supported,
    async enable() { wanted = true; return acquire(); },
    async disable() {
      wanted = false;
      if (sentinel) { try { await sentinel.release(); } catch (e) {} sentinel = null; }
    },
  };
}
