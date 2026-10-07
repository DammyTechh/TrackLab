import { registerSW } from 'virtual:pwa-register';

/**
 * Keeps every device on the current version.
 *
 * The service worker (src/sw.ts) takes over as soon as a new version is
 * installed. This moves the open page onto it: the page reloads, unless the
 * person has typed anything since it loaded, in which case nothing is
 * interrupted and the new version loads on their next visit.
 */
export function registerUpdates(): void {
  if (!('serviceWorker' in navigator)) return;

  // No worker yet means a first visit: nothing old to replace.
  const replacingAnOldVersion = Boolean(navigator.serviceWorker.controller);
  let typed = false;
  let reloading = false;
  document.addEventListener('input', () => (typed = true), true);

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!replacingAnOldVersion || typed || reloading) return;
    reloading = true;
    window.location.reload();
  });

  void registerSW({
    immediate: true,
    onRegisteredSW(_url, registration) {
      // A tablet left open on the bench all day still picks up a new deploy.
      if (registration) setInterval(() => void registration.update().catch(() => undefined), 60 * 60 * 1000);
    },
    onRegisterError() {
      // Private browsing and some locked-down browsers refuse service workers.
      // The app works without one; it is just not available offline.
    },
  });
}
