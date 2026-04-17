const CACHE_NAME = 'joplock-shell-v1';
const PRECACHE_URLS = ['/', '/styles.css', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', event => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE_NAME);
			await cache.addAll(PRECACHE_URLS);
		})(),
	);
	self.skipWaiting();
});

self.addEventListener('activate', event => {
	event.waitUntil(
		(async () => {
			const keys = await caches.keys();
			await Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)));
		})(),
	);
	self.clients.claim();
});

self.addEventListener('fetch', event => {
	if (event.request.method !== 'GET') return;

	event.respondWith(
		(async () => {
			const cached = await caches.match(event.request);
			if (cached) return cached;
			return fetch(event.request);
		})(),
	);
});
