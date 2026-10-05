import { isServiceCaller, serviceKeys } from './caller.ts';

/** null when the caller holds a service key; otherwise the 403 to return. */
export function requireService(request: Request): Response | null {
  const keys = serviceKeys({
    serviceRole: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    secretKeysJson: Deno.env.get('SUPABASE_SECRET_KEYS'),
  });
  if (isServiceCaller(request.headers.get('Authorization'), keys)) return null;
  return new Response(JSON.stringify({ error: 'This function can only be called with the service key.' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}
