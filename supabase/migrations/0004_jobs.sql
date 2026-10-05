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
