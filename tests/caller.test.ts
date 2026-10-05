// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { constantTimeEqual, isServiceCaller, serviceKeys } from '../supabase/functions/_shared/caller';

const SERVICE = 'eyJhbGciOiJIUzI1NiJ9.service-role-key-for-tests';
const ANON = 'eyJhbGciOiJIUzI1NiJ9.anon-key-that-ships-in-the-frontend';

describe('privileged edge functions', () => {
  const keys = serviceKeys({ serviceRole: SERVICE, secretKeysJson: '{"default":"sb_secret_abcdefghijklmnopqrstuv"}' });

  it('accept the service-role key', () => {
    expect(isServiceCaller(`Bearer ${SERVICE}`, keys)).toBe(true);
  });

  it('accept a new-style secret key', () => {
    expect(isServiceCaller('Bearer sb_secret_abcdefghijklmnopqrstuv', keys)).toBe(true);
  });

  it('refuse the anon key, which anyone can read from the website', () => {
    expect(isServiceCaller(`Bearer ${ANON}`, keys)).toBe(false);
  });

  it('refuse no header, an empty token, and a prefix of the real key', () => {
    expect(isServiceCaller(null, keys)).toBe(false);
    expect(isServiceCaller('Bearer ', keys)).toBe(false);
    expect(isServiceCaller(`Bearer ${SERVICE.slice(0, -1)}`, keys)).toBe(false);
  });

  it('refuse everything when no service key is configured, rather than everything passing', () => {
    expect(isServiceCaller('Bearer ', serviceKeys({}))).toBe(false);
    expect(isServiceCaller(`Bearer ${SERVICE}`, serviceKeys({ secretKeysJson: 'not json' }))).toBe(false);
  });

  it('compare in constant time', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
  });
});
