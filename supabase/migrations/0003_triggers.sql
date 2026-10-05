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
