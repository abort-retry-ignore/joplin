const CACHE_NAME = 'joplock-shell-v2';
const PRECACHE_URLS = ['/app.js', '/styles.css', '/manifest.webmanifest', '/icon.svg'];

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
	const url = new URL(event.request.url);
	if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/joplin/')) return;

	event.respondWith(
		(async () => {
			if (event.request.mode === 'navigate' || url.pathname === '/') {
				return fetch(event.request);
			}

			const cached = await caches.match(event.request);
			if (cached) return cached;
			return fetch(event.request);
		})(),
	);
});
