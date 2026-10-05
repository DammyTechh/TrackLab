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
