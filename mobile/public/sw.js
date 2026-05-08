// ClaudeX mobile PWA service worker.
// Two jobs: handle web-push notifications, and offline shell.
// Aggressively minimal — iOS kills SWs fast.

const CACHE_NAME = 'claudex-mobile-v1'
const SHELL = ['/', '/index.html', '/manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)).catch(() => undefined)
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  // Always go to network for API + WebSocket — never cache.
  if (url.pathname.startsWith('/api/')) return
  // Network-first for everything else, falling back to cache.
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request).then((r) => r || caches.match('/')))
  )
})

self.addEventListener('push', (event) => {
  let payload = { title: 'ClaudeX', body: '' }
  try {
    if (event.data) payload = event.data.json()
  } catch {
    /* keep default */
  }
  const url = payload.url || '/'
  event.waitUntil(
    self.registration.showNotification(payload.title || 'ClaudeX', {
      body: payload.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: payload.sessionId || 'claudex',
      data: { url, sessionId: payload.sessionId }
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if (c.url.includes(url) && 'focus' in c) return c.focus()
      }
      if (self.clients.openWindow) return self.clients.openWindow(url)
      return undefined
    })
  )
})
