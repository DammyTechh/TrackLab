# Setting up the database

Everything is in two files, run once, in order, in the Supabase **SQL Editor**:

| File | What it is | Edit first? |
| --- | --- | --- |
| `supabase/migrations/0001_schema.sql` | The whole structure: tables, security rules, status logic, alerts, scheduled jobs, file storage | No |
| `supabase/migrations/0002_seed_institution_and_users.sql` | This institution, its labs, its accounts, and the public address printed into QR labels | **Yes** |

Then `supabase/manual/connect_functions.sql` lets the database call the edge
functions that send emails and push notifications.

## 0. Your laptop, or the live site?

There can be two databases, and they do not share anything:

- **The live one**, in your Supabase project, which the website uses.
- **A local one** on your laptop, which `npx supabase start` creates and
  `npx supabase db reset` wipes. It only affects your laptop.

Which one the app on your laptop uses is set by `VITE_SUPABASE_URL` in
`deploy/env/.env.tracklab`. `http://127.0.0.1:54321` is the local one;
`https://<project-ref>.supabase.co` is the live one. A machine registered
while it points at the local one exists only on your laptop: its label,
scanned on the live site, is reported as not matching any equipment. For
real work, point it at the live project.

## 1. Starting again on a project that already has data

`supabase/manual/reset_database.sql` **erases** the app's database: every
machine, event, document record, lab and account. Download a backup first
if anything matters (Database → Backups). It refuses to run until you edit
its confirmation line to read `confirm text := 'ERASE EVERYTHING';`.

It keeps Supabase's own setup, the extensions, your Vault secrets (so the
functions stay connected), and files already uploaded to Storage (Supabase
only lets the Storage API delete those; empty the buckets in Storage if you
want them gone). On an empty project, skip this step.

## 2. Run the two files

1. **Edit `0002`.** The institution's name, the public address (the address
   everyone will reach the app on, printed into every QR label), its labs,
   and in the second half every account: email, name, role, labs and a
   temporary password of at least 10 characters. Everyone chooses their own
   password at first sign-in. Lab codes appear in every asset ID, so settle
   them first; more labs can be added later under Admin → Labs.
2. SQL Editor → **New query** → paste all of `0001_schema.sql` → **Run**. It
   should end with *Success*.
3. New query → paste all of your edited `0002` → **Run**.
4. Do not commit real passwords: put the placeholders back in `0002`.

After a rebuild everyone signs in again once, on every device: sign-ins from
before it belong to accounts that no longer exist, and the app clears them.

## 3. Tell the Supabase CLI they ran

The CLI keeps its own list of which migrations ran. After running the files
by hand, record them, so a later `npx supabase db push` does not try to run
them again:

```bash
npx supabase login                       # sign in as the account that owns the project
npx supabase link --project-ref <project-ref>
npx supabase migration repair --status applied 0001 0002
```

(`npx supabase db push` on an empty project does steps 1 and 2 in one go.)

## 4. Connect the edge functions

1. **Keys.** Generate push-notification keys once and keep both:
   `npx web-push generate-vapid-keys`
2. **Function settings.** `APP_BASE_URL` is the *website* address. Email
   links use the public address saved in the app (Admin → Public address)
   once there is one; this is the fallback:
   ```bash
   npx supabase secrets set RESEND_API_KEY=re_... VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... APP_BASE_URL=https://<website>
   npx supabase functions deploy dispatch-outbox
   npx supabase functions deploy seed-users
   ```
3. **Vault.** Open `supabase/manual/connect_functions.sql`, replace the two
   `PASTE-…` values, and run it in the SQL Editor:
   - the **project URL** (Project Settings → API), such as
     `https://abcdefghijkl.supabase.co` — not the website;
   - the **`service_role` key** (Project Settings → API Keys → *Legacy API
     keys* → `service_role`). A secret key (`sb_secret_…`) also works where the
     project offers one.
   It also refreshes the API's view of the database, so new columns are seen.
4. **Website.** Put the VAPID **public** key in the frontend settings as
   `VITE_VAPID_PUBLIC_KEY`, then redeploy. Without it the *Turn on
   notifications* option is hidden.

## 5. Email

- **Alert emails** (sent by `dispatch-outbox` through Resend): in Resend,
  verify the domain you send from (SPF and DKIM records), and make sure the
  institution's sender address in `0002` (`email_from`) is on that domain.
  Until a domain is verified, Resend only delivers to your own Resend account
  address.
- **Supabase's own emails** (password resets), optional: Authentication →
  **Emails** → **SMTP Settings** → enable custom SMTP:
  host `smtp.resend.com`, port `465`, username `resend`, password your Resend
  API key, sender an address on the verified domain.

## 6. Authentication settings

Authentication → **Sign In / Providers**: keep **Email** enabled, turn **off**
*Allow new users to sign up* (accounts come from `0002` or the admin), and
turn off email confirmation.

## 7. Check it works

- Sign in as the admin from `0002`; you are asked to choose a password.
- Admin → **Public address**: the address printed into every QR label.
- Register a machine, take its photo, and open its passport from another
  device.
- SQL Editor: `select status, count(*) from email_outbox group by status;`
  shows `sent` once an alert has gone out (the job runs every five minutes).

## 8. The website on Vercel

The website reads its settings when it is **built**, not while it runs, and
Vercel never sees your laptop's `deploy/env/.env.tracklab`. In Vercel →
your project → **Settings → Environment Variables**, set (Production):

| Name | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` — the **live** project, never `127.0.0.1` or `localhost` |
| `VITE_SUPABASE_ANON_KEY` | the live project's publishable key (Project Settings → API Keys) |
| `VITE_INSTITUTION_CODE`, `VITE_INSTITUTION_NAME`, `VITE_PRODUCT_NAME`, `VITE_BRAND_PRIMARY`, `VITE_BRAND_ACCENT`, `VITE_BRAND_LOGO_URL` | as in `deploy/env/.env.tracklab.example` |

Then **Deployments → ⋯ → Redeploy**, with *Use existing build cache* turned
**off**. A change to these settings does nothing until the next build.

A build pointed at `127.0.0.1` or `localhost` now stops with an explanation,
because such a site works only on the computer running that local database:
everyone else, even on the same Wi-Fi, gets "could not reach the server".
Deploying with the `vercel` command from a laptop no longer uploads the
laptop's own settings files (`.vercelignore`).

## If people cannot sign in

The sign-in page now says why. In the SQL Editor, this lists every account
and whether it can work:

```sql
select u.email, p.role, p.is_active, p.must_change_password,
       u.email_confirmed_at is not null as confirmed,
       exists (select 1 from auth.identities i where i.user_id = u.id) as can_sign_in
from auth.users u left join profiles p on p.id = u.id order by u.email;
```

A row with no role was added in the dashboard alone, without a profile: add
it through `0002` or the `seed-users` function instead.

## If something is reported missing

`PGRST204 … schema cache`, or a save that says the app's connection has not
caught up: the API has not noticed a change made by hand. In the SQL Editor:

```sql
notify pgrst, 'reload schema';
```
