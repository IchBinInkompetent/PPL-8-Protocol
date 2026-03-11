const CACHE_NAME = 'ppl8-tracker-v4';
const ASSETS = [
    './index.html',
    './style.css',
    './app.js',
    './data.js',
    './manifest.json'
];

self.addEventListener('install', e => {
    e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
    self.skipWaiting();
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', e => {
    e.respondWith(
        caches.match(e.request).then(cached => cached || fetch(e.request))
    );
});

// Graceful update: allow reload trigger from app
self.addEventListener('message', e => {
    if (e.data && e.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
