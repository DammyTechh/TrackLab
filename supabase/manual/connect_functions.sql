-- =====================================================================
-- connect_functions.sql — let the database call the edge functions.
--
-- The outbox job (0001, part 4) runs every five minutes and calls the
-- dispatch-outbox function, which sends alert emails (Resend) and push
-- notifications. To do that it needs two values, kept in Supabase Vault so
-- they are never stored in a table or in the code.
--
-- Run once, after 0001 and 0002, in the SQL Editor. Replace the two
-- PASTE-… values first. Safe to run again to change them.
-- =====================================================================

do $$
declare
  -- Your project's address: Project Settings -> API -> Project URL.
  base_url text := 'PASTE-PROJECT-URL';          -- e.g. https://abcdefghijkl.supabase.co
  -- A secret key: Project Settings -> API Keys -> Secret keys (sb_secret_…),
  -- or the legacy service_role key. Never the publishable/anon key.
  service_key text := 'PASTE-SECRET-KEY';
  pair record;
  existing uuid;
begin
  if base_url like 'PASTE-%' or service_key like 'PASTE-%' then
    raise exception 'Replace PASTE-PROJECT-URL and PASTE-SECRET-KEY at the top of this script, then run it again.';
  end if;
  if base_url !~ '^https://[a-z0-9-]+\.supabase\.co$' then
    raise exception 'The project URL should look like https://abcdefghijkl.supabase.co, with nothing after it.';
  end if;

  for pair in select * from (values ('app_base_url', base_url), ('service_role_key', service_key)) as v(name, value)
  loop
    select id into existing from vault.secrets where name = pair.name;
    if existing is null then
      perform vault.create_secret(pair.value, pair.name);
    else
      perform vault.update_secret(existing, pair.value);
    end if;
  end loop;
end $$;

-- The API caches the database structure. After running SQL by hand, tell it
-- to look again, or new columns are reported missing ("schema cache").
notify pgrst, 'reload schema';

-- Check: both names should be listed.
select name from vault.secrets where name in ('app_base_url', 'service_role_key');
