-- 0009_integrity_documents_realtime.sql
--
-- Four things, in the order they matter:
--
--   1. The server owns status. Until now that was a convention, not a rule:
--      the equipment_update policy let a technician write any column of a
--      machine in their lab, so a request from the browser could set
--      `status = 'operational'` on a faulty machine, push next_service_due to
--      2099 so it never alerted again, or rewrite the asset ID printed on its
--      label. Verified against this schema before the fix. Now refused.
--
--   2. Changing a machine's service interval recomputes its next due date.
--
--   3. Documents (SOPs, manuals, certificates) can be withdrawn. They are
--      never deleted or edited — a wrong SOP is withdrawn and a new one
--      uploaded, and the record of what was published stays.
--
--   4. Notifications are published to Realtime, so the alert bell is live.


-- =========================================================== 1. server-owned columns

-- Everything the server derives. A client may still write name, location,
-- the specification fields, the interval, the photo and label_printed_at.
create or replace function guard_equipment_server_columns()
returns trigger
language plpgsql as $$
declare
  v_changed text[] := array[]::text[];
begin
  -- Migrations, SECURITY DEFINER functions (recompute_equipment_state, the
  -- replacement outcome) and the service role run as the owner, not as an
  -- API role, and are trusted. Only requests from the app are checked.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- A new machine starts with nothing the server has not worked out.
    new.status           := 'operational';
    new.last_service_at  := null;
    new.next_service_due := null;
    new.retired_at       := null;
    new.created_by       := auth.uid();
    return new;
  end if;

  if new.status           is distinct from old.status           then v_changed := array_append(v_changed, 'status'); end if;
  if new.last_service_at  is distinct from old.last_service_at  then v_changed := array_append(v_changed, 'last_service_at'); end if;
  if new.next_service_due is distinct from old.next_service_due then v_changed := array_append(v_changed, 'next_service_due'); end if;
  if new.retired_at       is distinct from old.retired_at       then v_changed := array_append(v_changed, 'retired_at'); end if;
  if new.asset_id         is distinct from old.asset_id         then v_changed := array_append(v_changed, 'asset_id'); end if;
  if new.lab_id           is distinct from old.lab_id           then v_changed := array_append(v_changed, 'lab_id'); end if;
  if new.created_by       is distinct from old.created_by       then v_changed := array_append(v_changed, 'created_by'); end if;
  if new.created_at       is distinct from old.created_at       then v_changed := array_append(v_changed, 'created_at'); end if;

  if cardinality(v_changed) > 0 then
    raise exception using
      errcode = '42501',
      message = format('%s cannot be changed directly', array_to_string(v_changed, ', ')),
      hint    = 'Status and service dates follow from recorded events. The asset ID and lab are fixed at registration because they are printed on the label.';
  end if;

  return new;
end;
$$;

drop trigger if exists equipment_guard_server_columns on equipment;
create trigger equipment_guard_server_columns
before insert or update on equipment
for each row execute function guard_equipment_server_columns();


-- =========================================================== 2. interval changes

-- The next due date falls back to "last service + interval" when no event
-- set one explicitly. Changing the interval must move that date, or the
-- machine keeps alerting on the old schedule.
create or replace function on_equipment_interval_changed()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform recompute_equipment_state(new.id);
  return null;
end;
$$;

drop trigger if exists equipment_interval_changed on equipment;
create trigger equipment_interval_changed
after update of service_interval_days on equipment
for each row
when (old.service_interval_days is distinct from new.service_interval_days)
execute function on_equipment_interval_changed();


-- =========================================================== 3. documents

alter table equipment_documents
  add column if not exists withdrawn_at timestamptz,
  add column if not exists withdrawn_by uuid references profiles(id);

-- Whoever is signed in is the uploader; the client does not get to say.
alter table equipment_documents alter column uploaded_by set default auth.uid();

-- A document lives in its own machine's folder, exactly like the photo.
alter table equipment_documents drop constraint if exists equipment_documents_own_folder;
alter table equipment_documents
  add constraint equipment_documents_own_folder
  check (file_path like equipment_id::text || '/%') not valid;

create index if not exists equipment_documents_live
  on equipment_documents (equipment_id) where withdrawn_at is null;

