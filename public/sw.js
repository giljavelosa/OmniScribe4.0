/* OmniScribe Service Worker — Unit 36.
 *
 * Hand-rolled, intentionally minimal. Three cache surfaces:
 *
 *   - `omniscribe-static-v1` — Next static chunks + icons + manifest +
 *     /offline fallback. Cache-first. Survives navigation; revalidates
 *     when the SW version bumps (CACHE_VERSION).
 *   - `omniscribe-pages-v1` — top-level page HTML. Network-first with
 *     cache fallback so a clinician who loaded /home then lost network
 *     can still see the shell.
 *   - (No api cache.) /api/* requests are NEVER cached or fallback-
 *     served. PHI risk + bypasses the audit trail. API failures
 *     surface to the caller for proper handling.
 *
 * Lifecycle:
 *   - install: pre-cache the static shell + /offline page.
 *   - activate: drop old cache versions.
 *   - fetch: route by request type (page vs static vs api).
 */

const CACHE_VERSION = 'v1';
const STATIC_CACHE = `omniscribe-static-${CACHE_VERSION}`;
const PAGES_CACHE = `omniscribe-pages-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  '/offline',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) =>
        // addAll fails-fast on any missing URL; in dev the icons may not
        // exist yet — add each individually + ignore per-URL failures so
        // the SW still installs.
        Promise.all(
          PRECACHE_URLS.map((url) =>
            cache.add(url).catch(() => {
              /* ignore — likely missing in dev */
            }),
          ),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('omniscribe-') && !k.endsWith(CACHE_VERSION))
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // pass through POST/PATCH/DELETE

  const url = new URL(req.url);

  // Don't intercept cross-origin requests (Bedrock, Soniox, etc).
  if (url.origin !== self.location.origin) return;

  // /api/* — never cached, never offline-fallback (PHI + audit).
  if (url.pathname.startsWith('/api/')) return;

  // Static assets — cache-first.
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/manifest.json'
  ) {
    event.respondWith(cacheFirst(req, STATIC_CACHE));
    return;
  }

  // Page navigations — network-first with /offline fallback.
  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith(networkFirstWithOffline(req));
  }
});

async function cacheFirst(req, cacheName) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok) {
      const cache = await caches.open(cacheName);
      cache.put(req, res.clone());
    }
    return res;
  } catch (err) {
    // Truly offline + uncached. Bubble up.
    throw err;
  }
}

async function networkFirstWithOffline(req) {
  try {
    const res = await fetch(req);
    if (res.ok) {
      const cache = await caches.open(PAGES_CACHE);
      cache.put(req, res.clone());
    }
    return res;
  } catch (err) {
    const cached = await caches.match(req);
    if (cached) return cached;
    const offline = await caches.match('/offline');
    if (offline) return offline;
    // Last resort.
    throw err;
  }
}
