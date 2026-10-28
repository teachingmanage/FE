// Service worker for the Teaching Manager PWA.
//
// It caches the app shell (the static assets) so the app opens instantly and
// works offline. API calls are deliberately NEVER cached: they carry the
// user's session, and a cached response could show one user's data to
// another user on a shared device.

const CACHE_NAME = "teaching-v1";

// The app shell. Next.js emits these under /_next/static, so they are safe
// to cache — they are content-hashed and immutable.
const SHELL = ["/", "/manifest.webmanifest", "/icon-192x192.png", "/icon-512x512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Only GET requests are cacheable.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never touch the API — it is authenticated and user specific.
  if (url.pathname.startsWith("/api/")) return;

  // Only same-origin requests.
  if (url.origin !== self.location.origin) return;

  // Navigations: network first, so a fresh deploy is picked up immediately,
  // with the cached shell as the offline fallback.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match("/"))
        )
    );
    return;
  }

  // Static assets: cache first, they are immutable.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
