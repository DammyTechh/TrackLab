#!/usr/bin/env bash
# Apply supabase/migrations to the on-premise database, in order, once each.
#
# Runs psql inside the db container, so Postgres never has to be reachable
# from the network. Each file is applied in its own transaction and recorded
# in evidencetag_meta.migrations; a failure leaves that file unapplied and
# stops, with nothing half-done.
#
# Then stores the two secrets the outbox cron job reads from Vault.
set -euo pipefail

# Read one value from supabase/.env WITHOUT sourcing it: Supabase's file has
# unquoted values containing spaces, which a shell would try to execute.
env_value() {
  sed -n "s/^$1=//p" "$2" | tail -n 1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
cd "$here"

psql_db() {
  ./compose.sh exec -T db psql -h localhost -U postgres -d postgres \
    -v ON_ERROR_STOP=1 --quiet --no-psqlrc "$@"
}

psql_db -c "create schema if not exists evidencetag_meta;
            create table if not exists evidencetag_meta.migrations (
              file text primary key, applied_at timestamptz not null default now());"

applied=0
for path in "$repo"/supabase/migrations/*.sql; do
  file="$(basename "$path")"
  done_already="$(psql_db -tA -c "select 1 from evidencetag_meta.migrations where file = '$file'")"
  if [ "$done_already" = "1" ]; then
    echo "  already applied  $file"
    continue
  fi
  echo "  applying         $file"
  {
    echo "begin;"
    cat "$path"
    echo
    echo "insert into evidencetag_meta.migrations (file) values ('$file');"
    echo "commit;"
  } | psql_db
  applied=$((applied + 1))
done
echo "$applied migration(s) applied."

# The outbox cron job (0004) posts to the functions gateway. Inside the
# Docker network that is api-gw, which needs no internet at all.
service_key="$(env_value SERVICE_ROLE_KEY supabase/.env)"
[ -n "$service_key" ] || { echo "SERVICE_ROLE_KEY is missing from supabase/.env" >&2; exit 1; }
psql_db -v base="http://api-gw:8000" -v key="$service_key" <<'SQL'
select set_config('evidencetag.base', :'base', false), set_config('evidencetag.key', :'key', false);
do $$
declare
  pair record;
  existing uuid;
begin
  for pair in
    select 'app_base_url' as name, current_setting('evidencetag.base') as value
    union all
    select 'service_role_key', current_setting('evidencetag.key')
  loop
    select id into existing from vault.secrets where name = pair.name;
    if existing is null then
      perform vault.create_secret(pair.value, pair.name);
    else
      perform vault.update_secret(existing, pair.value);
    end if;
  end loop;
end;
$$;
SQL
echo "Vault secrets for the outbox job are set."
