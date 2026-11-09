// Service Worker for EMA Paattukoottam Stage Console
// Enables offline loading of the console UI shell and assets.

const CACHE_NAME = 'paattukoottam-console-v22';

const SHELL_URLS = [
  '/console',
  '/static/admin.html',
  '/static/css/style.css',
  '/static/css/a11y.css',
  '/static/css/tokens.css',
  '/static/css/theme.css',
  '/static/css/console.css',
  '/static/css/stage-monitor.css',
  '/static/vendor/fonts/inter-latin-wght-normal.woff2',
  '/static/vendor/fonts/jetbrains-mono-latin-wght-normal.woff2',
  '/static/js/icons.js',
  '/static/vendor/icons.svg',
  '/static/js/admin.js',
  '/static/js/console/vault-store.js',
  '/static/js/console/offline-actions.js',
  '/static/js/console/stage-monitor-sync.js',
  '/static/js/console/transport.js',
  '/static/js/console/deck-policy.js',
  '/static/js/console/hold-confirm.js',
  '/static/js/console/fade.js',
  '/static/js/console/loudness.js',
  '/static/js/console/state.js',
  '/static/js/console/util.js',
  '/static/js/console/stage-sync.js',
  '/static/js/console/audio-engine.js',
  '/static/js/console/disruption.js',
  '/static/js/console/vault-ui.js',
  '/static/js/console/offline-sync.js',
  '/static/js/console/player-bar.js',
  '/static/js/console/deck.js',
  '/static/js/console/act-actions.js',
  '/static/js/console/sync-order.js',
  '/static/js/console/queue-render.js',
  '/static/js/console/queue-load.js',
  '/static/js/console/action-buttons.js',
  '/static/js/console/hotkeys.js',
  '/static/js/console/console-upgrades.js',
  '/static/js/console/reorder.js',
  '/static/js/console/vault-sync.js',
  '/static/js/console/screens.js',
  '/static/js/console/login.js',
  '/static/js/console/wake-lock.js',
  '/static/js/console/output-device.js',
  '/static/js/live/live-logic.js',
  '/static/js/live/wake-lock-lite.js',
  '/static/js/stage-lyrics.js',
  '/static/js/stage-monitor.js',
  '/static/js/nav.js',
  '/static/js/utils.js',
  '/static/css/app.css?v=1',
  '/static/vendor/wavesurfer.min.js'
];

self.addEventListener('install', (event) => {
  // Do not replace the active worker unless the complete offline shell is ready.
  event.waitUntil((async () => {
    const existed = (await caches.keys()).includes(CACHE_NAME);
    try {
      const responses = await Promise.all(SHELL_URLS.map(async (url) => {
        const response = await fetch(url, { cache: 'reload' });
        if (!response.ok) throw new Error(`Could not cache console shell: ${url}`);
        return response;
      }));
      const cache = await caches.open(CACHE_NAME);
      await Promise.all(SHELL_URLS.map((url, i) => cache.put(url, responses[i])));
      await self.skipWaiting();
    } catch (error) {
      if (!existed) await caches.delete(CACHE_NAME);
      throw error;
    }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key.startsWith('paattukoottam-console-') && key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Skip non-GET requests and API calls (IndexedDB handles audio and offline action queueing)
  if (request.method !== 'GET' || url.pathname.startsWith('/api/')) {
    return;
  }

  // The console alone has an offline HTML shell. Other navigations use the
  // network directly; they must never receive a stale page or the console.
  if (request.mode === 'navigate' && url.pathname !== '/console') return;

  if (request.mode === 'navigate' && url.pathname === '/console') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          return caches.match('/console').then((res) => res || caches.match('/static/admin.html'));
        })
    );
    return;
  }

  // Only same-origin static assets may use this cache; never cache HTML, JSON,
  // event data or cross-origin responses from other pages.
  if (url.origin !== self.location.origin || !url.pathname.startsWith('/static/') ||
      /\.(?:html?|json)$/i.test(url.pathname)) return;

  // Console HTML uses a timestamp query on admin.js. Cache it under one
  // stable key so the installed shell works before the first online visit.
  const cacheKey = url.pathname === '/static/js/admin.js' ? url.origin + url.pathname : request;
  // Static assets: network first, then cache.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(cacheKey, clone));
        }
        return response;
      })
      .catch(() => {
        return caches.match(cacheKey);
      })
  );
});
