// Service worker for offline support and fast page-to-page moves.
//
// Two rules:
//  1. The PAGES themselves are NETWORK-FIRST: whenever the device is online they are always
//     fetched live from the server (so an update is seen immediately), and the cache is used
//     only as a fallback when truly offline.
//  2. Files whose address carries the site's BUILD number (shared.js?build=…, shared.css?build=…)
//     never change under that address — every deployment gives them a new number (GitHub Pages /
//     Jekyll fills it in automatically). So they are served straight from the cache: downloaded
//     once per deployment, then instant on every page. Older builds are removed as new ones arrive.
//
// Sefaria/Hebcal API calls and anything cross-origin are NEVER touched by this worker.
//
// Bump CACHE_NAME (e.g. 'limood-v4') only if old cached entries must be thrown away for everyone.
const CACHE_NAME = 'limood-v3';

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

  // Only same-origin GET requests (the site itself); everything else passes straight through.
  if(req.method !== 'GET' || url.origin !== self.location.origin) return;

  if(url.searchParams.has('build')){
    event.respondWith(cacheFirst(req, url));
    return;
  }
  event.respondWith(networkFirst(req));
});

async function cacheFirst(req, url){
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(req);
  if(hit) return hit;
  try{
    const response = await fetch(req);
    if(response && response.status === 200){
      await cache.put(req, response.clone());
      // keep just this build of the file
      const keys = await cache.keys();
      await Promise.all(keys.filter((k) => {
        const u = new URL(k.url);
        return u.pathname === url.pathname && u.searchParams.has('build') && u.search !== url.search;
      }).map((k) => cache.delete(k)));
    }
    return response;
  }catch(e){
    // offline and this exact build was never stored: any stored build of the same file is
    // better than nothing
    const any = await cache.match(req, { ignoreSearch: true });
    if(any) return any;
    throw e;
  }
}

function networkFirst(req){
  // cache: 'no-store' bypasses the browser's own HTTP cache too, so "network-first" really
  // means the live server, never a silently stale HTTP-cached copy.
  return fetch(req, { cache: 'no-store' })
    .then((response) => {
      if(response && response.status === 200){
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
      }
      return response;
    })
    .catch(() => caches.match(req));
}
