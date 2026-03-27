/* ============================================================
   Yggdrasil Online — Service Worker v1.1
   ============================================================ */

const CACHE_NAME = 'ygg-cache-v1.1'; // Change this version to force an update

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/src/style.css',
  '/src/app.js',
  // 3D Models (Add your specific models here)
  '/src/models/idle.glb',
  // External Libraries (CDN)
  'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
  'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js',
  'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/DRACOLoader.js'
];

// 1. Install Event: Pre-cache core game files
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Pre-caching game assets');
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// 2. Activate Event: Clean up old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Removing old cache:', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  return self.clients.claim();
});

// 3. Fetch Event: Strategy optimized for Gaming
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // STRATEGY A: Network-Only for Firebase (Real-time data shouldn't be cached)
  if (url.hostname.includes('firebaseio.com') || url.hostname.includes('firestore.googleapis.com')) {
    return; 
  }

  // STRATEGY B: Cache-First for Assets, Models, and Fonts
  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;

      return fetch(e.request).then((networkResponse) => {
        // Only cache valid successful responses
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }

        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(e.request, responseToCache);
        });

        return networkResponse;
      }).catch(() => {
        // Fallback if both fail (Offline mode)
        if (e.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});