/**
 * Who may call a privileged function. Pure: no Deno, so it is unit-tested.
 *
 * `verify_jwt = true` in config.toml is NOT this check. It only proves the
 * token is a validly signed JWT, and the anon key is one — it ships inside
 * every copy of the frontend. Relying on it let anyone who opened the site
 * call seed-users and create themselves an admin account. Privileged
 * functions must compare the caller's key with the service key themselves.
 */

/** Every key that grants service access: the legacy service-role JWT and any new-style secret keys. */
export function serviceKeys(env: { serviceRole?: string; secretKeysJson?: string }): string[] {
  const keys = [env.serviceRole ?? ''];
  try {
    const parsed = JSON.parse(env.secretKeysJson ?? '{}') as Record<string, unknown>;
    for (const value of Object.values(parsed)) if (typeof value === 'string') keys.push(value);
  } catch {
    // Not JSON (or unset): only the service-role key applies.
  }
  return keys.filter((k) => k.length >= 20);
}

/** Compare without leaking, through timing, how many leading characters matched. */
export function constantTimeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export function isServiceCaller(authorizationHeader: string | null, keys: string[]): boolean {
  const token = (authorizationHeader ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token || keys.length === 0) return false;
  // Check every key, so the time taken does not reveal which one is in use.
  let ok = false;
  for (const key of keys) ok = constantTimeEqual(token, key) || ok;
  return ok;
}
