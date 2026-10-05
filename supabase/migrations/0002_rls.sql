-- 0002_rls.sql — Row Level Security, and the two public read functions.
--
-- The anon key can reach NO table directly. Public reads go through two
-- SECURITY DEFINER functions that return only public columns. Everything else
-- is scoped by lab membership, enforced here rather than in the client.

alter table institution          enable row level security;
alter table labs                 enable row level security;
alter table profiles             enable row level security;
alter table lab_members          enable row level security;
alter table equipment            enable row level security;
alter table equipment_documents  enable row level security;
alter table events               enable row level security;
alter table service_reports      enable row level security;
alter table event_attachments    enable row level security;
alter table notifications        enable row level security;
alter table email_outbox         enable row level security;
alter table push_outbox          enable row level security;
alter table push_subscriptions   enable row level security;
alter table audit_log            enable row level security;

-- ---------------------------------------------------------------- helpers

create or replace function auth_role() returns app_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() and is_active;
$$;

create or replace function auth_is(roles app_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth_role() = any(roles), false);
$$;

-- A technician or HOD may only touch equipment in a lab they are a member of.
create or replace function auth_in_lab(target_lab uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from lab_members
    where profile_id = auth.uid() and lab_id = target_lab
  );
$$;

create or replace function auth_writes_equipment() returns boolean
language sql stable security definer set search_path = public as $$
  select auth_is(array['technician', 'lab_hod']::app_role[]);
$$;

-- ---------------------------------------------------------------- institution, labs

create policy institution_read on institution
  for select to authenticated using (true);

create policy labs_read on labs
  for select to authenticated using (true);

create policy labs_admin on labs
  for all to authenticated using (auth_is(array['admin']::app_role[]))
  with check (auth_is(array['admin']::app_role[]));

-- ---------------------------------------------------------------- people

create policy profiles_self on profiles
  for select to authenticated using (id = auth.uid());

create policy profiles_visible_to_leaders on profiles
  for select to authenticated
  using (auth_is(array['lab_hod', 'senior_leader', 'admin']::app_role[]));

-- A policy ON profiles must never SELECT profiles directly: Postgres applies
-- the policy to that subquery too and recurses. auth_role() is SECURITY
-- DEFINER, so it reads the row without re-entering the policy.
create policy profiles_self_update on profiles
  for update to authenticated using (id = auth.uid())
  with check (id = auth.uid() and role = auth_role());

create policy profiles_admin on profiles
  for all to authenticated using (auth_is(array['admin']::app_role[]))
  with check (auth_is(array['admin']::app_role[]));

create policy lab_members_read on lab_members
  for select to authenticated using (true);

create policy lab_members_admin on lab_members
  for all to authenticated using (auth_is(array['admin']::app_role[]))
  with check (auth_is(array['admin']::app_role[]));

-- ---------------------------------------------------------------- equipment

create policy equipment_read on equipment
  for select to authenticated
  using (
    auth_is(array['senior_leader', 'admin']::app_role[])
    or auth_in_lab(lab_id)
  );

create policy equipment_insert on equipment
  for insert to authenticated
  with check (auth_writes_equipment() and auth_in_lab(lab_id));

create policy equipment_update on equipment
  for update to authenticated
  using (auth_writes_equipment() and auth_in_lab(lab_id))
  with check (auth_writes_equipment() and auth_in_lab(lab_id));

-- No delete policy anywhere on equipment: retiring is a status, not a delete.

create policy documents_read on equipment_documents
  for select to authenticated
  using (exists (select 1 from equipment e where e.id = equipment_id
                 and (auth_is(array['senior_leader','admin']::app_role[]) or auth_in_lab(e.lab_id))));

create policy documents_write on equipment_documents
  for insert to authenticated
  with check (exists (select 1 from equipment e where e.id = equipment_id
                      and auth_writes_equipment() and auth_in_lab(e.lab_id)));

-- ---------------------------------------------------------------- events: insert only

create policy events_read on events
  for select to authenticated
  using (exists (select 1 from equipment e where e.id = equipment_id
                 and (auth_is(array['senior_leader','admin']::app_role[]) or auth_in_lab(e.lab_id))));

create policy events_insert on events
  for insert to authenticated
  with check (
    recorded_by = auth.uid()
    and exists (select 1 from equipment e where e.id = equipment_id
                and auth_writes_equipment() and auth_in_lab(e.lab_id))
  );

-- Deliberately no update and no delete policy on events. The history is append-only.

create policy service_reports_read on service_reports
  for select to authenticated
  using (exists (select 1 from events ev join equipment e on e.id = ev.equipment_id
                 where ev.id = event_id
                 and (auth_is(array['senior_leader','admin']::app_role[]) or auth_in_lab(e.lab_id))));

create policy service_reports_insert on service_reports
  for insert to authenticated
  with check (exists (select 1 from events ev join equipment e on e.id = ev.equipment_id
                      where ev.id = event_id and auth_writes_equipment() and auth_in_lab(e.lab_id)));

-- The replacement OUTCOME is the one field that can be set later.
create policy service_reports_outcome on service_reports
  for update to authenticated
  using (exists (select 1 from events ev join equipment e on e.id = ev.equipment_id
                 where ev.id = event_id and auth_writes_equipment() and auth_in_lab(e.lab_id)))
  with check (true);

create policy attachments_read on event_attachments
  for select to authenticated
  using (exists (select 1 from events ev join equipment e on e.id = ev.equipment_id
                 where ev.id = event_id
                 and (auth_is(array['senior_leader','admin']::app_role[]) or auth_in_lab(e.lab_id))));

create policy attachments_insert on event_attachments
  for insert to authenticated
  with check (exists (select 1 from events ev where ev.id = event_id and ev.recorded_by = auth.uid()));

-- ---------------------------------------------------------------- alerts

create policy notifications_own on notifications
  for select to authenticated using (profile_id = auth.uid());

create policy notifications_mark_read on notifications
  for update to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());

create policy push_subs_own on push_subscriptions
  for all to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- Outboxes and the audit log are service-role only: no policy means no access.

-- ---------------------------------------------------------------- public reads

-- Everything a visitor standing at the bench may see, and nothing more.
-- Note: full history is public by the institution's choice; personal contact
-- details and internal file paths are not.
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
      from equipment_documents d where d.equipment_id = e.id and d.kind = 'sop'
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

create or replace function get_public_lab(p_public_token text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'name', l.name, 'building', l.building, 'room', l.room,
    'equipment', coalesce((
      select jsonb_agg(jsonb_build_object(
               'qr_token', e.qr_token, 'asset_id', e.asset_id, 'name', e.name,
               'location', e.location, 'status', e.status,
               'photo_path', e.photo_path, 'next_service_due', e.next_service_due)
             order by e.name)
      from equipment e where e.lab_id = l.id
    ), '[]'::jsonb)
  )
  from labs l where l.public_token = p_public_token and l.is_active;
$$;

revoke all on function get_public_equipment(text) from public;
revoke all on function get_public_lab(text) from public;
grant execute on function get_public_equipment(text) to anon, authenticated;
grant execute on function get_public_lab(text) to anon, authenticated;
