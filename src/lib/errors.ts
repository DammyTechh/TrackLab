/**
 * Error messages people can act on.
 *
 * Supabase reports failures as plain objects ({ code, message, details }),
 * not as JavaScript Error instances, so `err instanceof Error` is false and a
 * screen that checked it fell back to a vague "Not saved", hiding the reason.
 */

import { serverAddressProblem } from './serverAddress';

interface Described {
  code?: unknown;
  message?: unknown;
}

/** The underlying message, whatever shape the error came in. */
export function rawErrorMessage(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const { message } = err as Described;
    if (typeof message === 'string' && message) return message;
  }
  return String(err);
}

/**
 * What to show a person. Known causes are put in plain words, with what to
 * do; anything else shows the real message; `fallback` only when there is
 * no message at all.
 */
export function describeError(err: unknown, fallback: string): string {
  const { code } = (err && typeof err === 'object' ? err : {}) as Described;
  const message = err ? rawErrorMessage(err) : '';

  // The API's cached copy of the database structure is behind: usually a
  // migration was run by hand in the SQL editor.
  if (code === 'PGRST204' || code === 'PGRST205' || /schema cache/i.test(message)) {
    return "The database has changed but the app's connection to it has not caught up. An administrator should run the latest migrations, then run notify pgrst, 'reload schema'; in the Supabase SQL editor, and try again.";
  }
  if (code === '42501' || /permission denied|row-level security/i.test(message)) {
    return 'You do not have permission to make that change.';
  }
  if (code === '23505') return 'That already exists.';
  if (code === '23514') return 'The database refused that value as invalid.';
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    const setup = serverAddressProblem(
      import.meta.env?.VITE_SUPABASE_URL as string | undefined,
      typeof window !== 'undefined' ? window.location.hostname : undefined,
    );
    return setup ?? 'Could not reach the server. Check the connection and try again.';
  }
  return message && message !== '[object Object]' && message !== 'undefined' ? message : fallback;
}
