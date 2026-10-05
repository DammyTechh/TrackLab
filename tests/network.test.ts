import { afterEach, describe, expect, it, vi } from 'vitest';
import { probe } from '../src/offline/network';

/**
 * The health probe used to read a 401 from the Supabase gateway as "server
 * down", which pushed a perfectly healthy app into the offline state. A
 * response is a response; only a thrown request means unreachable.
 */
const SUPABASE = 'http://localhost:54321/auth/v1/health';

afterEach(() => vi.unstubAllGlobals());

function stubFetch(handler: (url: string) => Promise<Response>) {
  vi.stubGlobal('fetch', (input: RequestInfo | URL) => handler(String(input)));
  vi.stubGlobal('navigator', { onLine: true });
}

describe('the network probe', () => {
  it('sends the api key, so the gateway does not answer 401', async () => {
    const seen: Record<string, string> = {};
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === SUPABASE) {
        Object.assign(seen, init?.headers as Record<string, string>);
        return Promise.resolve(new Response(null, { status: 200 }));
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    });

    await probe();
    expect(seen.apikey).toBe('test-anon-key');
  });

  it('treats a reachable server plus a reachable internet as online', async () => {
    stubFetch(() => Promise.resolve(new Response(null, { status: 200 })));
    await expect(probe()).resolves.toBe('online');
  });

  it('treats a reachable server with no internet as campus-only', async () => {
    stubFetch((url) =>
      url === SUPABASE
        ? Promise.resolve(new Response(null, { status: 200 }))
        : Promise.reject(new Error('no uplink')),
    );
    await expect(probe()).resolves.toBe('lan');
  });

  it('treats a transport failure as offline', async () => {
    stubFetch(() => Promise.reject(new Error('dns')));
    await expect(probe()).resolves.toBe('offline');
  });
});
