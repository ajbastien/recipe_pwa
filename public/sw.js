const CACHE_NAME = 'my-recipes-v3';

const APP_SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/idb.js',
  '/sync.js',
  '/import.js',
  '/favicon.svg',
  '/app-icon.png',
  '/app-icon-192.png',
  '/app-icon-512.png',
  '/manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => name.startsWith('my-recipes-') && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname === '/sw.js') {
    event.respondWith(fetch(req));
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    if (url.pathname.startsWith('/api/images/')) {
      event.respondWith(cacheFirst(req));
    } else {
      event.respondWith(fetch(req));
    }
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, '/index.html'));
    return;
  }

  if (/\.(?:html|js|css|webmanifest)$/i.test(url.pathname)) {
    event.respondWith(networkFirst(req, url.pathname));
    return;
  }

  event.respondWith(cacheFirst(req));
});

async function putSafe(cache, key, response) {
  try {
    await cache.put(key, response.clone());
  } catch (err) {
    console.warn('Cache write failed:', err);
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);
  if (cached) return cached;

  const response = await fetch(req);
  if (response && response.ok) {
    await putSafe(cache, req, response);
  }
  return response;
}

async function networkFirst(req, fallbackKey) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetch(req);
    if (!response || !response.ok) throw new Error(`HTTP ${response && response.status}`);
    await putSafe(cache, fallbackKey, response);
    return response;
  } catch {
    return (await cache.match(fallbackKey)) || Response.error();
  }
}
