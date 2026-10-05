#!/usr/bin/env bash
# One-time setup of the on-premise stack, and safe to re-run.
#
#   1. fetches the official Supabase docker stack at a pinned commit
#   2. generates every secret with Supabase's own generator (first run only)
#   3. applies .env.onprem on top, every run, so that file stays the truth
#   4. installs EvidenceTag's edge functions beside Supabase's router
#
# It never overwrites an existing supabase/.env's secrets, and never starts
# anything. Start with ./compose.sh up -d when it finishes.
set -euo pipefail

# Read one value from supabase/.env WITHOUT sourcing it: Supabase's file has
# unquoted values containing spaces, which a shell would try to execute.
env_value() {
  sed -n "s/^$1=//p" "$2" | tail -n 1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}

# Pinned so an upstream change can never alter a running campus server
# unannounced. To upgrade: change this, re-run, read Supabase's CHANGELOG.md.
SUPABASE_REF=1168fd8a2180250c894c16b341577a634437fad5

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
cd "$here"

fail() { echo "setup: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "$1 is required but not installed."; }

need git
need docker
need openssl

compose_version="$(docker compose version --short 2>/dev/null || true)"
[ -n "$compose_version" ] || fail "Docker Compose v2 is required (docker compose, not docker-compose)."
lowest="$(printf '%s\n%s\n' "2.24.4" "${compose_version#v}" | sort -V | head -n1)"
[ "$lowest" = "2.24.4" ] || fail "Docker Compose $compose_version is too old; 2.24.4 or newer is needed for !reset."

[ -f .env.onprem ] || fail "Copy .env.onprem.example to .env.onprem and fill it in first."
set -a
# shellcheck disable=SC1091
. ./.env.onprem
set +a

for key in DOMAIN ACME_EMAIL CLOUDFLARE_API_TOKEN; do
  [ -n "${!key:-}" ] || fail "$key is empty in .env.onprem."
done

# ---------------------------------------------------------------- 1. stack
if [ ! -f supabase/docker-compose.yml ]; then
  echo "Fetching Supabase docker stack at ${SUPABASE_REF:0:12}…"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  git clone --quiet --filter=blob:none --no-checkout https://github.com/supabase/supabase "$tmp/src"
  git -C "$tmp/src" sparse-checkout set docker
  git -C "$tmp/src" checkout --quiet "$SUPABASE_REF"
  mv "$tmp/src/docker" supabase
fi

# ---------------------------------------------------------------- 2. secrets
if [ ! -f supabase/.env ]; then
  echo "Generating secrets…"
  cp supabase/.env.example supabase/.env
  (cd supabase && sh utils/generate-keys.sh --update-env >/dev/null)
fi
chmod 600 supabase/.env

# ---------------------------------------------------------------- 3. settings
# Replace KEY=… in supabase/.env, or append it. Values are escaped for sed.
set_env() {
  local key="$1" value="$2" escaped
  escaped="$(printf '%s' "$value" | sed -e 's/[\\&|]/\\&/g')"
  if grep -q "^${key}=" supabase/.env; then
    sed -i "s|^${key}=.*|${key}=${escaped}|" supabase/.env
  else
    printf '%s=%s\n' "$key" "$value" >> supabase/.env
  fi
}

set_env SUPABASE_PUBLIC_URL "https://${DOMAIN}"
set_env API_EXTERNAL_URL "https://${DOMAIN}/auth/v1"
set_env SITE_URL "https://${DOMAIN}"
set_env ADDITIONAL_REDIRECT_URLS "https://${DOMAIN}/**"

# There is no sign-up in this product. Supabase's defaults allow it.
set_env DISABLE_SIGNUP "true"
# Keep the email provider ON: it is what email-and-password sign-in uses.
# DISABLE_SIGNUP above is what stops new accounts.
set_env ENABLE_EMAIL_SIGNUP "true"
set_env ENABLE_EMAIL_AUTOCONFIRM "false"
set_env ENABLE_PHONE_SIGNUP "false"
set_env ENABLE_ANONYMOUS_USERS "false"
# Our privileged functions check for the service key themselves
# (supabase/functions/_shared/caller.ts); see the security note in HANDOVER.
set_env FUNCTIONS_VERIFY_JWT "false"

for key in DOMAIN ACME_EMAIL CLOUDFLARE_API_TOKEN CLOUDFLARE_TUNNEL_TOKEN \
           RESEND_API_KEY VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY; do
  set_env "$key" "${!key:-}"
done

# ---------------------------------------------------------------- 4. functions
functions="supabase/volumes/functions"
for fn in _shared dispatch-outbox seed-users; do
  rm -rf "${functions:?}/$fn"
  cp -R "$repo/supabase/functions/$fn" "$functions/$fn"
done
# Supabase's sample function would otherwise be publicly callable.
rm -rf "$functions/hello"

# ---------------------------------------------------------------- done
anon="$(env_value ANON_KEY supabase/.env)"
cat <<NEXT

Setup complete.

  1. Build the app for this server (in the repository root):
       VITE_SUPABASE_URL=https://${DOMAIN}
       VITE_SUPABASE_ANON_KEY=${anon:0:24}…   (full value: grep ^ANON_KEY= deploy/onprem/supabase/.env)
     go into deploy/env/.env.tracklab, then:  npm run build

  2. Start it:            ./compose.sh up -d
     With public access:  ./compose.sh --profile public up -d

  3. Apply the database:  ./migrate.sh

  4. Campus DNS: point ${DOMAIN} at this server's LAN IP.

  5. Nightly backups:     crontab -e
       30 1 * * *  $here/backup.sh >> $here/backups/backup.log 2>&1

NEXT
