/**
 * Three states, because this product genuinely has three:
 *
 *   online   the server and the wider internet are reachable
 *   lan      the server answers but the internet does not — saving works,
 *            push and email wait in the outbox
 *   offline  nothing answers — writes go to the device outbox
 *
 * On Supabase Cloud `lan` cannot occur: the server IS on the internet, so a
 * campus outage lands straight in `offline`. The state is kept anyway so that
 * moving to an on-premise server later changes deployment, not code.
 */

export type NetworkState = 'online' | 'lan' | 'offline';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Supabase sits behind a gateway that rejects an unauthenticated request with
 * 401 before it ever reaches the health endpoint, so the key has to go with
 * the probe. Overridable for an on-premise host that exposes its own check.
 */
const HEALTH_URL = import.meta.env.VITE_HEALTH_URL || `${SUPABASE_URL}/auth/v1/health`;

/** Any cheap, CORS-free endpoint that is not the Supabase host. */
const INTERNET_URL = 'https://www.gstatic.com/generate_204';

const PROBE_INTERVAL_MS = 30_000;

async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/** Does our own server answer? A real response, so 401 is not mistaken for down. */
async function serverReachable(timeoutMs = 4000): Promise<boolean> {
  try {
    const response = await withTimeout(
      (signal) =>
        fetch(HEALTH_URL, {
          method: 'GET',
          headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
          cache: 'no-store',
          signal,
        }),
      timeoutMs,
    );
    // Anything that came back means the host is up. Only a thrown error,
    // which is a transport failure, means unreachable.
    return response.status < 500;
  } catch {
    return false;
  }
}

/** Is the wider internet up? Opaque is fine here; we only need "it resolved". */
async function internetReachable(timeoutMs = 4000): Promise<boolean> {
  try {
    await withTimeout(
      (signal) => fetch(INTERNET_URL, { method: 'GET', mode: 'no-cors', cache: 'no-store', signal }),
      timeoutMs,
    );
    return true;
  } catch {
    return false;
  }
}

export async function probe(): Promise<NetworkState> {
  // navigator.onLine is wrong in both directions often enough that it is only
  // a hint: it says "this device has a network interface", not "the server
  // answers". A campus wifi with no uplink reports online.
  if (!navigator.onLine) return 'offline';

  const serverUp = await serverReachable();
  if (!serverUp) return 'offline';

  return (await internetReachable()) ? 'online' : 'lan';
}

export function watchNetwork(onChange: (state: NetworkState) => void): () => void {
  let stopped = false;

  const run = async () => {
    if (stopped) return;
    const state = await probe();
    if (!stopped) onChange(state);
  };

  void run();
  const timer = setInterval(() => void run(), PROBE_INTERVAL_MS);
  window.addEventListener('online', () => void run());
  window.addEventListener('offline', () => void run());

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
