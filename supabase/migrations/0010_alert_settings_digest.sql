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
