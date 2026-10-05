import type { BrowserContext, Route } from '@playwright/test';
import { LAB, MACHINE, PUBLIC_PASSPORT, SOP, SUPABASE_URL, TECHNICIAN } from './fixtures';

/**
 * Answers the app's Supabase calls at the HTTP level, so the real built app
 * runs unmodified in a real browser. The database rules themselves are
 * tested against real PostgreSQL in tests/db; this covers what only a
 * browser shows — routing, rendering, the offline outbox, sync.
 *
 * Installed on the browser CONTEXT, not the page, so popups (an SOP opening
 * in a new tab) are answered too.
 */

export interface Write {
  method: string;
  table: string;
  body: unknown;
}

export interface MockHandle {
  writes: Write[];
  signed: string[];
}

const b64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** A well-formed JWT: supabase-js reads its claims, nothing here verifies the signature. */
function accessToken(): string {
  const now = Math.floor(Date.now() / 1000);
  return [
    b64url({ alg: 'HS256', typ: 'JWT' }),
    b64url({ sub: TECHNICIAN.id, email: TECHNICIAN.email, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 3600 }),
    'e2e-signature',
  ].join('.');
}

const USER = {
  id: TECHNICIAN.id,
  aud: 'authenticated',
  role: 'authenticated',
  email: TECHNICIAN.email,
  email_confirmed_at: '2026-01-01T00:00:00Z',
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
  created_at: '2026-01-01T00:00:00Z',
};

const PROFILE = {
  id: TECHNICIAN.id,
  full_name: TECHNICIAN.full_name,
  role: 'technician',
  is_active: true,
  must_change_password: false,
  lab_members: [{ lab_id: LAB.id }],
};

const json = (route: Route, body: unknown, status = 200, headers: Record<string, string> = {}) =>
  route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });

/** PostgREST filters arrive as ?col=eq.value. */
function eqFilters(url: URL): Record<string, string> {
  const out: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    if (value.startsWith('eq.')) out[key] = value.slice(3);
  });
  return out;
}

function tableRows(table: string, filters: Record<string, string>): Record<string, unknown>[] {
  const all: Record<string, Record<string, unknown>[]> = {
    profiles: [PROFILE],
    equipment: [MACHINE],
    labs: [LAB],
    equipment_documents: [SOP],
  };
  return (all[table] ?? []).filter((row) => Object.entries(filters).every(([k, v]) => String(row[k]) === v));
}

export async function mockSupabase(context: BrowserContext): Promise<MockHandle> {
  const handle: MockHandle = { writes: [], signed: [] };

  // The network probe's "is the wider internet up?" check.
  await context.route('https://www.gstatic.com/generate_204', (route) => route.fulfill({ status: 204 }));

  // Realtime: accept the socket and say nothing. The app must cope.
  await context.routeWebSocket(/\/realtime\/v1\//, () => undefined);

  await context.route(`${SUPABASE_URL}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname;

    // ------------------------------------------------------------ auth
    if (path === '/auth/v1/health') return json(route, { name: 'GoTrue' });
    if (path === '/auth/v1/token') {
      const body = request.postDataJSON() as { email?: string; password?: string };
      if (body.email === TECHNICIAN.email && body.password === TECHNICIAN.password) {
        return json(route, {
          access_token: accessToken(),
          token_type: 'bearer',
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          refresh_token: 'e2e-refresh',
          user: USER,
        });
      }
      return json(route, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400);
    }
    if (path === '/auth/v1/user') return json(route, USER);
    if (path === '/auth/v1/logout') return route.fulfill({ status: 204 });

    // ------------------------------------------------------------ storage
    const sign = path.match(/^\/storage\/v1\/object\/sign\/([^/]+)\/(.+)$/);
    if (sign && method === 'POST') {
      handle.signed.push(`${sign[1]}/${decodeURIComponent(sign[2]!)}`);
      return json(route, { signedURL: `/object/sign/${sign[1]}/${sign[2]}?token=e2e` });
    }
    if (sign && method === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4 e2e' });
    }
    if (path.startsWith('/storage/v1/')) return route.fulfill({ status: 404, body: '' });

    // ------------------------------------------------------------ rest
    const rest = path.match(/^\/rest\/v1\/(.+)$/);
    if (!rest) return route.fulfill({ status: 404, body: '' });
    const target = rest[1]!;

    if (target === 'rpc/get_public_equipment') {
      const { p_qr_token } = request.postDataJSON() as { p_qr_token: string };
      return json(route, p_qr_token === MACHINE.qr_token ? PUBLIC_PASSPORT : null);
    }
    if (target === 'rpc/my_alert_settings') return json(route, [{ email: 'all', push: 'all', weekly_digest: false }]);
    if (target.startsWith('rpc/')) return route.fulfill({ status: 204, body: '' });

    if (method === 'HEAD') {
      return route.fulfill({ status: 200, headers: { 'content-range': '*/0' }, body: '' });
    }
    if (method === 'GET') {
      const rows = tableRows(target, eqFilters(url));
      const wantsObject = (request.headers()['accept'] ?? '').includes('vnd.pgrst.object');
      if (wantsObject) return rows[0] ? json(route, rows[0]) : json(route, { code: 'PGRST116' }, 406);
      return json(route, rows, 200, { 'content-range': `0-${Math.max(rows.length - 1, 0)}/${rows.length}` });
    }

    // Writes: record, acknowledge, return nothing (supabase-js default).
    handle.writes.push({ method, table: target, body: request.postDataJSON() });
    return route.fulfill({ status: method === 'POST' ? 201 : 204, body: '' });
  });

  return handle;
}
