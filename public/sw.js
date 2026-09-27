const CACHE_NAME = '1think2wins-cache-v2';
const ASSETS_TO_CACHE = [
  '/',
  '/manifest.json',
  '/Favicon/apple-touch-icon.png',
  '/Favicon/favicon.ico',
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (cacheNames) {
      return Promise.all(
        cacheNames.map(function (cacheName) {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (event) {
  const isQuizApi = event.request.url.includes('/api/quizzes/') && event.request.url.match(/\/api\/quizzes\/[a-zA-Z0-9_-]+$/);

  // Only cache GET requests and skip chrome-extension/api/admin requests
  if (
    event.request.method !== 'GET' || 
    event.request.url.includes('/admin') ||
    !event.request.url.startsWith(self.location.origin)
  ) {
    return;
  }

  // Skip API routes except for the quiz detail endpoint (which is cached for offline mode)
  if (event.request.url.includes('/api/') && !isQuizApi) {
    return;
  }

  // Network-First strategy for active quiz questions endpoint
  if (isQuizApi) {
    event.respondWith(
      fetch(event.request).then(function (networkResponse) {
        if (networkResponse && networkResponse.status === 200) {
          const cacheCopy = networkResponse.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(event.request, cacheCopy);
          });
        }
        return networkResponse;
      }).catch(function (err) {
        console.log('[Service Worker] Quiz API fetch failed, serving cache:', err);
        return caches.match(event.request);
      })
    );
    return;
  }

  // Network-First strategy for page/document navigation requests (prevents stale HTML after deployments)
  const isHtml = event.request.mode === 'navigate' || 
                 (event.request.headers.get('accept') && event.request.headers.get('accept').includes('text/html'));

  if (isHtml) {
    event.respondWith(
      fetch(event.request).then(function (networkResponse) {
        if (networkResponse && networkResponse.status === 200) {
          const cacheCopy = networkResponse.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(event.request, cacheCopy);
          });
        }
        return networkResponse;
      }).catch(function (err) {
        console.log('[Service Worker] Page fetch failed, serving cached shell:', err);
        return caches.match(event.request);
      })
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.match(event.request).then(function (cachedResponse) {
        const fetchPromise = fetch(event.request).then(function (networkResponse) {
          if (networkResponse && networkResponse.status === 200) {
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        }).catch(function (err) {
          console.log('[Service Worker] Fetch failed, serving cache if available:', err);
        });
        
        return cachedResponse || fetchPromise;
      });
    })
  );
});

self.addEventListener('push', function (event) {
  if (event.data) {
    try {
      const data = event.data.json();
      const title = data.title || '1Think2Win';
      const options = {
        body: data.body || '',
        icon: data.icon || '/Favicon/apple-touch-icon.png',
        badge: data.badge || '/Favicon/favicon.ico',
        tag: data.tag || undefined,
        renotify: data.tag ? true : undefined,
        data: {
          url: data.url || '/'
        },
        vibrate: [100, 50, 100],
        actions: data.actions || []
      };
      event.waitUntil(self.registration.showNotification(title, options));
    } catch (e) {
      console.error('Error parsing push data:', e);
      const text = event.data.text();
      event.waitUntil(
        self.registration.showNotification('1Think2Win', {
          body: text,
          icon: '/Favicon/apple-touch-icon.png',
          data: { url: '/' }
        })
      );
    }
  }
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  
  let targetUrl = '/';
  if (event.notification.data && event.notification.data.url) {
    targetUrl = event.notification.data.url;
  }
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windowClients) {
      // If we find a client that can be navigated or focused
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if ('focus' in client) {
          // If we want to navigate it to the target URL
          if ('navigate' in client) {
            client.navigate(targetUrl);
          }
          return client.focus();
        }
      }
      
      if (clients.openWindow) {
        const absoluteUrl = new URL(targetUrl, self.location.origin).href;
        return clients.openWindow(absoluteUrl);
      }
    })
  );
});
