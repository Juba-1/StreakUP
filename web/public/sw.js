/* StreakUp PWA — static cache + Web Push retention */
const ASSET_CACHE = 'streakup-assets-v3'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(ASSET_CACHE).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('streakup-assets-') && k !== ASSET_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  if (request.mode === 'navigate') return

  const url = new URL(request.url)
  const sameOrigin = url.origin === self.location.origin

  if (
    url.pathname.includes('/auth/') ||
    url.pathname.includes('/functions/') ||
    url.pathname.includes('/realtime/')
  ) {
    return
  }

  const isStatic =
    /\.(?:js|mjs|css|png|jpg|jpeg|gif|webp|svg|woff2?|ttf|ico)$/i.test(url.pathname) ||
    url.pathname.startsWith('/assets/')

  if (sameOrigin && isStatic) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached
        return fetch(request).then((response) => {
          if (!response || response.status !== 200 || response.type === 'error') return response
          const copy = response.clone()
          void caches.open(ASSET_CACHE).then((cache) => void cache.put(request, copy))
          return response
        })
      }),
    )
  }
})

self.addEventListener('push', (event) => {
  let payload = { title: 'StreakUp', body: '', url: '/', tag: 'streakup' }
  try {
    payload = { ...payload, ...(event.data?.json() ?? {}) }
  } catch {
    payload.body = event.data?.text() ?? payload.body
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      tag: payload.tag ?? 'streakup',
      data: { url: payload.url ?? '/' },
      requireInteraction: true,
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = event.notification.data?.url ?? '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          void client.navigate(target)
          return client.focus()
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target)
    }),
  )
})
