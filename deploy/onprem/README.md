# On-premise deployment

Run EvidenceTag on a server on campus, so that scanning a label, signing in,
recording events and in-app alerts all keep working **when the internet is
down**. The same server is published to the internet through Cloudflare
Tunnel, with one hostname for both, so a printed QR code works everywhere.

Use this when first-time scans must survive an outage. Until then, Supabase
Cloud (HANDOVER §7) is simpler. The application code is identical either way.

## How it fits together

```
phone ─┬─ campus Wi-Fi ── campus DNS ─────────────┐
       └─ internet ────── Cloudflare ─ tunnel ────┤
                                                  ▼
                                   Caddy :443 (one hostname, one certificate)
                                    ├─ /auth /rest /realtime /storage /functions → Supabase (api-gw)
                                    └─ everything else → the built app (dist/)
```

- **Supabase** is the official self-hosted stack, fetched by `setup.sh` at a
  pinned commit. It is not forked or edited; EvidenceTag adds a thin layer
  on top (`evidencetag.compose.yml`).
- **Caddy** serves the app and the API on one hostname. Its certificate comes
  from Let's Encrypt by **DNS challenge**, so it is issued even though Let's
  Encrypt can never reach a server on a campus LAN, and the same certificate
  is valid whether a phone arrives over Wi-Fi or the internet.
- **Only Caddy faces the network.** Postgres is not published at all. The
  Supabase gateway and Studio listen on the server's loopback only.
- **Cloudflare Tunnel** gives internet access with no open port and no static
  IP. It is optional; without it the system is LAN-only.

Verified before release: `docker compose config` merges this layer over the
pinned stack as described above; real Caddy validates the Caddyfile and its
routing; every script passes ShellCheck; `setup.sh` was run end to end against
the pinned commit and is idempotent. **Not verified here:** an actual
`up -d` on a server — no Docker daemon was available. Do the first install on
a test machine.

## Server

4 CPU cores, 8 GB RAM, 256 GB SSD, Ubuntu 24.04, a UPS, and an external drive
for backups. Install Docker Engine and the Compose plugin **2.24.4 or newer**,
plus `git` and `openssl`.

## Install

```bash
cd deploy/onprem
cp .env.onprem.example .env.onprem      # fill it in: domain, Cloudflare token, mail keys
./setup.sh                              # fetches Supabase, generates every secret
```

`setup.sh` prints the API URL and anon key. Put them in
`deploy/env/.env.tracklab`:

```
VITE_SUPABASE_URL=https://app.tracklab.edu.ng
VITE_SUPABASE_ANON_KEY=<ANON_KEY from deploy/onprem/supabase/.env>
```

Then, from the repository root and back:

```bash
npm ci && npm run build            # Caddy serves ../../dist
cd deploy/onprem
./compose.sh up -d                      # LAN only
./compose.sh --profile public up -d     # or: LAN + Cloudflare Tunnel
./migrate.sh                            # schema, seeds, and the Vault secrets
```

Then point the hostname at the server:

- **Campus DNS** (router or Pi-hole): `app.tracklab.edu.ng → <server LAN IP>`.
- **Cloudflare**: in the tunnel's *Public hostname*, route the domain to
  `https://caddy:443` and set *Origin Server Name* to the domain.

Always use `./compose.sh`, never plain `docker compose`: it combines the two
compose files and sets the project directory the same way every time.

## Accounts

`migrate.sh` applies `0006_seed_users.sql` like every other migration, so
edit that file **before** the first run (see HANDOVER §6). Each migration
runs only once, so editing 0006 later does nothing. To add people afterwards,
call the `seed-users` function with the service key; it refuses any other
caller:

```bash
KEY=$(sed -n 's/^SERVICE_ROLE_KEY=//p' supabase/.env)
curl -X POST https://app.tracklab.edu.ng/functions/v1/seed-users \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d @../../supabase/seed/users.tracklab.json
```

## Studio

Studio, Supabase's admin UI, is deliberately **not** on the public hostname.
Reach it from your own machine through SSH:

```bash
ssh -L 8000:localhost:8000 admin@<server>
# then open http://localhost:8000 — user DASHBOARD_USERNAME,
# password DASHBOARD_PASSWORD, both in deploy/onprem/supabase/.env
```

## Backups

```bash
crontab -e
30 1 * * *  /path/to/deploy/onprem/backup.sh >> /path/to/deploy/onprem/backups/backup.log 2>&1
```

Each night: a `pg_dump` of the database and a tarball of every uploaded file
(photos, SOPs, service reports), each checked readable before it is kept,
retained `BACKUP_KEEP_DAYS` days, and copied to `OFFSITE_RSYNC_TARGET` if set.
Unfinished files are written as `.partial` and never mistaken for a backup.

## Restore drill — do this once a term

A backup that has never been restored is a hope. On a **test** machine:

```bash
./setup.sh && ./compose.sh up -d                     # empty stack, same version
./compose.sh exec -T db pg_restore -h localhost -U postgres -d postgres \
  --clean --if-exists --no-owner < backups/db-<stamp>.dump
tar -C supabase/volumes -xzf backups/storage-<stamp>.tar.gz
./compose.sh restart
```

Then sign in, open a passport, open an SOP, and check the latest event is
there. Expect `pg_restore` to report errors for objects Supabase itself
manages; what matters is that `public`, `auth.users` and `storage.objects` are
restored and the app works. Write down how long it took — that is your
recovery time.

## Upgrading Supabase

Change `SUPABASE_REF` in `setup.sh`, delete `supabase/docker-compose.yml`
(keep `supabase/.env` and `supabase/volumes/`), read Supabase's
`CHANGELOG.md` for the range, re-run `./setup.sh`, then `./compose.sh up -d`.
Back up first.

## Limits to accept

- Email and push need internet. On a LAN-only day they wait in the outbox and
  go out when the connection returns; in-app alerts carry on throughout.
- The certificate renews by DNS challenge, which needs internet roughly once
  every two months. A long outage across a renewal date will eventually
  expire it; Caddy retries as soon as the connection is back.
- iOS push requires the app installed to the home screen.
