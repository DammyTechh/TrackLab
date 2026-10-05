-- =====================================================================
-- 0005_seed_users.sql — the only accounts that will ever exist.
--
-- EDIT THE LIST BELOW, then run it. There is no sign-up page and
-- sign-ups are disabled in Supabase Auth, so this file (or the
-- seed-users edge function) is the only way an account is created.
--
-- Run it either way:
--   supabase db reset                      (runs it with every migration)
--   or paste it into the SQL editor of the hosted project
--
-- Three things to know before you run it:
--
--   1. It is idempotent. An email that already exists is skipped, so
--      re-running it adds the new people and leaves everyone else alone.
--      It will NOT change an existing person's password — the snippet at
--      the bottom of this file does that.
--
--   2. Every account starts with must_change_password = true, so the
--      first sign-in forces a new password before any other screen is
--      reachable. The passwords below are therefore temporary by design.
--
--   3. Do not commit real passwords. Edit this file locally, run it,
--      then put the placeholders back before you push.
--
-- The lab codes in the last column must already exist in `labs`
-- (see supabase/seed/seed.sql). An unknown code is reported and skipped.
-- Leave the array empty for people who are not tied to a lab: the dean
-- sees every lab, and the admin manages accounts rather than equipment.
-- =====================================================================

do $$
declare
  seed_user   record;
  v_user_id   uuid;
  v_lab_id    uuid;
  v_lab_code  text;
  v_created   int := 0;
  v_skipped   int := 0;
begin

  -- crypt() and gen_salt() live in the extensions schema (see 0001).
  perform set_config('search_path', 'public, extensions', true);

  for seed_user in
    select * from (values

      -- ---------------------------------------------------------------
      --  email                      full name            role              temporary password   labs
      -- ---------------------------------------------------------------
      ('dean@tracklab.edu.ng',          'Prof. O. Adeyemi',  'senior_leader',  'ChangeMe-Dean-2026',   array[]::text[]),
      ('dvc@tracklab.edu.ng',           'Dr. M. Suleiman',   'senior_leader',  'ChangeMe-Dvc-2026',    array[]::text[]),

      ('hod.chem@tracklab.edu.ng',      'Dr. N. Eze',        'lab_hod',        'ChangeMe-Chem-2026',   array['CHEM1','CHEM2']),
      ('hod.phy@tracklab.edu.ng',       'Dr. I. Lawal',      'lab_hod',        'ChangeMe-Phy-2026',    array['PHY1']),
      ('hod.bio@tracklab.edu.ng',       'Dr. F. Okafor',     'lab_hod',        'ChangeMe-Bio-2026',    array['BIO1','MICRO']),

      ('a.bello@tracklab.edu.ng',       'A. Bello',          'technician',     'ChangeMe-Tech1-2026',  array['CHEM1','CHEM2']),
      ('s.musa@tracklab.edu.ng',        'S. Musa',           'technician',     'ChangeMe-Tech2-2026',  array['PHY1']),
      ('j.ibrahim@tracklab.edu.ng',     'J. Ibrahim',        'technician',     'ChangeMe-Tech3-2026',  array['BIO1','MICRO']),
      ('k.adeniyi@tracklab.edu.ng',     'K. Adeniyi',        'technician',     'ChangeMe-Tech4-2026',  array['ENG']),

      ('it.admin@tracklab.edu.ng',      'IT Administrator',  'admin',          'ChangeMe-Admin-2026',  array[]::text[])
      -- ---------------------------------------------------------------

    ) as t(email, full_name, role, password, labs)
  loop

    -- Already there? Leave the person exactly as they are.
    if exists (select 1 from auth.users where email = lower(seed_user.email)) then
      raise notice 'skipped (already exists): %', seed_user.email;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if length(seed_user.password) < 10 then
      raise exception 'Temporary password for % is shorter than 10 characters.', seed_user.email;
    end if;

    v_user_id := gen_random_uuid();

    -- The auth record. The empty-string token columns are deliberate:
    -- GoTrue reads them as strings and a NULL there breaks sign-in.
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, recovery_sent_at, last_sign_in_at,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000',
      v_user_id,
      'authenticated',
      'authenticated',
      lower(seed_user.email),
      crypt(seed_user.password, gen_salt('bf')),
      now(), null, null,
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', seed_user.full_name),
      now(), now(),
      '', '', '', ''
    );

    -- GoTrue will not sign anyone in without the matching identity row.
    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(),
      v_user_id,
      v_user_id::text,
      jsonb_build_object(
        'sub', v_user_id::text,
        'email', lower(seed_user.email),
        'email_verified', true,
        'phone_verified', false
      ),
      'email',
      now(), now(), now()
    );

    -- The application profile: this is where the role lives, and it is
    -- what every RLS policy reads.
    insert into profiles (id, full_name, role, is_active, must_change_password)
    values (v_user_id, seed_user.full_name, seed_user.role::app_role, true, true);

    -- Which labs this person may write to. Technicians and HODs only.
    foreach v_lab_code in array seed_user.labs loop
      select id into v_lab_id from labs where code = v_lab_code;

      if v_lab_id is null then
        raise warning 'lab code % not found; % was not added to it', v_lab_code, seed_user.email;
      else
        insert into lab_members (lab_id, profile_id)
        values (v_lab_id, v_user_id)
        on conflict do nothing;
      end if;
    end loop;

    raise notice 'created % (%)', seed_user.email, seed_user.role;
    v_created := v_created + 1;

  end loop;

  raise notice 'seed-users finished: % created, % skipped', v_created, v_skipped;

end $$;


-- =====================================================================
-- Afterwards
-- =====================================================================
--
-- Reset one person's password (they will be forced to change it again):
--
--   update auth.users
--      set encrypted_password = extensions.crypt('NewTemporary-2026', extensions.gen_salt('bf')),
--          updated_at = now()
--    where email = 'a.bello@tracklab.edu.ng';
--
--   update profiles set must_change_password = true
--    where id = (select id from auth.users where email = 'a.bello@tracklab.edu.ng');
--
--
-- Move someone to another lab:
--
--   delete from lab_members
--    where profile_id = (select id from auth.users where email = 's.musa@tracklab.edu.ng');
--
--   insert into lab_members (lab_id, profile_id)
--   select l.id, u.id from labs l, auth.users u
--    where l.code = 'CHEM2' and u.email = 's.musa@tracklab.edu.ng';
--
--
-- Someone leaves. Deactivate rather than delete, so their entries in the
-- equipment history keep their name against them:
--
--   update profiles set is_active = false
--    where id = (select id from auth.users where email = 'j.ibrahim@tracklab.edu.ng');
--
--
-- Check who exists and what they can reach:
--
--   select p.full_name, u.email, p.role, p.is_active, p.must_change_password,
--          coalesce(string_agg(l.code, ', ' order by l.code), '-') as labs
--     from profiles p
--     join auth.users u on u.id = p.id
--     left join lab_members lm on lm.profile_id = p.id
--     left join labs l on l.id = lm.lab_id
--    group by p.full_name, u.email, p.role, p.is_active, p.must_change_password
--    order by p.role, p.full_name;
-- =====================================================================
