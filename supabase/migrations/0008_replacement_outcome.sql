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
