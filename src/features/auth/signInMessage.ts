import { describeError } from '@/lib/errors';

/**
 * Why a sign-in failed, in words the person can act on. A wrong password
 * never says which half was wrong; every other cause is named, because
 * calling a lost connection "wrong password" sends people round in circles.
 */
export function signInMessage(err: unknown): string {
  const e = (err && typeof err === 'object' ? err : {}) as { code?: unknown; status?: unknown; message?: unknown };
  const message = typeof e.message === 'string' ? e.message : '';

  if (e.code === 'invalid_credentials' || /invalid login credentials/i.test(message)) {
    return 'That email and password do not match an account. Check both and try again.';
  }
  if (e.code === 'email_not_confirmed' || /email not confirmed/i.test(message)) {
    return 'This account’s email address has not been confirmed. An administrator can confirm it in Supabase → Authentication → Users.';
  }
  if (e.status === 429 || (typeof e.code === 'string' && e.code.startsWith('over_')) || /rate limit/i.test(message)) {
    return 'Too many sign-in attempts. Wait a minute, then try again.';
  }
  if (e.code === 'user_banned') return 'This account has been blocked. Ask the administrator.';
  return describeError(err, 'Signing in did not work. Try again.');
}
