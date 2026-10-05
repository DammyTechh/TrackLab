#!/usr/bin/env bash
# docker compose, with the official Supabase stack and EvidenceTag's layer
# combined the same way every time. Use this instead of `docker compose`.
#
#   ./compose.sh up -d                    LAN only
#   ./compose.sh --profile public up -d   LAN plus Cloudflare Tunnel
#   ./compose.sh ps | logs -f caddy | down
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"

if [ ! -f "$here/supabase/docker-compose.yml" ]; then
  echo "The Supabase stack is not set up yet. Run ./setup.sh first." >&2
  exit 1
fi

exec docker compose \
  --project-directory "$here/supabase" \
  --env-file "$here/supabase/.env" \
  -f "$here/supabase/docker-compose.yml" \
  -f "$here/evidencetag.compose.yml" \
  "$@"
