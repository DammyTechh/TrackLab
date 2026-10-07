-- =====================================================================
-- 0001_schema.sql — the whole database structure, in one file.
--
-- Run it once on an empty project: Supabase dashboard -> SQL Editor ->
-- paste all of it -> Run. It runs as a single transaction, so it either
-- completes or changes nothing. Then run 0002 (your institution, labs and
-- accounts).
--
-- It is the earlier migrations 0001-0010 and 0012 joined in the order they
-- were written and tested, so later sections sometimes redefine a function
-- or a policy from an earlier one. That is intended: the result is exactly
-- what the test suite checks against real PostgreSQL.
-- =====================================================================


-- =====================================================================
-- Part 1 of 9: Tables and types   (was 0001_schema.sql)
-- =====================================================================

-- 0001_schema.sql — EvidenceTag core schema.
-- Twelve tables. Status and due dates are computed server-side only.

-- Supabase keeps extensions out of public. Pin pgcrypto there explicitly so
-- crypt(), gen_salt() and gen_random_bytes() resolve the same way on a local
-- `db reset` as they do on the hosted project.
create schema if not exists extensions;
create extension if not exists "pgcrypto" with schema extensions;
create extension if not exists "pg_cron";
create extension if not exists "pg_net";

-- ---------------------------------------------------------------- enums

create type app_role as enum ('technician', 'lab_hod', 'senior_leader', 'admin');

create type equipment_status as enum (
  'operational', 'due_soon', 'overdue', 'faulty',
  'maintenance', 'replace', 'retired'
);

create type event_type as enum (
  'use', 'fault', 'maintenance', 'inspection', 'service_report', 'status_change'
);

create type fault_severity as enum ('minor', 'major', 'critical');
create type service_recommendation as enum ('continue', 'repair', 'replace');
create type replacement_outcome as enum ('replaced', 'retired', 'kept_in_service');
create type alert_tier as enum ('upcoming', 'warning', 'critical_due', 'critical_replacement', 'critical_fault');
create type outbox_status as enum ('pending', 'sent', 'failed');

-- ---------------------------------------------------------------- institution

create table institution (
  id                    uuid primary key default gen_random_uuid(),
  code                  text not null unique,
  name                  text not null,
  product_name          text not null,
  logo_url              text,
  brand_primary         text not null,
  brand_accent          text not null,
  email_from            text not null,
  timezone              text not null default 'Africa/Lagos',
  threshold_upcoming    int  not null default 30,
  threshold_warning     int  not null default 7,
  critical_repeat_days  int  not null default 3,
  created_at            timestamptz not null default now()
);
comment on table institution is 'Exactly one row per deployment. Branding comes from here plus build-time env.';

-- ---------------------------------------------------------------- labs, people

