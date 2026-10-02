// Service worker: the installed app opens even offline, with the files of its last visit. The
// network comes first, so that a new version is used as soon as it is deployed; Google's requests
// (sign-in, YouTube, Drive) are left alone

const CACHE = 'global-video-feed-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(names.filter(name => name !== CACHE).map(name => caches.delete(name)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', event => {
    const { request } = event;
    if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

    event.respondWith((async () => {
        try {
            const response = await fetch(request);
            if (response.ok) {
                const copy = response.clone();
                event.waitUntil(caches.open(CACHE).then(cache => cache.put(request, copy)));
            }
            return response;
        } catch (error) {
            // Offline: the copy kept, or the page itself for a navigation
            const cached = await caches.match(request) || (request.mode === 'navigate' && await caches.match('./'));
            return cached || Response.error();
        }
    })());
});
