// ============================================
// PPL-8 SERVICE WORKER — v7
// Strategy:
//   App Shell  → Network-First (HTML, CSS, JS, manifest) — always fresh
//   Fonts/CDN  → Stale-While-Revalidate (serve cached, refresh in bg)
//   API/Gist   → Network-Only (never cache auth requests)
//   Unknown    → Network with Cache Fallback
// ============================================

const CACHE_APP   = 'ppl8-app-v7';
const CACHE_FONTS = 'ppl8-fonts-v1'; // Long-lived; only bust on font changes

const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './data.js',
  './confetti.browser.js',
  './manifest.json'
];

// --- Install: pre-cache app shell only ---
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_APP)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// --- Activate: delete stale app caches, keep font cache ---
self.addEventListener('activate', e => {
  const KEEP = [CACHE_APP, CACHE_FONTS];
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => !KEEP.includes(k)).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// --- Fetch: route-based strategy ---
self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  // 1. Network-Only: GitHub API / Gist (auth tokens must never be cached)
  if (url.hostname === 'api.github.com') {
    e.respondWith(fetch(request));
    return;
  }

  // 2. Network-First: Google Fonts CSS (contains versioned URLs, must be fresh)
  if (url.hostname === 'fonts.googleapis.com') {
    e.respondWith(networkWithFallback(request, CACHE_FONTS));
    return;
  }

  // 3. Stale-While-Revalidate: Google Fonts files (actual woff2 — change rarely)
  if (url.hostname === 'fonts.gstatic.com') {
    e.respondWith(staleWhileRevalidate(request, CACHE_FONTS));
    return;
  }

  // 4. Network-First: App Shell assets (same origin)
  // Always fetch fresh when online; cache is fallback for offline only.
  // This prevents stale-cache bugs when JS/CSS files are updated.
  if (url.origin === self.location.origin) {
    e.respondWith(networkWithFallback(request, CACHE_APP));
    return;
  }

  // 5. Fallback: Network with Cache backup for anything else
  e.respondWith(networkWithFallback(request, CACHE_APP));
});

// ---- Strategy implementations ----

// Stale-While-Revalidate: serve cache immediately, refresh in background
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);

  // If we have a cached response, serve it and revalidate in background
  if (cached) {
    fetchPromise; // fire-and-forget background revalidation
    return cached;
  }
  // No cache: await fetch result, fall back to offline page
  const networkResponse = await fetchPromise;
  return networkResponse || offlineFallback(request);
}

// Network-First with cache fallback
async function networkWithFallback(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    return cached || offlineFallback(request);
  }
}

// Offline fallback: return cached index.html for navigation requests
function offlineFallback(request) {
  if (request.mode === 'navigate') {
    return caches.match('./index.html');
  }
  return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
}

// --- Message: allow app to trigger SW update ---
self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
