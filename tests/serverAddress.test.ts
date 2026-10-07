import { describe, expect, it } from 'vitest';
import { isLoopbackUrl, serverAddressProblem } from '../src/lib/serverAddress';

describe('a database address that only works on one computer', () => {
  it.each([
    ['http://127.0.0.1:55321', true],
    ['http://localhost:54321', true],
    ['http://[::1]:55321', true],
    ['https://abcdefghijkl.supabase.co', false],
    ['https://app.tracklab.edu.ng', false],
    ['http://192.168.1.20', false],
    [undefined, false],
  ])('%s -> %s', (url, loopback) => {
    expect(isLoopbackUrl(url)).toBe(loopback);
  });

  it('is named as the cause on a live site built with the local database', () => {
    // Exactly what the live site was doing.
    const text = serverAddressProblem('http://127.0.0.1:55321', 'app.example.edu.ng');
    expect(text).toMatch(/127\.0\.0\.1:55321/);
    expect(text).toMatch(/VITE_SUPABASE_URL/);
  });

  it('is not a problem on the laptop running the local database, or for a live database', () => {
    expect(serverAddressProblem('http://127.0.0.1:55321', 'localhost')).toBeNull();
    expect(serverAddressProblem('http://127.0.0.1:55321', '127.0.0.1')).toBeNull();
    expect(serverAddressProblem('https://abcdefghijkl.supabase.co', 'app.example.edu.ng')).toBeNull();
  });
});
