-- 0012_public_address.sql
--
-- The public web address printed into every QR label, stored as institution
-- data instead of a build setting.
--
-- It used to come only from VITE_PUBLIC_BASE_URL, which is baked in when the
-- app is built or the dev server starts. A label drawn on a laptop running
-- `npm run dev`, or on a deployment built without the setting, silently
-- pointed at localhost. Labels are printed once and stuck on machines, so
-- the address must not depend on which computer or build drew them. Now the
-- admin sets it once, every device uses it, and changing it (say, to a
-- custom domain) needs no rebuild.

alter table institution add column if not exists public_base_url text;

-- https only, a bare origin (no path, no trailing slash), lower case, and
-- never an address that only works on one computer or one network.
alter table institution drop constraint if exists institution_public_base_url_shape;
alter table institution add constraint institution_public_base_url_shape check (
  public_base_url is null or (
    public_base_url ~ '^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
    and public_base_url !~ '^https://(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)'
  )
);

-- The admin sets it, and that is the only column of this row anyone may
-- change from the app. Branding and codes stay where migrations put them.
revoke update on institution from authenticated, anon;
grant update (public_base_url) on institution to authenticated;

drop policy if exists institution_admin_address on institution;
create policy institution_admin_address on institution
  for update to authenticated
  using (auth_is(array['admin']::app_role[]))
  with check (auth_is(array['admin']::app_role[]));
