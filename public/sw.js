const CACHE_NAME = 'gpt-image-playground-v0.4.20'
const APP_SHELL = ['./', './index.html', './manifest.webmanifest', './pwa-icon.svg']
const NETWORK_FIRST_DESTINATIONS = new Set(['script', 'style', 'worker'])

function putCache(request, response) {
  if (!response.ok) return
  const copy = response.clone()
  caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          putCache('./index.html', response)
          return response
        })
        .catch(() => caches.match('./index.html')),
    )
    return
  }

  if (NETWORK_FIRST_DESTINATIONS.has(request.destination)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          putCache(request, response)
          return response
        })
        .catch(() => caches.match(request)),
    )
    return
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached

      return fetch(request).then((response) => {
        putCache(request, response)
        return response
      })
    }),
  )
})
