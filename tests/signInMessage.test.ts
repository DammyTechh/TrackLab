import { describe, expect, it } from 'vitest';
import { signInMessage } from '../src/features/auth/signInMessage';

describe('why a sign-in failed', () => {
  it('says only "do not match" for a wrong email or password', () => {
    expect(signInMessage({ code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' })).toMatch(
      /do not match/,
    );
  });

  it('names every other cause instead of calling it a wrong password', () => {
    expect(signInMessage({ code: 'email_not_confirmed', message: 'Email not confirmed' })).toMatch(/not been confirmed/);
    expect(signInMessage({ status: 429, code: 'over_request_rate_limit', message: 'Request rate limit reached' })).toMatch(
      /Too many/,
    );
    expect(signInMessage(new TypeError('Failed to fetch'))).toMatch(/Could not reach the server/);
    expect(signInMessage({ status: 500, message: 'Database error querying schema' })).toBe('Database error querying schema');
    for (const err of [{ code: 'email_not_confirmed' }, { status: 429 }, new TypeError('Failed to fetch')]) {
      expect(signInMessage(err)).not.toMatch(/do not match/);
    }
  });
});
