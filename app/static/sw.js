// Service Worker for EMA Paattukoottam Stage Console
// Enables offline loading of the console UI shell and assets.

const CACHE_NAME = 'paattukoottam-console-v13';

const SHELL_URLS = [
  '/console',
  '/static/admin.html',
  '/static/css/style.css',
  '/static/js/admin.js',
  '/static/js/console/vault-store.js',
  '/static/js/console/offline-actions.js',
  '/static/js/nav.js',
  '/static/js/utils.js',
  '/static/css/app.css?v=1',
  '/static/vendor/lucide.min.js',
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
