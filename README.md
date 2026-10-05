# TrackLAB

A digital passport for every piece of laboratory equipment. Scan the QR label
on a machine and read what it is, whether it is safe to use and when it was
last serviced. Only the lab technician and the lab HOD can change that record.
Senior leaders see every lab at once.

Built on the EvidenceTag platform: one React PWA plus Supabase. No separate backend server: all server logic
lives in PostgreSQL (RLS, triggers, pg_cron) and Edge Functions in this repo.

**Taking over this project? Read [`docs/HANDOVER.md`](docs/HANDOVER.md)** — status
against the specification, architecture, operations, and what is left.


---

## Quick start (Windows PowerShell or any shell)

Needs Node 20+, Docker Desktop running, and the Supabase CLI (installed as a
dev dependency, so `npx supabase` works without a global install).

```bash
npm ci
cp deploy/env/.env.tracklab.example deploy/env/.env.tracklab   # then fill it in
npx supabase start                                     # prints the URL and keys
npx supabase db reset                                  # migrations 0001–0010
npm run dev                                            # http://localhost:5173
```

For local development, `deploy/env/.env.tracklab` needs:

```
VITE_SUPABASE_URL=http://127.0.0.1:55321
VITE_SUPABASE_ANON_KEY=sb_publishable_...      # "Publishable" key from supabase start
```

Sign in with an account from `supabase/migrations/0006_seed_users.sql`.

## Scripts

| | |
| --- | --- |
| `npm run dev` | dev server |
| `npm run build` | typecheck and production build into `dist/` |
| `npm run preview` | serve the last build |
| `npm run check` | typecheck + lint + tests, including migrations run against real Postgres (before every push) |
| `npm run test:e2e` | 22 browser scenarios on phone and desktop (before every release; `npx playwright install chromium` once) |
| `npm run db:reset` / `db:push` | rebuild the local database / push migrations to the linked project |
| `npm run gen:types` | regenerate `src/lib/database.types.ts` from the local database |

## Three rules the codebase is built around

1. **The client never computes status.** `equipment.status` and
   `next_service_due` are written only by `recompute_equipment_state()` after
   every event lands. There is no status picker, and a lint rule rejects
   assignment to `.status`.
2. **The history is append-only.** `events` has no update or delete policy and
   a trigger raises on both. Corrections are new rows.
3. **The QR token is permanent.** Generated once at registration; the database
   rejects any change. Labels are printed once and every later update is read
   through the same code.

## Layout

```
src/
  app/        shell (header + mobile menu), router, auth and network context, guards
  features/   one folder per module; each owns its queries and screens
  ui/         design-system components, including the live camera; imports only lib
  offline/    Dexie schema, outbox, sync, network probe
  lib/        supabase client, institution config, status map, dates
  styles/     tokens.css (the only place colours live), app.css
  sw.ts       service worker: precache, runtime caches, push handler
supabase/
  migrations/ 0001 schema · 0002 RLS · 0003 triggers · 0004 cron jobs
              0005 institution + labs · 0006 accounts · 0007 storage · 0008 outcomes
              0009 server-column guard, documents, realtime, shared-phone push
              0010 per-person alert settings, leader alerts, weekly digest
  functions/  dispatch-outbox, seed-users, shared email templates
deploy/env/   the settings template (the real file is gitignored)
docs/         HANDOVER.md
```
