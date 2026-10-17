// ITAM Service Worker — basic offline cache for the app shell + GET API responses.
//
// Strategy:
//   • Pre-cache the app shell (manifest, icons) on install.
//   • Runtime caching: GET /api/itam/* → stale-while-revalidate (network-first
//     with cache fallback so the user can read data offline).
//   • Navigation requests → network-first, fallback to cached "/".
//   • Never cache POST/PUT/DELETE — those need the live server.
//
// Versioned cache name so a bump in CACHE_VERSION invalidates old caches.
//
// DEV-MODE SELF-UNREGISTER:
//   Next.js dev mode (Turbopack) generates chunk URLs that change on every
//   rebuild. If a production-registered SW serves stale chunks to the dev
//   server, the browser throws "module factory is not available" and the
//   page crashes with "This page couldn't load".
//
//   To prevent this, the SW detects dev mode (via a /__itam-dev-mode marker
//   fetch returning 204) and UNREGISTERS ITSELF + clears all caches. The
//   pwa-registration.tsx component also skips registration in dev, but this
//   is a defensive second layer for users who previously visited the
//   production site and still have the SW installed.

const CACHE_VERSION = 'v2'
const SHELL_CACHE = `itam-shell-${CACHE_VERSION}`
const API_CACHE = `itam-api-${CACHE_VERSION}`

const SHELL_ASSETS = [
  '/',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/icon.svg',
  '/logo.svg',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE)
      // Use addAll but tolerate individual failures (one bad asset shouldn't
      // abort the install).
      await Promise.all(
        SHELL_ASSETS.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => null),
        ),
      )
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // ── DEV-MODE SELF-UNREGISTER ──
      // Detect dev mode by fetching a marker endpoint that only exists in dev.
      // In dev, Next.js serves /_next/static/* with short-lived cache; in
      // production these are immutable. If the marker returns 204, we're in
      // dev mode and should NOT run the SW at all (it would serve stale
      // chunks and crash the page).
      try {
        const probe = await fetch('/api/dev-sw-probe', { cache: 'no-store' })
        if (probe.status === 204) {
          console.info('[SW] dev mode detected — self-unregistering + clearing caches')
          const allKeys = await caches.keys()
          await Promise.all(allKeys.map((k) => caches.delete(k)))
          const regs = await self.registration?.unregister?.()
          if (regs) {
            // Tell all open clients to reload so the SW is fully gone.
            const clients = await self.clients.matchAll({ type: 'window' })
            for (const c of clients) {
              try {
                await c.navigate(c.url)
              } catch {
                // ignore
              }
            }
          }
          return
        }
      } catch {
        // Probe failed (404 in production, or network error) — assume production.
      }

      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== API_CACHE)
          .map((k) => caches.delete(k)),
      )
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  // Only handle GET — never intercept mutations.
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  // Skip cross-origin requests (e.g. fonts from Google).
  if (url.origin !== self.location.origin) return

  // Skip Next.js dev/HMR endpoints.
  if (url.pathname.startsWith('/_next/webpack-hmr')) return

  // Navigation requests → network-first, fallback to cached "/".
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req)
          const cache = await caches.open(SHELL_CACHE)
          cache.put('/', fresh.clone()).catch(() => null)
          return fresh
        } catch {
          const cache = await caches.open(SHELL_CACHE)
          const cached = (await cache.match('/')) || (await cache.match(req))
          if (cached) return cached
          return new Response('ออฟไลน์ — ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          })
        }
      })(),
    )
    return
  }

  // API GET requests → stale-while-revalidate (read offline, refresh in bg).
  if (url.pathname.startsWith('/api/itam/') && !url.pathname.startsWith('/api/itam/events')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(API_CACHE)
        const cached = await cache.match(req)
        const network = fetch(req)
          .then((res) => {
            // Only cache successful responses (skip 401/403/500).
            if (res && res.ok && res.status === 200) {
              cache.put(req, res.clone()).catch(() => null)
            }
            return res
          })
          .catch(() => null)
        // Return cached immediately if available; otherwise wait for network.
        if (cached) {
          // Refresh in background — don't await.
          network.catch(() => null)
          return cached
        }
        const fresh = await network
        if (fresh) return fresh
        return new Response(
          JSON.stringify({ error: 'offline', message: 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } },
        )
      })(),
    )
    return
  }

  // Static assets (icons, manifest, _next/static) → cache-first.
  if (
    url.pathname.startsWith('/_next/static') ||
    SHELL_ASSETS.includes(url.pathname) ||
    /\.(?:png|jpg|jpeg|svg|webp|ico|woff2?)$/.test(url.pathname)
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE)
        const cached = await cache.match(req)
        if (cached) return cached
        try {
          const fresh = await fetch(req)
          if (fresh && fresh.ok) cache.put(req, fresh.clone()).catch(() => null)
          return fresh
        } catch {
          return new Response('', { status: 504 })
        }
      })(),
    )
  }
})

// Allow the page to trigger an immediate update.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})

// ── Web Push Notifications ──────────────────────────────────
// SPRINT-5: Handle push events from the server (web-push library).
// The push payload is a JSON string: { title, body, url, tag, icon }

self.addEventListener('push', (event) => {
  if (!event.data) return

  let payload
  try {
    payload = event.data.json()
  } catch {
    payload = { title: 'ITAM Notification', body: event.data.text() }
  }

  const options = {
    body: payload.body || '',
    icon: payload.icon || '/icon-192.png',
    badge: '/icon-192.png',
    tag: payload.tag || 'itam-notification',
    data: {
      url: payload.url || '/',
    },
    requireInteraction: false,
    vibrate: [200, 100, 200],
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || 'ITAM', options)
  )
})

// Handle notification click — open the app at the specified URL
self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const targetUrl = event.notification.data?.url || '/'

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If app is already open, focus it + navigate to URL
      for (const client of clientList) {
        if (client.url.includes(self.location.origin)) {
          client.navigate(targetUrl)
          return client.focus()
        }
      }
      // Otherwise open a new window
      return clients.openWindow(targetUrl)
    })
  )
})
