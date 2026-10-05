import { supabase } from '@/lib/supabase';

/**
 * Web Push for this device.
 *
 * The server side already exists: dispatch-outbox sends to every row in
 * push_subscriptions, and sw.ts shows the notification. This is the missing
 * half — asking permission and recording where to send.
 */

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export type PushState =
  | { kind: 'unconfigured' } // no VAPID key in this build
  | { kind: 'unsupported' } // this browser cannot do push at all
  | { kind: 'ios-install' } // iPhone/iPad: only works once added to the home screen
  | { kind: 'denied' } // the person (or the browser) said no
  | { kind: 'off' }
  | { kind: 'on' };

function isIos(): boolean {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; touch support gives it away.
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

function isInstalled(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function supported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/**
 * The service worker registration, or null if none becomes ready. On the dev
 * server there is usually no worker, and `ready` would wait forever.
 */
async function registration(timeoutMs = 4000): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
}

export async function pushState(): Promise<PushState> {
  if (!VAPID_PUBLIC_KEY) return { kind: 'unconfigured' };
  if (isIos() && !isInstalled()) return { kind: 'ios-install' };
  if (!supported()) return { kind: 'unsupported' };
  if (Notification.permission === 'denied') return { kind: 'denied' };

  const reg = await registration();
  if (!reg) return { kind: 'unsupported' };
  const sub = await reg.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? { kind: 'on' } : { kind: 'off' };
}

/** `BEgx…` (URL-safe base64) -> the bytes pushManager wants. */
export function vapidKeyBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  // Backed by a plain ArrayBuffer: pushManager.subscribe rejects a view
  // that could be over a SharedArrayBuffer.
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/**
 * Record this device for the person signed in now. Goes through
 * claim_push_subscription (0009) rather than a plain upsert, because on a
 * shared phone the row may still belong to the previous person.
 */
async function save(sub: PushSubscription): Promise<void> {
  const json = sub.toJSON() as { endpoint: string; keys?: { p256dh: string; auth: string } };
  if (!json.keys) throw new Error('The browser did not return push keys. Try again.');

  const { error } = await supabase.rpc('claim_push_subscription', {
    p_endpoint: json.endpoint,
    p_keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    p_user_agent: navigator.userAgent,
  });
  if (error) throw error;
}

export async function turnOnPush(): Promise<void> {
  if (!VAPID_PUBLIC_KEY) throw new Error('Push is not set up for this deployment yet.');

  // Must be called from a tap; browsers refuse a permission prompt otherwise.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? 'Notifications are blocked for this site. Allow them in the browser settings, then try again.'
        : 'Notifications were not allowed.',
    );
  }

  const reg = await registration();
  if (!reg) throw new Error('Push needs the installed app. Open it from the home screen and try again.');

  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: vapidKeyBytes(VAPID_PUBLIC_KEY),
    }));
  await save(sub);
}

export async function turnOffPush(): Promise<void> {
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}

/**
 * Lab phones are shared. When someone signs out, this device must stop
 * receiving THEIR alerts, or the next person to pick it up sees them.
 * Called before the session ends, while the delete is still authorised.
 */
export async function forgetThisDevice(): Promise<void> {
  try {
    await turnOffPush();
  } catch {
    // Signing out must never fail because of push. A stale endpoint is
    // pruned by dispatch-outbox the first time it answers 404 or 410.
  }
}

/**
 * A subscription that exists in the browser but not on the server (signed
 * in on a phone that was already subscribed) is re-recorded quietly.
 */
export async function reconcilePush(): Promise<void> {
  if (!VAPID_PUBLIC_KEY || !supported() || Notification.permission !== 'granted') return;
  const reg = await registration(1500);
  const sub = await reg?.pushManager.getSubscription();
  if (sub) await save(sub).catch(() => undefined);
}
