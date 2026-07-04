// Service Worker - FinanceFlow
// IMPORTANTE: NO cachea páginas HTML ni JS de la app, para que los usuarios
// siempre reciban la última versión. Solo cachea imágenes/iconos estáticos.

const CACHE_NAME = 'financeflow-v2'; // subir versión fuerza limpieza de la caché vieja
const OFFLINE_URL = './offline.html';

const PRECACHE_URLS = [
    './offline.html',
    './public/logo.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(PRECACHE_URLS).catch(() => Promise.resolve()))
            .then(() => self.skipWaiting())
    );
});

// Activación: BORRAR todas las cachés antiguas (incluida la v1 que servía HTML viejo)
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.map((k) => caches.delete(k)))
        ).then(() => caches.open(CACHE_NAME))
         .then((cache) => cache.addAll(PRECACHE_URLS).catch(() => Promise.resolve()))
         .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    if (url.pathname.includes('/api/') || url.origin !== self.location.origin || request.method !== 'GET') {
        return;
    }

    const isHTML = request.mode === 'navigate' || url.pathname.endsWith('.html');
    const isAppCode = url.pathname.endsWith('.js') || url.pathname.endsWith('.css');

    if (isHTML || isAppCode) {
        event.respondWith(
            fetch(request).catch(() => {
                if (isHTML) return caches.match(OFFLINE_URL);
                return new Response('', { status: 504 });
            })
        );
        return;
    }

    event.respondWith(
        caches.match(request).then((cached) =>
            cached ||
            fetch(request).then((response) => {
                const copy = response.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                return response;
            }).catch(() => cached)
        )
    );
});

// ── Web Push ──────────────────────────────────────────────────────────────
// Rutas absolutas: el SW vive en /public/, así que las relativas no apuntarían
// a la raíz de la app.
self.addEventListener('push', (event) => {
    let payload = {};
    try {
        payload = event.data ? event.data.json() : {};
    } catch (e) {
        payload = { title: 'FinanceFlow', body: event.data ? event.data.text() : '' };
    }
    event.waitUntil(
        self.registration.showNotification(payload.title || 'FinanceFlow', {
            body: payload.body || '',
            icon: '/public/logo.png',
            badge: '/public/logo.png',
            tag: payload.tag || undefined,
            data: { url: payload.url || '/dashboard.html' }
        })
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = (event.notification.data && event.notification.data.url) || '/dashboard.html';
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
            for (const client of list) {
                if ('focus' in client) {
                    if (client.navigate) client.navigate(url);
                    return client.focus();
                }
            }
            return clients.openWindow(url);
        })
    );
});
