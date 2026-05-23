// Service Worker - FinanceFlow
// Cachea las páginas principales para carga rápida y soporte offline básico.

const CACHE_NAME = 'financeflow-v1';
const OFFLINE_URL = './offline.html';

// Recursos que se cachean al instalar
const PRECACHE_URLS = [
    './',
    './index.html',
    './login.html',
    './register.html',
    './pricing.html',
    './offline.html',
    './public/config.js',
    './public/manifest.json'
];

// Instalación: precachear recursos esenciales
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(PRECACHE_URLS).catch(() => {
                // Si algún recurso falla, no abortar la instalación completa
                return Promise.resolve();
            }))
            .then(() => self.skipWaiting())
    );
});

// Activación: limpiar cachés antiguas
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
            )
        ).then(() => self.clients.claim())
    );
});

// Fetch: estrategia network-first para navegación, cache-first para estáticos
self.addEventListener('fetch', (event) => {
    const { request } = event;

    // No interceptar peticiones a la API ni a dominios externos (Stripe, GoCardless, CDNs)
    const url = new URL(request.url);
    const isApi = url.pathname.includes('/api/');
    const isExternal = url.origin !== self.location.origin;

    if (isApi || isExternal || request.method !== 'GET') {
        return; // dejar pasar a la red directamente
    }

    // Navegación (documentos HTML): network-first, fallback a caché y luego offline
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                    return response;
                })
                .catch(() =>
                    caches.match(request).then((cached) => cached || caches.match(OFFLINE_URL))
                )
        );
        return;
    }

    // Estáticos: cache-first
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
