// Service Worker for EMA Paattukoottam Stage Console
// Enables offline loading of the console UI shell and assets.

const CACHE_NAME = 'paattukoottam-console-v2';

const SHELL_URLS = [
  '/console',
  '/static/admin.html',
  '/static/css/style.css',
  '/static/js/admin.js',
  '/static/js/nav.js',
  '/static/js/utils.js',
  '/static/css/app.css?v=1',
  '/static/vendor/lucide.min.js',
  '/static/vendor/wavesurfer.min.js'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Cache core shell files, a failed fetch must not block install
      return Promise.allSettled(
        SHELL_URLS.map((url) =>
          fetch(url, { cache: 'reload' })
            .then((res) => {
              if (res.ok) return cache.put(url, res);
            })
            .catch((err) => {
              console.warn('[SW] Failed to pre-cache', url, err);
            })
        )
      );
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
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

  // HTML Navigation request for /console
  if (request.mode === 'navigate' || url.pathname === '/console') {
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

  // Static assets (CSS, JS, icons, vendored libs): Network-first with cache fallback
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
        return caches.match(request);
      })
  );
});
