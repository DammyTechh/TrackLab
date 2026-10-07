-- =====================================================================
-- reset_database.sql — ERASE the app's database, to rebuild it cleanly.
--
-- Deletes EVERYTHING the app stores: every machine, event, document
-- record, alert and lab, and every user account. It cannot be undone.
-- Download a backup first if anything in it matters
-- (Dashboard -> Database -> Backups).
--
-- Then run, in this order, each in its own SQL Editor query:
--   1. this file
--   2. supabase/migrations/0001_schema.sql
--   3. supabase/migrations/0002_seed_institution_and_users.sql
--   4. supabase/manual/connect_functions.sql
-- Full steps: docs/DATABASE-SETUP.md.
--
-- What it keeps: Supabase's own setup, the extensions, Vault secrets
-- (connect_functions.sql reuses them), and files already uploaded to
-- Storage (Supabase only lets the Storage API delete those; empty the
-- buckets in Dashboard -> Storage if you want them gone).
-- =====================================================================

do $$
declare
  -- Replace the text below with: ERASE EVERYTHING
  confirm text := 'type ERASE EVERYTHING here';
  r record;
begin
  if confirm <> 'ERASE EVERYTHING' then
    raise exception 'Nothing was erased. To confirm, edit the second line of this block to read: confirm text := ''ERASE EVERYTHING'';';
  end if;

  -- Scheduled jobs: the due-date sweep, the email/push dispatcher, the digest.
  if to_regclass('cron.job') is not null then
    for r in select jobname from cron.job where jobname like 'evidencetag-%' loop
      perform cron.unschedule(r.jobname);
    end loop;
  end if;

  -- Every table in the public schema, with its rules, triggers and data.
  -- The schema itself stays, so Supabase's default permissions on it stay.
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('drop table if exists public.%I cascade', r.tablename);
  end loop;

  -- The app's functions (and, through cascade, the storage rules that use
  -- them). Functions that belong to an extension are left alone.
  for r in
    select p.oid::regprocedure as fn
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('drop function if exists %s cascade', r.fn);
  end loop;

  -- The app's types (statuses, roles, event types).
  for r in
    select t.typname
    from pg_type t
    where t.typnamespace = 'public'::regnamespace
      and t.typtype in ('e', 'd', 'c')
      and not exists (select 1 from pg_depend d where d.objid = t.oid and d.deptype = 'e')
      and not exists (select 1 from pg_class c where c.reltype = t.oid)
  loop
    execute format('drop type if exists public.%I cascade', r.typname);
  end loop;

  -- Storage rules the app created, in case any survived the cascade.
  for r in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and (policyname like 'equipment_photos_%' or policyname like 'documents_%' or policyname like 'event_files_%')
  loop
    execute format('drop policy if exists %I on storage.objects', r.policyname);
  end loop;

  -- Every account; 0002 creates the seeded ones again. Sign-in identities
  -- first: Supabase removes them with the account anyway, but saying so
  -- explicitly does not depend on how that link is set up.
  delete from auth.identities;
  delete from auth.users;

  -- The CLI's record of which migrations ran, so it starts again with 0001.
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    delete from supabase_migrations.schema_migrations;
  end if;

  raise notice 'Erased. Now run 0001_schema.sql.';
end $$;

notify pgrst, 'reload schema';
