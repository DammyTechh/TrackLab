/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

// vite-plugin-pwa injects the precache list here at build time.
declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// Photos and SOPs: cache first, they never change in place.
registerRoute(
  ({ url }) => url.pathname.includes('/storage/v1/object/'),
  new CacheFirst({
    cacheName: 'equipment-files',
    plugins: [new ExpirationPlugin({ maxEntries: 400, maxAgeSeconds: 30 * 24 * 60 * 60 })],
  }),
);

// Passport reads: network first, fall back to the last good copy.
registerRoute(
  ({ url }) => url.pathname.endsWith('/rpc/get_public_equipment'),
  new NetworkFirst({ cacheName: 'passports', networkTimeoutSeconds: 4 }),
);

self.addEventListener('push', (event) => {
  const payload = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(payload.title ?? 'EvidenceTag', {
      body: payload.body ?? '',
      icon: '/brand/icon-192.png',
      badge: '/brand/icon-192.png',
      tag: payload.equipment_id,
      data: payload,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow('/notifications'));
});
