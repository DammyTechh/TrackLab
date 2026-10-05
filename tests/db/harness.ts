/**
 * Runs supabase/migrations against real PostgreSQL (PGlite: Postgres compiled
 * to WebAssembly, in-process, no Docker) with minimal stand-ins for the parts
 * of Supabase that are not plain Postgres: the auth and storage schemas, the
 * API roles, pg_cron, pg_net and Vault.
 *
 * The stand-ins are deliberately thin. They exist so the migrations can be
 * EXECUTED and their rules tested as each role — which catches what reading
 * SQL does not (this harness found a bug in 0009 before it ever shipped).
 * They are not a replacement for `supabase db reset` before a release.
 */
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '../../supabase/migrations');

const SUPABASE_STUBS = `
create schema extensions;
create extension pgcrypto with schema extensions;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant anon, authenticated, service_role to current_user;

create schema auth;
create table auth.users (
  instance_id uuid, id uuid primary key, aud text, role text, email text unique,
  encrypted_password text, email_confirmed_at timestamptz, recovery_sent_at timestamptz,
  last_sign_in_at timestamptz, raw_app_meta_data jsonb, raw_user_meta_data jsonb,
  created_at timestamptz, updated_at timestamptz, confirmation_token text,
  email_change text, email_change_token_new text, recovery_token text
);
create table auth.identities (
  id uuid primary key, user_id uuid references auth.users(id), provider_id text,
  identity_data jsonb, provider text, last_sign_in_at timestamptz,
  created_at timestamptz, updated_at timestamptz
);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create schema storage;
create table storage.buckets (
  id text primary key, name text, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text, owner uuid, created_at timestamptz default now(), updated_at timestamptz default now()
);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end $$;

create schema cron;
create function cron.schedule(job text, sched text, command text) returns bigint
  language sql as $$ select 1::bigint $$;
create schema net;
create function net.http_post(url text, headers jsonb, body jsonb) returns bigint
  language sql as $$ select 1::bigint $$;
create schema vault;
create table vault.decrypted_secrets (name text, decrypted_secret text);

create publication supabase_realtime;

grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
grant all on all tables in schema storage to anon, authenticated, service_role;
grant select on auth.users to authenticated;
`;

/** pg_cron and pg_net are not compiled into PGlite; their schemas are stubbed above. */
function adapt(sql: string): string {
  return sql
    .replace(/create extension if not exists "pg_cron";/g, '-- pg_cron stubbed')
    .replace(/create extension if not exists "pg_net";/g, '-- pg_net stubbed');
}

export type Db = PGlite;

/**
 * Fixed test data, the same in every institution's repo. Tests never rely on
 * an institution's real seeds (0005/0006): those differ per institution, and
 * a test that passes only with one institution's accounts is a test that
 * fails for the other. Seeds are checked separately in seeds.test.ts.
 */
const TEST_FIXTURE = `
insert into institution (code, name, product_name, logo_url, brand_primary, brand_accent, email_from, timezone)
values ('TEST', 'Test University', 'Test Product', null, '#0b4a28', '#e8b93f', 'alerts@test.local', 'Africa/Lagos');

insert into labs (name, code, building, room) values
  ('Chemistry Lab 1', 'CHEM1', 'Block A', '1'),
  ('Chemistry Lab 2', 'CHEM2', 'Block A', '2'),
  ('Physics Lab 1',   'PHY1',  'Block B', '1');

do $$
declare
  person record;
  uid uuid;
  lab text;
begin
  for person in select * from (values
    ('dean@test.local',      'Dean',                 'senior_leader', array[]::text[]),
    ('hod.chem@test.local',  'HOD Chemistry',        'lab_hod',       array['CHEM1','CHEM2']),
    ('hod.phy@test.local',   'HOD Physics',          'lab_hod',       array['PHY1']),
    ('tech.chem@test.local', 'Technician Chemistry', 'technician',    array['CHEM1','CHEM2']),
    ('tech.phy@test.local',  'Technician Physics',   'technician',    array['PHY1']),
    ('it.admin@test.local',  'Administrator',        'admin',         array[]::text[])
  ) as t(email, full_name, role, labs)
  loop
    uid := gen_random_uuid();
    insert into auth.users (id, email) values (uid, person.email);
    insert into profiles (id, full_name, role, is_active, must_change_password)
    values (uid, person.full_name, person.role::app_role, true, true);
    foreach lab in array person.labs loop
      insert into lab_members (lab_id, profile_id) select id, uid from labs where code = lab;
    end loop;
  end loop;
end $$;
`;

const isSeed = (file: string) => /_seed_/.test(file);

/**
 * A fresh database with the migrations applied in filename order.
 *
 *   migrated()                  every migration except the institution's seeds,
 *                               then the fixed TEST_FIXTURE. What rule tests use.
 *   migrated({ seeds: true })   every migration including this institution's
 *                               own seeds, and no fixture.
 */
export async function migrated({ seeds = false }: { seeds?: boolean } = {}): Promise<Db> {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(SUPABASE_STUBS);
  for (const file of readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    if (!seeds && isSeed(file)) continue;
    try {
      await db.exec(adapt(readFileSync(join(MIGRATIONS, file), 'utf8')));
    } catch (err) {
      throw new Error(`${file} failed to apply: ${(err as Error).message}`);
    }
  }
  if (!seeds) await db.exec(TEST_FIXTURE);
  return db;
}

/** Run `fn` as a signed-in user, or as an anonymous visitor, the way the API would. */
export async function as<T>(
  db: Db,
  role: 'anon' | 'authenticated',
  userId: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  await db.exec(`set role ${role}`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? '']);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  }
}

export async function rows<T = Record<string, unknown>>(
  db: Db,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

export async function userId(db: Db, email: string): Promise<string> {
  const [row] = await rows<{ id: string }>(db, 'select id from auth.users where email = $1', [email]);
  if (!row) throw new Error(`no seeded user ${email}`);
  return row.id;
}

export async function labId(db: Db, code: string): Promise<string> {
  const [row] = await rows<{ id: string }>(db, 'select id from labs where code = $1', [code]);
  if (!row) throw new Error(`no seeded lab ${code}`);
  return row.id;
}

/** A machine inserted as the owner, so tests start from a known state. */
export async function machine(
  db: Db,
  lab: string,
  assetId: string,
  qrToken: string,
  intervalDays = 180,
): Promise<string> {
  const [row] = await rows<{ id: string }>(
    db,
    `insert into equipment (lab_id, asset_id, qr_token, name, service_interval_days)
     values ($1, $2, $3, 'Test machine', $4) returning id`,
    [lab, assetId, qrToken, intervalDays],
  );
  return row!.id;
}