create table labs (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  code          text not null unique,
  building      text,
  room          text,
  -- 18 hex characters. Like an equipment token it is printed once and permanent.
  public_token  text not null unique default encode(extensions.gen_random_bytes(9), 'hex'),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

create table profiles (
  id                     uuid primary key references auth.users(id) on delete cascade,
  full_name              text not null,
  phone                  text,
  role                   app_role not null,
  is_active              boolean not null default true,
  must_change_password   boolean not null default true,
  created_at             timestamptz not null default now()
);

create table lab_members (
  lab_id      uuid not null references labs(id) on delete cascade,
  profile_id  uuid not null references profiles(id) on delete cascade,
  primary key (lab_id, profile_id)
);
create index on lab_members (profile_id);

-- ---------------------------------------------------------------- equipment

create table equipment (
  id                    uuid primary key default gen_random_uuid(),
  lab_id                uuid not null references labs(id) on delete restrict,
  asset_id              text not null unique,
  qr_token              text not null unique,
  name                  text not null,
  manufacturer          text,
  model                 text,
  serial_no             text,
  specs                 jsonb not null default '{}'::jsonb,
  location              text,
  operating_conditions  text,
  photo_path            text,
  status                equipment_status not null default 'operational',
  service_interval_days int not null default 180 check (service_interval_days > 0),
  last_service_at       date,
  next_service_due      date,
  retired_at            timestamptz,
  label_printed_at      timestamptz,
  created_by            uuid references profiles(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
comment on column equipment.qr_token is
  'Permanent. The label is printed once at registration and never reissued; every later update is read through this same token.';
comment on column equipment.status is 'Written only by recompute_equipment_state(). Never by a client.';

create index on equipment (lab_id);
create index on equipment (status);
create index on equipment (next_service_due) where retired_at is null;

create table equipment_documents (
  id            uuid primary key default gen_random_uuid(),
  equipment_id  uuid not null references equipment(id) on delete cascade,
  kind          text not null check (kind in ('sop', 'manual', 'certificate')),
  title         text not null,
  file_path     text not null,
  uploaded_by   uuid references profiles(id),
  created_at    timestamptz not null default now()
);
create index on equipment_documents (equipment_id);

-- ---------------------------------------------------------------- events

create table events (
  -- id is generated on the DEVICE so offline creates never collide.
  id                uuid primary key,
  equipment_id      uuid not null references equipment(id) on delete cascade,
  type              event_type not null,
  occurred_at       timestamptz not null,
  data              jsonb not null default '{}'::jsonb,
  severity          fault_severity,
  next_due_date     date,
  recorded_by       uuid not null references profiles(id),
  corrects_event_id uuid references events(id),
  created_at        timestamptz not null default now(),
  synced_at         timestamptz not null default now()
);
comment on table events is 'Append-only. No update, no delete. A correction is a new row with corrects_event_id set.';
create index on events (equipment_id, occurred_at desc);

create table service_reports (
  event_id        uuid primary key references events(id) on delete cascade,
  vendor_company  text not null,
  engineer_name   text,
  contact         text,
  service_date    date not null,
  work_done       text not null,
  report_path     text,
  next_due_date   date,
  recommendation  service_recommendation not null,
  outcome         replacement_outcome,
  outcome_note    text,
  outcome_at      timestamptz,
  replaced_by_equipment_id uuid references equipment(id)
);

create table event_attachments (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  file_path   text not null,
  mime        text not null,
  created_at  timestamptz not null default now()
);
create index on event_attachments (event_id);

-- ---------------------------------------------------------------- alerting

create table notifications (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references profiles(id) on delete cascade,
  equipment_id  uuid references equipment(id) on delete cascade,
  tier          alert_tier not null,
  title         text not null,
  body          text not null,
  dedupe_key    text not null,
  read_at       timestamptz,
  closed_at     timestamptz,
  created_at    timestamptz not null default now(),
  unique (profile_id, dedupe_key)
);
create index on notifications (profile_id, created_at desc) where read_at is null;

create table email_outbox (
  id          uuid primary key default gen_random_uuid(),
  recipient   text not null,
  template    text not null,
  payload     jsonb not null,
  status      outbox_status not null default 'pending',
  attempts    int not null default 0,
  last_error  text,
  send_after  timestamptz not null default now(),
  sent_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index on email_outbox (status, send_after);

create table push_outbox (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references profiles(id) on delete cascade,
  payload     jsonb not null,
  status      outbox_status not null default 'pending',
  attempts    int not null default 0,
  last_error  text,
  send_after  timestamptz not null default now(),
  sent_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index on push_outbox (status, send_after);

create table push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references profiles(id) on delete cascade,
  endpoint    text not null unique,
  keys        jsonb not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index on push_subscriptions (profile_id);

create table audit_log (
  id          bigserial primary key,
  actor_id    uuid,
  action      text not null,
  table_name  text not null,
  row_id      text,
  diff        jsonb,
  at          timestamptz not null default now()
);
create index on audit_log (table_name, at desc);


-- =====================================================================
-- Part 2 of 9: Row level security and the public read functions   (was 0002_rls.sql)
-- =====================================================================

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


-- =====================================================================
-- Part 3 of 9: Status, alerts and the audit trail   (was 0003_triggers.sql)
-- =====================================================================

-- 0003_triggers.sql — status, alerts and the audit trail.
--
-- The client NEVER writes equipment.status or next_service_due. Everything
-- below runs after an event lands, whether it arrived live or came up from a
-- phone's offline outbox an hour later.

-- ---------------------------------------------------------------- status

-- Precedence, highest first: retired > faulty > replace > maintenance > overdue > due_soon > operational.
create or replace function compute_status(
  p_retired_at      timestamptz,
  p_open_fault      boolean,
  p_replace_open    boolean,
  p_maint_open      boolean,
  p_next_due        date,
  p_threshold_days  int,
  p_today           date
) returns equipment_status
language sql immutable as $$
  select case
    when p_retired_at is not null                              then 'retired'
    when p_open_fault                                          then 'faulty'
    when p_replace_open                                        then 'replace'
    when p_maint_open                                          then 'maintenance'
    when p_next_due is not null and p_next_due <  p_today       then 'overdue'
    when p_next_due is not null
         and p_next_due <= p_today + p_threshold_days           then 'due_soon'
    else 'operational'
  end::equipment_status;
$$;

create or replace function recompute_equipment_state(p_equipment_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_tz           text;
  v_threshold    int;
  v_today        date;
  v_eq           equipment%rowtype;
  v_last_service date;
  v_next_due     date;
  v_open_fault   boolean;
  v_replace_open boolean;
  v_maint_open   boolean;
  v_status       equipment_status;
begin
  select timezone, threshold_upcoming into v_tz, v_threshold from institution limit 1;
  v_today := (now() at time zone coalesce(v_tz, 'Africa/Lagos'))::date;

  select * into v_eq from equipment where id = p_equipment_id for update;
  if not found then return; end if;

  -- Last service: the most recent maintenance or external service report.
  select max(occurred_at)::date into v_last_service
  from events
  where equipment_id = p_equipment_id and type in ('maintenance', 'service_report');

  -- Next due: the latest explicit date from an event, else interval from last service.
  select next_due_date into v_next_due
  from events
  where equipment_id = p_equipment_id and next_due_date is not null
  order by occurred_at desc, created_at desc
  limit 1;

  if v_next_due is null and v_last_service is not null then
    v_next_due := (v_last_service + (v_eq.service_interval_days || ' days')::interval)::date;
  end if;

  -- A critical fault is open until a later maintenance or service event clears it.
  select exists (
    select 1 from events f
    where f.equipment_id = p_equipment_id and f.type = 'fault' and f.severity = 'critical'
      and not exists (
        select 1 from events c
        where c.equipment_id = p_equipment_id
          and c.type in ('maintenance', 'service_report')
          and c.occurred_at > f.occurred_at
      )
  ) into v_open_fault;

  -- A Replace recommendation is open until its outcome is recorded.
  select exists (
    select 1 from service_reports sr join events ev on ev.id = sr.event_id
    where ev.equipment_id = p_equipment_id
      and sr.recommendation = 'replace' and sr.outcome is null
  ) into v_replace_open;

  -- Maintenance marked in progress and not yet closed out.
  select coalesce((
    select (m.data ->> 'in_progress')::boolean
    from events m
    where m.equipment_id = p_equipment_id and m.type = 'maintenance'
    order by m.occurred_at desc limit 1
  ), false) into v_maint_open;

  v_status := compute_status(v_eq.retired_at, v_open_fault, v_replace_open,
                             v_maint_open, v_next_due, v_threshold, v_today);

  update equipment
     set status           = v_status,
         last_service_at  = coalesce(v_last_service, last_service_at),
         next_service_due = v_next_due,
         updated_at       = now()
   where id = p_equipment_id;

  -- A new due date, a completed service or a cleared fault closes open alerts.
  if v_status in ('operational', 'due_soon') then
    update notifications
       set closed_at = now()
     where equipment_id = p_equipment_id and closed_at is null
       and tier in ('critical_due', 'critical_fault', 'warning', 'upcoming');
  end if;
end;
$$;

-- ---------------------------------------------------------------- alert queueing

-- Who hears about this machine: the technicians and the HOD of its lab.
create or replace function lab_recipients(p_equipment_id uuid)
returns table (profile_id uuid, email text, full_name text)
language sql stable security definer set search_path = public as $$
  select p.id, u.email, p.full_name
  from equipment e
  join lab_members lm on lm.lab_id = e.lab_id
  join profiles p     on p.id = lm.profile_id
  join auth.users u   on u.id = p.id
  where e.id = p_equipment_id and p.is_active
    and p.role in ('technician', 'lab_hod');
$$;

create or replace function queue_alert(
  p_equipment_id uuid,
  p_tier         alert_tier,
  p_title        text,
  p_body         text,
  p_dedupe_key   text,
  p_template     text,
  p_payload      jsonb
) returns void
language plpgsql security definer set search_path = public as $$
declare
  r          record;
  v_inserted uuid;
begin
  for r in select * from lab_recipients(p_equipment_id) loop
    -- Reset per recipient: a RETURNING INTO that matches nothing must not
    -- leave the previous recipient's id in the variable.
    v_inserted := null;

    -- The dedupe key is the gate for ALL THREE channels. Queueing push and
    -- email outside this guard was the bug: the daily sweep deduped the
    -- in-app row but pushed the same alert to the phone every morning.
    insert into notifications (profile_id, equipment_id, tier, title, body, dedupe_key)
    values (r.profile_id, p_equipment_id, p_tier, p_title, p_body, p_dedupe_key)
    on conflict (profile_id, dedupe_key) do nothing
    returning id into v_inserted;

    continue when v_inserted is null;

    insert into push_outbox (profile_id, payload)
    values (r.profile_id, jsonb_build_object('title', p_title, 'body', p_body,
                                             'tier', p_tier, 'equipment_id', p_equipment_id));

    if p_template is not null then
      insert into email_outbox (recipient, template, payload)
      values (r.email, p_template,
              p_payload || jsonb_build_object('to_name', r.full_name, 'title', p_title, 'body', p_body));
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------- the event trigger

create or replace function on_event_inserted()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_eq equipment%rowtype;
  v_due date;
begin
  perform recompute_equipment_state(new.equipment_id);
  select * into v_eq from equipment where id = new.equipment_id;

  if new.type = 'fault' and new.severity = 'critical' then
    perform queue_alert(
      new.equipment_id, 'critical_fault',
      'Critical fault: ' || v_eq.name,
      v_eq.asset_id || ' was reported faulty and is out of service.',
      'fault:' || new.id::text,
      'critical_fault',
      jsonb_build_object('asset_id', v_eq.asset_id, 'equipment_name', v_eq.name, 'event_id', new.id)
    );
  end if;

  insert into audit_log (actor_id, action, table_name, row_id, diff)
  values (new.recorded_by, 'insert', 'events', new.id::text,
          jsonb_build_object('type', new.type, 'equipment_id', new.equipment_id));

  return new;
end;
$$;

create trigger events_after_insert
after insert on events
for each row execute function on_event_inserted();

-- A service report lands after its event row, so the replacement alert fires here.
create or replace function on_service_report_inserted()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_equipment_id uuid;
  v_eq equipment%rowtype;
begin
  select equipment_id into v_equipment_id from events where id = new.event_id;
  perform recompute_equipment_state(v_equipment_id);
  select * into v_eq from equipment where id = v_equipment_id;

  if new.recommendation = 'replace' then
    perform queue_alert(
      v_equipment_id, 'critical_replacement',
      'Replacement recommended: ' || v_eq.name,
      new.vendor_company || ' recommends replacing ' || v_eq.asset_id || '.',
      'replace:' || new.event_id::text,
      'critical_replacement',
      jsonb_build_object('asset_id', v_eq.asset_id, 'equipment_name', v_eq.name,
                         'vendor', new.vendor_company, 'report_path', new.report_path,
                         'attach_report', true)
    );
  end if;
  return new;
end;
$$;

create trigger service_reports_after_insert
after insert on service_reports
for each row execute function on_service_report_inserted();

-- Recording the outcome closes the replacement alert and its weekly repeat.
create or replace function on_service_report_outcome()
returns trigger
language plpgsql security definer set search_path = public as $$
declare v_equipment_id uuid;
begin
  if new.outcome is distinct from old.outcome and new.outcome is not null then
    select equipment_id into v_equipment_id from events where id = new.event_id;
    update notifications set closed_at = now()
     where equipment_id = v_equipment_id and tier = 'critical_replacement' and closed_at is null;
    perform recompute_equipment_state(v_equipment_id);
  end if;
  return new;
end;
$$;

create trigger service_reports_after_update
after update on service_reports
for each row execute function on_service_report_outcome();

-- ---------------------------------------------------------------- guards

-- Belt and braces on top of the missing RLS policies: the history cannot change.
create or replace function reject_event_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'events are append-only; record a correcting event instead';
end;
$$;

create trigger events_no_update before update on events
for each row execute function reject_event_mutation();

create trigger events_no_delete before delete on events
for each row execute function reject_event_mutation();

-- The QR token is printed on a physical label. It must never change.
create or replace function reject_qr_token_change()
returns trigger language plpgsql as $$
begin
  if new.qr_token is distinct from old.qr_token then
    raise exception 'qr_token is permanent: the printed label would stop resolving';
  end if;
  return new;
end;
$$;

create trigger equipment_qr_token_immutable before update on equipment
for each row execute function reject_qr_token_change();


-- =====================================================================
-- Part 4 of 9: Scheduled jobs: due dates and the outbox   (was 0004_jobs.sql)
-- =====================================================================

-- 0004_jobs.sql — the daily due-date sweep and the outbox dispatcher.

create or replace function check_due_dates()
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_tz        text;
  v_up        int;
  v_warn      int;
  v_repeat    int;
  v_today     date;
  r           record;
  v_count     int := 0;
begin
  select timezone, threshold_upcoming, threshold_warning, critical_repeat_days
    into v_tz, v_up, v_warn, v_repeat
  from institution limit 1;

  v_today := (now() at time zone coalesce(v_tz, 'Africa/Lagos'))::date;

  for r in
    select e.id, e.asset_id, e.name, e.next_service_due,
           (v_today - e.next_service_due) as days_late
    from equipment e
    where e.retired_at is null
      and e.next_service_due is not null
      and e.next_service_due <= v_today + v_up
  loop
    -- Recompute first, so due_soon / overdue are right before we alert on them.
    perform recompute_equipment_state(r.id);

    if r.days_late >= 0 then
      -- Critical. Repeats every N days until serviced; the dedupe key carries the window.
      perform queue_alert(
        r.id, 'critical_due',
        'Servicing overdue: ' || r.name,
        case when r.days_late = 0
             then r.asset_id || ' is due for servicing today.'
             else r.asset_id || ' is overdue by ' || r.days_late || ' days.' end,
        'due:' || r.id::text || ':' || r.next_service_due::text || ':w' || (r.days_late / v_repeat)::text,
        'critical_due',
        jsonb_build_object('asset_id', r.asset_id, 'equipment_name', r.name,
                           'due_date', r.next_service_due, 'days_late', r.days_late)
      );
    elsif -r.days_late <= v_warn then
      perform queue_alert(
        r.id, 'warning',
        'Service due in ' || (-r.days_late) || ' days',
        r.asset_id || ' is due on ' || to_char(r.next_service_due, 'DD Mon YYYY') || '.',
        'due:' || r.id::text || ':' || r.next_service_due::text || ':warning',
        'warning',
        jsonb_build_object('asset_id', r.asset_id, 'equipment_name', r.name, 'due_date', r.next_service_due)
      );
    else
      -- Upcoming: in-app and push only, no email.
      perform queue_alert(
        r.id, 'upcoming',
        'Service due in ' || (-r.days_late) || ' days',
        r.asset_id || ' is due on ' || to_char(r.next_service_due, 'DD Mon YYYY') || '.',
        'due:' || r.id::text || ':' || r.next_service_due::text || ':upcoming',
        null, '{}'::jsonb
      );
    end if;

    v_count := v_count + 1;
  end loop;

  -- Weekly nudge while a replacement has no recorded outcome.
  for r in
    select e.id, e.asset_id, e.name, sr.vendor_company, sr.report_path, sr.event_id
    from service_reports sr
    join events ev on ev.id = sr.event_id
    join equipment e on e.id = ev.equipment_id
    where sr.recommendation = 'replace' and sr.outcome is null and e.retired_at is null
  loop
    perform queue_alert(
      r.id, 'critical_replacement',
      'Still awaiting a decision: ' || r.name,
      r.vendor_company || ' recommended replacing ' || r.asset_id || '. No outcome recorded yet.',
      'replace:' || r.event_id::text || ':wk' || to_char(v_today, 'IYYY-IW'),
      'critical_replacement',
      jsonb_build_object('asset_id', r.asset_id, 'equipment_name', r.name,
                         'vendor', r.vendor_company, 'report_path', r.report_path, 'attach_report', true)
    );
  end loop;

  return v_count;
end;
$$;

-- 07:00 Africa/Lagos is 06:00 UTC. pg_cron speaks UTC.
select cron.schedule('evidencetag-due-dates', '0 6 * * *', $$select check_due_dates();$$);

-- Push the outboxes every five minutes. Secrets live in Vault, never in a table.
select cron.schedule(
  'evidencetag-dispatch-outbox',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'app_base_url')
               || '/functions/v1/dispatch-outbox',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' ||
                   (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')),
    body    := '{}'::jsonb
  );
  $$
);


-- =====================================================================
-- Part 5 of 9: File storage: buckets and who may read and write them   (was 0007_storage.sql)
-- =====================================================================

-- 0007_storage.sql — storage buckets, storage policies, and the equipment photo.
--
-- config.toml only creates buckets for `supabase start` on a laptop. The
-- hosted project never reads that file, so before this migration the three
-- buckets did not exist in production and, even where they did, storage.objects
-- had no policy at all — every upload from the app was refused.
--
-- Object paths always start with the equipment id, so one rule covers all
-- three buckets: you may write a file if you may write that machine.
--
--   equipment-photos  {equipment_id}/{uuid}.jpg            profile photo, public
--   documents         {equipment_id}/{uuid}.{pdf|...}      SOPs, manuals, certificates
--   event-files       {equipment_id}/{event_id}/{uuid}.jpg photos / reports on an event
--
-- There is no delete policy on any bucket. A replaced photo stays in storage;
-- the row simply points at the new one. That matches the append-only history.

-- ---------------------------------------------------------------- buckets

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  -- Public: the passport is read by visitors with no account, and the photo
  -- is what tells them they are standing at the right machine. The path holds
  -- a random uuid, and nothing in it is more sensitive than the passport itself.
  ('equipment-photos', 'equipment-photos', true,  5242880,
     array['image/jpeg', 'image/png', 'image/webp']),
  ('documents',        'documents',        false, 20971520,
     array['application/pdf', 'image/jpeg', 'image/png',
           'application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
  ('event-files',      'event-files',      false, 10485760,
     array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------- helpers

-- The first folder of an object path, as an equipment id. Null when it is not
-- a uuid, so a malformed path fails the policy instead of raising a cast error.
create or replace function storage_equipment_id(object_name text) returns uuid
language sql stable as $$
  select case
    when (storage.foldername(object_name))[1]
         ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then ((storage.foldername(object_name))[1])::uuid
  end;
$$;

-- Same rule as equipment_update in 0002: a technician or HOD in that lab.
create or replace function can_write_equipment_files(object_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select auth_writes_equipment() and exists (
    select 1 from equipment e
    where e.id = storage_equipment_id(object_name) and auth_in_lab(e.lab_id)
  );
$$;

-- Same rule as equipment_read in 0002.
create or replace function can_read_equipment_files(object_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from equipment e
    where e.id = storage_equipment_id(object_name)
      and (auth_is(array['senior_leader', 'admin']::app_role[]) or auth_in_lab(e.lab_id))
  );
$$;

-- The passport lists SOPs to anyone; this lets an anonymous visitor open
-- exactly those files and no other document.
create or replace function is_public_sop(object_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from equipment_documents d
    where d.kind = 'sop' and d.file_path = object_name
  );
$$;

grant execute on function storage_equipment_id(text)      to anon, authenticated;
grant execute on function can_write_equipment_files(text) to authenticated;
grant execute on function can_read_equipment_files(text)  to authenticated;
grant execute on function is_public_sop(text)             to anon, authenticated;

-- ---------------------------------------------------------------- policies
-- Upload with upsert (which sync.ts uses so a retry is harmless) needs
-- SELECT and UPDATE as well as INSERT, so writers get all three.

drop policy if exists equipment_photos_read   on storage.objects;
drop policy if exists equipment_photos_insert on storage.objects;
drop policy if exists equipment_photos_update on storage.objects;

create policy equipment_photos_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'equipment-photos');

create policy equipment_photos_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'equipment-photos' and can_write_equipment_files(name));

create policy equipment_photos_update on storage.objects
  for update to authenticated
  using      (bucket_id = 'equipment-photos' and can_write_equipment_files(name))
  with check (bucket_id = 'equipment-photos' and can_write_equipment_files(name));

drop policy if exists documents_read_staff on storage.objects;
drop policy if exists documents_read_sop   on storage.objects;
drop policy if exists documents_insert     on storage.objects;
drop policy if exists documents_update     on storage.objects;

create policy documents_read_staff on storage.objects
  for select to authenticated
  using (bucket_id = 'documents' and can_read_equipment_files(name));

create policy documents_read_sop on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'documents' and is_public_sop(name));

create policy documents_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'documents' and can_write_equipment_files(name));

create policy documents_update on storage.objects
  for update to authenticated
  using      (bucket_id = 'documents' and can_write_equipment_files(name))
  with check (bucket_id = 'documents' and can_write_equipment_files(name));

drop policy if exists event_files_read   on storage.objects;
drop policy if exists event_files_insert on storage.objects;
drop policy if exists event_files_update on storage.objects;

create policy event_files_read on storage.objects
  for select to authenticated
  using (bucket_id = 'event-files' and can_read_equipment_files(name));

create policy event_files_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'event-files' and can_write_equipment_files(name));

create policy event_files_update on storage.objects
  for update to authenticated
  using      (bucket_id = 'event-files' and can_write_equipment_files(name))
  with check (bucket_id = 'event-files' and can_write_equipment_files(name));

-- ---------------------------------------------------------------- equipment row

-- A photo must live in its own machine's folder, so a row can never point at
-- another machine's picture. NOT VALID: enforced for every write from now on
-- without failing on rows that already exist.
alter table equipment drop constraint if exists equipment_photo_path_own_folder;
alter table equipment
  add constraint equipment_photo_path_own_folder
  check (photo_path is null or photo_path like id::text || '/%') not valid;

-- Devices pull "everything with updated_at after my last pull". A direct edit
-- such as a new photo did not move updated_at, so other phones never saw it.
create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists equipment_touch_updated_at on equipment;
create trigger equipment_touch_updated_at before update on equipment
for each row execute function touch_updated_at();


-- =====================================================================
-- Part 6 of 9: Replacement outcomes   (was 0008_replacement_outcome.sql)
-- =====================================================================

-- 0008_replacement_outcome.sql — what recording a replacement outcome does.
--
-- Before this, recording "Retired" or "Replaced" closed the alert but left
-- the machine looking active, because nothing set equipment.retired_at.
-- And the outcome policy (with check (true)) let a client rewrite any column
-- of a service report, not just the outcome. Both are fixed here.

-- Only the outcome fields may change after a report is saved. Everything the
-- engineer wrote stays exactly as entered.
create or replace function guard_service_report_update()
returns trigger language plpgsql as $$
begin
  if (new.event_id, new.vendor_company, new.engineer_name, new.contact, new.service_date,
      new.work_done, new.report_path, new.next_due_date, new.recommendation)
     is distinct from
     (old.event_id, old.vendor_company, old.engineer_name, old.contact, old.service_date,
      old.work_done, old.report_path, old.next_due_date, old.recommendation) then
    raise exception 'a service report cannot be edited; only its replacement outcome can be recorded';
  end if;

  if old.outcome is not null then
    raise exception 'the outcome for this report has already been recorded';
  end if;

  if new.outcome = 'kept_in_service' and coalesce(btrim(new.outcome_note), '') = '' then
    raise exception 'keeping a machine in service against a replace recommendation needs a reason';
  end if;

  if new.outcome = 'replaced' and new.replaced_by_equipment_id is null then
    raise exception 'say which machine replaced it';
  end if;

  new.outcome_at := coalesce(new.outcome_at, now());
  return new;
end;
$$;

drop trigger if exists service_reports_guard_update on service_reports;
create trigger service_reports_guard_update
before update on service_reports
for each row execute function guard_service_report_update();

-- Replaced or Retired takes the old machine out of the register's active set.
create or replace function on_service_report_outcome()
returns trigger
language plpgsql security definer set search_path = public as $$
declare v_equipment_id uuid;
begin
  if new.outcome is distinct from old.outcome and new.outcome is not null then
    select equipment_id into v_equipment_id from events where id = new.event_id;

    if new.outcome in ('replaced', 'retired') then
      update equipment set retired_at = coalesce(retired_at, now()) where id = v_equipment_id;
    end if;

    update notifications set closed_at = now()
     where equipment_id = v_equipment_id and tier = 'critical_replacement' and closed_at is null;

    perform recompute_equipment_state(v_equipment_id);

    insert into audit_log (actor_id, action, table_name, row_id, diff)
    values (auth.uid(), 'outcome', 'service_reports', new.event_id::text,
            jsonb_build_object('outcome', new.outcome, 'note', new.outcome_note,
                               'replaced_by', new.replaced_by_equipment_id));
  end if;
  return new;
end;
$$;


-- =====================================================================
-- Part 7 of 9: Server-owned columns, documents, live alerts, shared phones   (was 0009_integrity_documents_realtime.sql)
-- =====================================================================

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


-- =====================================================================
-- Part 8 of 9: Per-person alert settings and the weekly digest   (was 0010_alert_settings_digest.sql)
-- =====================================================================

-- 0010_alert_settings_digest.sql
--
-- Who hears about what, chosen by each person (spec §2, §5):
--
--   * Email and push each take one setting: every alert, critical only, or
--     none. The in-app list is not optional — it is the record, and on a
--     campus LAN with no internet it is the only channel that works.
--   * Technicians and lab HODs default to everything, as before.
--   * Senior leaders default to nothing, and can opt in to critical alerts
--     across all labs ("Critical only (optional)" in the spec's role matrix).
--   * Anyone can opt in to a weekly digest of what is overdue, faulty or
--     awaiting a replacement decision, scoped to what they can see. The dean
--     sees every lab; a HOD sees their own.


-- =========================================================== settings

do $$
begin
  if not exists (select 1 from pg_type where typname = 'alert_channel_level') then
    create type alert_channel_level as enum ('all', 'critical', 'none');
  end if;
end;
$$;

create table if not exists notification_settings (
  profile_id    uuid primary key references profiles(id) on delete cascade,
  email         alert_channel_level not null,
  push          alert_channel_level not null,
  weekly_digest boolean not null default false,
  updated_at    timestamptz not null default now()
);

alter table notification_settings enable row level security;

drop policy if exists notification_settings_own on notification_settings;
create policy notification_settings_own on notification_settings
  for all to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- What applies to a person: their own row, or the default for their role.
create or replace function effective_alert_settings(p_profile uuid)
returns table (email alert_channel_level, push alert_channel_level, weekly_digest boolean)
language sql stable security definer set search_path = public as $$
  select
    coalesce(s.email, case when p.role in ('technician', 'lab_hod') then 'all' else 'none' end::alert_channel_level),
    coalesce(s.push,  case when p.role in ('technician', 'lab_hod') then 'all' else 'none' end::alert_channel_level),
    coalesce(s.weekly_digest, false)
  from profiles p
  left join notification_settings s on s.profile_id = p.id
  where p.id = p_profile;
$$;

-- The app reads its own effective settings, defaults included, in one call.
create or replace function my_alert_settings()
returns table (email alert_channel_level, push alert_channel_level, weekly_digest boolean)
language sql stable security definer set search_path = public as $$
  select * from effective_alert_settings(auth.uid());
$$;

revoke all on function my_alert_settings() from public, anon;
grant execute on function my_alert_settings() to authenticated;

create or replace function channel_allows(p_level alert_channel_level, p_tier alert_tier)
returns boolean
language sql immutable as $$
  select p_level = 'all' or (p_level = 'critical' and p_tier::text like 'critical%');
$$;


-- =========================================================== recipients

-- The machine's lab team, as before, plus senior leaders who opted in —
-- and those only for critical tiers.
create or replace function alert_recipients(p_equipment_id uuid, p_tier alert_tier)
returns table (
  profile_id  uuid,
  email       text,
  full_name   text,
  email_level alert_channel_level,
  push_level  alert_channel_level,
  reason      text
)
language sql stable security definer set search_path = public as $$
  select r.profile_id, r.email, r.full_name, s.email, s.push, 'lab'
  from lab_recipients(p_equipment_id) r
  cross join lateral effective_alert_settings(r.profile_id) s

  union all

  select p.id, u.email, p.full_name, s.email, s.push, 'leader'
  from profiles p
  join auth.users u on u.id = p.id
  cross join lateral effective_alert_settings(p.id) s
  where p.role = 'senior_leader'
    and p.is_active
    and p_tier::text like 'critical%'
    and (s.email <> 'none' or s.push <> 'none');
$$;

-- Same contract as 0003: the dedupe key gates all three channels. What
-- changes is who is asked, and that each channel now checks its setting.
create or replace function queue_alert(
  p_equipment_id uuid,
  p_tier         alert_tier,
  p_title        text,
  p_body         text,
  p_dedupe_key   text,
  p_template     text,
  p_payload      jsonb
) returns void
language plpgsql security definer set search_path = public as $$
declare
  r          record;
  v_inserted uuid;
begin
  for r in select * from alert_recipients(p_equipment_id, p_tier) loop
    v_inserted := null;

    insert into notifications (profile_id, equipment_id, tier, title, body, dedupe_key)
    values (r.profile_id, p_equipment_id, p_tier, p_title, p_body, p_dedupe_key)
    on conflict (profile_id, dedupe_key) do nothing
    returning id into v_inserted;

    continue when v_inserted is null;

    if channel_allows(r.push_level, p_tier) then
      insert into push_outbox (profile_id, payload)
      values (r.profile_id, jsonb_build_object('title', p_title, 'body', p_body,
                                               'tier', p_tier, 'equipment_id', p_equipment_id));
    end if;

    if p_template is not null and channel_allows(r.email_level, p_tier) then
      insert into email_outbox (recipient, template, payload)
      values (r.email, p_template,
              p_payload || jsonb_build_object('to_name', r.full_name, 'title', p_title,
                                              'body', p_body, 'reason', r.reason));
    end if;
  end loop;
end;
$$;


-- =========================================================== weekly digest

create table if not exists digest_log (
  profile_id uuid not null references profiles(id) on delete cascade,
  week       text not null,
  sent_at    timestamptz not null default now(),
  primary key (profile_id, week)
);
alter table digest_log enable row level security;
-- No policies: written only by queue_weekly_digest().

create or replace function queue_weekly_digest()
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_tz      text;
  v_week    text;
  v_queued  int := 0;
  v_claimed int;
  r         record;
  v_counts  jsonb;
  v_items   jsonb;
  v_total   int;
begin
  select timezone into v_tz from institution limit 1;
  v_week := to_char(now() at time zone coalesce(v_tz, 'Africa/Lagos'), 'IYYY-"W"IW');

  for r in
    select p.id, p.role, p.full_name, u.email
    from profiles p
    join auth.users u on u.id = p.id
    cross join lateral effective_alert_settings(p.id) s
    where p.is_active and s.weekly_digest
  loop
    -- Once per person per week, however many times the job runs.
    insert into digest_log (profile_id, week) values (r.id, v_week) on conflict do nothing;
    get diagnostics v_claimed = row_count;
    continue when v_claimed = 0;

    -- Leaders and admins see every lab; everyone else, their own.
    with visible as (
      select e.*, l.name as lab_name
      from equipment e
      join labs l on l.id = e.lab_id
      where e.retired_at is null
        and e.status in ('overdue', 'faulty', 'replace')
        and (r.role in ('senior_leader', 'admin')
             or exists (select 1 from lab_members lm where lm.lab_id = e.lab_id and lm.profile_id = r.id))
    )
    select
      jsonb_build_object(
        'overdue', count(*) filter (where status = 'overdue'),
        'faulty',  count(*) filter (where status = 'faulty'),
        'replace', count(*) filter (where status = 'replace')
      ),
      count(*),
      coalesce((
        select jsonb_agg(item order by rank, due nulls last, asset_id)
        from (
          select jsonb_build_object('asset_id', v.asset_id, 'name', v.name, 'lab', v.lab_name,
                                    'status', v.status, 'due', v.next_service_due) as item,
                 case v.status when 'faulty' then 1 when 'replace' then 2 else 3 end as rank,
                 v.next_service_due as due,
                 v.asset_id
          from visible v
          order by rank, due nulls last, v.asset_id
          limit 25
        ) top
      ), '[]'::jsonb)
    into v_counts, v_total, v_items
    from visible;

    -- Sent even when nothing is outstanding: "all clear" is worth knowing,
    -- and a digest that silently stops looks the same as a broken one.
    insert into email_outbox (recipient, template, payload)
    values (r.email, 'weekly_digest', jsonb_build_object(
      'to_name',   r.full_name,
      'week',      v_week,
      'scope',     case when r.role in ('senior_leader', 'admin') then 'all' else 'own' end,
      'counts',    v_counts,
      'total',     v_total,
      'items',     v_items,
      'truncated', v_total > 25
    ));
    v_queued := v_queued + 1;
  end loop;

  return v_queued;
end;
$$;

-- Monday 07:00 Africa/Lagos is 06:00 UTC. pg_cron speaks UTC.
select cron.schedule('evidencetag-weekly-digest', '0 6 * * 1', $$select queue_weekly_digest();$$);


-- =====================================================================
-- Part 9 of 9: The public address printed into QR labels   (was 0012_public_address.sql)
-- =====================================================================

-- 0012_public_address.sql
--
-- The public web address printed into every QR label, stored as institution
-- data instead of a build setting.
--
-- It used to come only from VITE_PUBLIC_BASE_URL, which is baked in when the
-- app is built or the dev server starts. A label drawn on a laptop running
-- `npm run dev`, or on a deployment built without the setting, silently
-- pointed at localhost. Labels are printed once and stuck on machines, so
-- the address must not depend on which computer or build drew them. Now the
-- admin sets it once, every device uses it, and changing it (say, to a
-- custom domain) needs no rebuild.

alter table institution add column if not exists public_base_url text;

-- https only, a bare origin (no path, no trailing slash), lower case, and
-- never an address that only works on one computer or one network.
alter table institution drop constraint if exists institution_public_base_url_shape;
alter table institution add constraint institution_public_base_url_shape check (
  public_base_url is null or (
    public_base_url ~ '^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
    and public_base_url !~ '^https://(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)'
  )
);

-- The admin sets it, and that is the only column of this row anyone may
-- change from the app. Branding and codes stay where migrations put them.
revoke update on institution from authenticated, anon;
grant update (public_base_url) on institution to authenticated;

drop policy if exists institution_admin_address on institution;
create policy institution_admin_address on institution
  for update to authenticated
  using (auth_is(array['admin']::app_role[]))
  with check (auth_is(array['admin']::app_role[]));

-- =====================================================================
-- Labs the admin adds and edits (Admin -> Labs).
--
-- A lab's code is part of every asset ID in it (TRACKLAB-CHEM1-0001), and
-- its public token is printed on its entrance card. So a code must be short
-- enough for a label, and neither may change once printed or in use. The
-- admin can still rename a lab, move it, or deactivate it.
-- =====================================================================

alter table labs drop constraint if exists labs_code_shape;
alter table labs add constraint labs_code_shape check (code ~ '^[A-Z0-9]{2,10}$');

create or replace function labs_guard_printed() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.public_token is distinct from old.public_token then
    raise exception 'A lab''s entrance-card code is printed and cannot change.' using errcode = 'P0001';
  end if;
  if new.code is distinct from old.code and exists (select 1 from equipment where lab_id = old.id) then
    raise exception 'Lab code % is already part of its machines'' asset IDs, so it cannot change.', old.code
      using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists labs_guard_printed on labs;
create trigger labs_guard_printed before update on labs
  for each row execute function labs_guard_printed();

notify pgrst, 'reload schema';
