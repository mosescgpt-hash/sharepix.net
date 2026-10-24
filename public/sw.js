const CACHE_NAME = 'sharepix-shell-v2';
// The offline booth kiosk (docs/booth-mode.md): its page and the scripts it
// loaded, so it keeps working — even after a reload — with no signal.
const KIOSK_CACHE = 'sharepix-kiosk-v1';
const OFFLINE_URL = '/offline.html';
const STATIC_ASSETS = [
  OFFLINE_URL,
  '/manifest.webmanifest',
  '/icons/app-icon-192.png',
  '/icons/app-icon-512.png',
  '/icons/apple-touch-icon.png',
];
const KEEP = [CACHE_NAME, KIOSK_CACHE];

function isKioskPage(url) {
  return url.origin === self.location.origin && /^\/booth\/kiosk\/[^/]+\/?$/.test(url.pathname);
}

// Build output is content-hashed and public: safe to keep, never stale.
function isBuildAsset(url) {
  return url.origin === self.location.origin && url.pathname.startsWith('/_next/static/');
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => !KEEP.includes(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// The kiosk page asks to be saved, with the scripts it already loaded (the
// very first visit happens before this worker controls the page).
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type !== 'save-kiosk' || !Array.isArray(data.urls)) return;
  const urls = data.urls
    .map((u) => {
      try {
        return new URL(u, self.location.origin);
      } catch {
        return null;
      }
    })
    .filter((u) => u && (isKioskPage(u) || isBuildAsset(u)))
    .map((u) => (isKioskPage(u) ? u.origin + u.pathname.replace(/\/$/, '') : u.href));
  event.waitUntil(
    caches.open(KIOSK_CACHE).then((cache) =>
      Promise.all(urls.map((u) => cache.match(u).then((hit) => hit || cache.add(u).catch(() => undefined)))),
    ),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  if (event.request.mode === 'navigate' && isKioskPage(url)) {
    // Network first so a deploy shows up; the saved copy when offline. The
    // page is the same static shell for every visitor — it holds no contact
    // details, which live only in memory and in the code on screen.
    const key = url.origin + url.pathname.replace(/\/$/, '');
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(KIOSK_CACHE).then((cache) => cache.put(key, copy));
          }
          return response;
        })
        .catch(() =>
          caches.match(key).then((hit) => hit || caches.match(OFFLINE_URL)),
        ),
    );
    return;
  }

  if (isBuildAsset(url)) {
    // Cache-first for what the kiosk saved; everything else just passes
    // through (and is saved only when the kiosk is the one asking).
    event.respondWith(
      caches.match(event.request).then(async (hit) => {
        if (hit) return hit;
        const response = await fetch(event.request);
        if (response.ok && event.clientId) {
          const client = await self.clients.get(event.clientId);
          if (client && isKioskPage(new URL(client.url))) {
            const copy = response.clone();
            caches.open(KIOSK_CACHE).then((cache) => cache.put(event.request, copy));
          }
        }
        return response;
      }),
    );
    return;
  }

  if (event.request.mode !== 'navigate') return;
  // Other pages, authenticated responses, APIs, and signed photo URLs are always network-only.
  // The cache is used solely as a harmless offline navigation fallback.
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_URL)));
});
