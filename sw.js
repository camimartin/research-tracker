// Minimal service worker so the tracker can be installed to a phone home screen.
// Network-first: you always get the latest version when online; the cached
// copy is only used to open the app shell when offline.

const CACHE = 'research-tracker-v2';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
  await self.clients.claim();
})()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === location.origin;
  if (!sameOrigin && url.hostname !== 'esm.sh') return;
  e.respondWith(
    // Our own files: always ask the server whether there's a newer version
    // (GitHub Pages otherwise lets browsers reuse a stale copy for 10 minutes).
    fetch(req, sameOrigin ? { cache: 'no-cache' } : undefined)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req)),
  );
});
