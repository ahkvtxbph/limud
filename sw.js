// Service worker for offline support. Deliberately NETWORK-FIRST (not cache-first):
// whenever the device is online, it always fetches the live file from the server and
// updates the cache — the cache is used only as a fallback when truly offline. This
// avoids the service worker itself becoming a source of "stale file" bugs.
//
// IMPORTANT: bump CACHE_NAME (e.g. 'limood-v2') on any deployment where you want to
// force-invalidate old cached entries for returning offline users.
const CACHE_NAME = 'limood-v1';

// Sefaria/Hebcal API calls and anything cross-origin are NEVER touched by this worker
// (always go straight to the network) — that content changes daily and must stay fresh.
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  let url;
  try{ url = new URL(req.url); }catch(e){ return; }

  // Only handle same-origin GET requests (the app shell itself); let every other
  // request (external APIs, POSTs, etc.) pass straight through untouched.
  if(req.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then((response) => {
        if(response && response.status === 200){
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return response;
      })
      .catch(() => caches.match(req))
  );
});