-- Withdrawing is the only change ever allowed, and only once.
create or replace function guard_document_update()
returns trigger
language plpgsql as $$
begin
  if (new.equipment_id, new.kind, new.title, new.file_path, new.uploaded_by, new.created_at)
     is distinct from
     (old.equipment_id, old.kind, old.title, old.file_path, old.uploaded_by, old.created_at) then
    raise exception 'a document cannot be edited; withdraw it and upload a new version';
  end if;

  if old.withdrawn_at is not null then
    raise exception 'this document has already been withdrawn';
  end if;

  if new.withdrawn_at is not null then
    -- The server's clock and the server's idea of who did it.
    new.withdrawn_at := now();
    new.withdrawn_by := coalesce(auth.uid(), new.withdrawn_by);
  end if;

  return new;
end;
$$;

drop trigger if exists equipment_documents_guard_update on equipment_documents;
create trigger equipment_documents_guard_update
before update on equipment_documents
for each row execute function guard_document_update();

drop policy if exists documents_write    on equipment_documents;
drop policy if exists documents_insert   on equipment_documents;
drop policy if exists documents_withdraw on equipment_documents;

create policy documents_insert on equipment_documents
  for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and exists (select 1 from equipment e
                where e.id = equipment_id and auth_writes_equipment() and auth_in_lab(e.lab_id))
  );

create policy documents_withdraw on equipment_documents
  for update to authenticated
  using      (exists (select 1 from equipment e
                      where e.id = equipment_id and auth_writes_equipment() and auth_in_lab(e.lab_id)))
  with check (exists (select 1 from equipment e
                      where e.id = equipment_id and auth_writes_equipment() and auth_in_lab(e.lab_id)));

-- A withdrawn SOP disappears from the public passport and stops being
-- downloadable by visitors. Staff can still open it from the record.
create or replace function is_public_sop(object_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from equipment_documents d
    where d.kind = 'sop' and d.file_path = object_name and d.withdrawn_at is null
  );
$$;

-- Same as 0002, plus the withdrawn filter on documents.
create or replace function get_public_equipment(p_qr_token text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'asset_id',             e.asset_id,
    'name',                 e.name,
    'manufacturer',         e.manufacturer,
    'model',                e.model,
    'serial_no',            e.serial_no,
    'location',             e.location,
    'operating_conditions', e.operating_conditions,
    'photo_path',           e.photo_path,
    'status',               e.status,
    'last_service_at',      e.last_service_at,
    'next_service_due',     e.next_service_due,
    'lab',                  jsonb_build_object('name', l.name, 'building', l.building, 'room', l.room),
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object('title', d.title, 'kind', d.kind, 'file_path', d.file_path)
                       order by d.created_at)
      from equipment_documents d
      where d.equipment_id = e.id and d.kind = 'sop' and d.withdrawn_at is null
    ), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
               'type', ev.type,
               'occurred_at', ev.occurred_at,
               'severity', ev.severity,
               'summary', ev.data ->> 'summary')
             order by ev.occurred_at desc)
      from (select * from events where equipment_id = e.id order by occurred_at desc limit 100) ev
    ), '[]'::jsonb)
  )
  from equipment e join labs l on l.id = e.lab_id
  where e.qr_token = p_qr_token;
$$;


-- =========================================================== 4. realtime

-- Realtime respects RLS, so each person only receives their own rows
-- (notifications_own in 0002). Idempotent: safe to re-run.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime'
                       and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;


-- =========================================================== 5. push on shared phones

-- A push endpoint belongs to one browser on one device, not to a person.
-- Lab phones are shared: if the last person's session expired instead of
-- them signing out, their subscription row still points at this phone, and
-- RLS (push_subs_own) rightly stops the next person editing someone else's
-- row. Whoever is signed in on the device now claims it, so alerts follow
-- the person holding the phone.
create or replace function claim_push_subscription(p_endpoint text, p_keys jsonb, p_user_agent text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'sign in before turning on notifications';
  end if;
  if coalesce(p_keys ->> 'p256dh', '') = '' or coalesce(p_keys ->> 'auth', '') = '' then
    raise exception 'a push subscription needs both p256dh and auth keys';
  end if;

  insert into push_subscriptions (profile_id, endpoint, keys, user_agent)
  values (auth.uid(), p_endpoint, p_keys, left(p_user_agent, 255))
  on conflict (endpoint) do update
    set profile_id = excluded.profile_id,
        keys       = excluded.keys,
        user_agent = excluded.user_agent,
        created_at = now();
end;
$$;

revoke all on function claim_push_subscription(text, jsonb, text) from public, anon;
grant execute on function claim_push_subscription(text, jsonb, text) to authenticated;
