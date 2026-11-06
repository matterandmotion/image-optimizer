/// <reference lib="webworker" />
// Service worker: keeps the app and its image engines in Cache Storage so the tool works
// offline after the first visit. Built to /sw.js by the `serviceWorker` plugin in
// vite.config.ts, which fills in the two constants below.

declare const self: ServiceWorkerGlobalScope
/** Cache name; changes whenever any precached file changes. */
declare const __SW_CACHE__: string
/** Files to download on install, relative to the scope. `''` is the page itself. */
declare const __SW_PRECACHE__: string[]

const CACHE = __SW_CACHE__
const PREFIX = 'image-optimizer-'
const scope = new URL(self.registration.scope)
/** Hashed or versioned files can come from the HTTP cache; anything else is re-fetched. */
const immutable = (url: URL) => /\/(assets|vendor)\//.test(url.pathname)

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      await cache.addAll(
        __SW_PRECACHE__.map((path) => {
          const url = new URL(path, scope)
          return new Request(url, { cache: immutable(url) ? 'default' : 'reload' })
        }),
      )
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key)
      await self.clients.claim()
    })(),
  )
})

// The page asks for this when the person chooses to reload into a new version.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'skip-waiting') void self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== scope.origin) return

  if (request.mode === 'navigate') {
    // The app is one page; serve the cached copy, whose COOP/COEP/CSP headers came with it.
    if (url.pathname !== scope.pathname && url.pathname !== `${scope.pathname}index.html`) return
    event.respondWith(fromCache(scope.href, request))
    return
  }
  if (immutable(url)) event.respondWith(fromCache(request, request, true))
})

/**
 * Cache first, then the network. With `keep`, a successful network response is cached too:
 * files that aren't precached (other font subsets, the single-threaded AVIF build) stay
 * available offline once they've been used.
 */
async function fromCache(key: RequestInfo, request: Request, keep = false): Promise<Response> {
  const cache = await caches.open(CACHE)
  // ignoreVary: servers add `Vary` (Origin, Accept-Encoding) that no lookup here should depend on.
  const hit = await cache.match(key, { ignoreSearch: true, ignoreVary: true })
  if (hit) return hit
  const response = await fetch(request)
  // Some hosts answer unknown paths with the app's HTML; never cache that as an asset.
  const html = response.headers.get('content-type')?.startsWith('text/html')
  if (keep && response.ok && response.type === 'basic' && !html)
    await cache.put(request, response.clone())
  return response
}
