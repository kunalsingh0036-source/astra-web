// astra-sw.js — Service Worker for Web Push on iOS PWA + desktop.
//
// Scope: '/' (registered from the root so it can intercept any URL).
// Responsibilities:
//   1. receive push events from Apple's / Google's push gateway
//   2. show a native-looking notification
//   3. on click, open (or focus) the URL the notification carried
//
// We deliberately don't cache anything here — Next.js already ships
// its own caching via Turbopack/RSC, and mixing that with a custom SW
// caches is a great way to produce stale-page bugs. Pure push handler.

self.addEventListener('install', (event) => {
  // skipWaiting so the new SW activates on first install without the
  // user having to close every tab first.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // claim() so any already-open tab starts using this SW immediately,
  // not just freshly-loaded ones.
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // Some gateways send empty pushes — show a generic fallback.
    data = {};
  }

  const title = data.title || 'Astra';
  const options = {
    body: data.body || '',
    icon: data.icon || '/favicon.svg',
    badge: data.badge || '/favicon.svg',
    tag: data.tag || 'astra',
    // Always renotify even when a previous notification with the same
    // tag exists — tags collapse in the tray but we still want the
    // ping/sound the second time.
    renotify: true,
    // Stash the URL so notificationclick can open the right page.
    data: { url: data.url || '/' },
    // iOS respects this — keeps the banner visible till user taps.
    requireInteraction: false,
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil((async () => {
    const all = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });
    // If any open Astra tab exists, focus + navigate it.
    for (const client of all) {
      if ('focus' in client) {
        client.focus();
        if ('navigate' in client && targetUrl) {
          try {
            await client.navigate(targetUrl);
          } catch {
            // Fallback to postMessage if cross-origin navigation blocked
          }
        }
        return;
      }
    }
    // No open tab — open a new one.
    if (self.clients.openWindow) {
      await self.clients.openWindow(targetUrl);
    }
  })());
});
