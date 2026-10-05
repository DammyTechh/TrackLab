-- 0007_storage.sql — storage buckets, storage policies, and the equipment photo.
--
-- config.toml only creates buckets for `supabase start` on a laptop. The
-- hosted project never reads that file, so before this migration the three
-- buckets did not exist in production and, even where they did, storage.objects
-- had no policy at all — every upload from the app was refused.
--
-- Object paths always start with the equipment id, so one rule covers all
-- three buckets: you may write a file if you may write that machine.
--
--   equipment-photos  {equipment_id}/{uuid}.jpg            profile photo, public
--   documents         {equipment_id}/{uuid}.{pdf|...}      SOPs, manuals, certificates
--   event-files       {equipment_id}/{event_id}/{uuid}.jpg photos / reports on an event
--
-- There is no delete policy on any bucket. A replaced photo stays in storage;
-- the row simply points at the new one. That matches the append-only history.

-- ---------------------------------------------------------------- buckets

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  -- Public: the passport is read by visitors with no account, and the photo
  -- is what tells them they are standing at the right machine. The path holds
  -- a random uuid, and nothing in it is more sensitive than the passport itself.
  ('equipment-photos', 'equipment-photos', true,  5242880,
     array['image/jpeg', 'image/png', 'image/webp']),
  ('documents',        'documents',        false, 20971520,
     array['application/pdf', 'image/jpeg', 'image/png',
           'application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
  ('event-files',      'event-files',      false, 10485760,
     array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------- helpers

-- The first folder of an object path, as an equipment id. Null when it is not
-- a uuid, so a malformed path fails the policy instead of raising a cast error.
create or replace function storage_equipment_id(object_name text) returns uuid
language sql stable as $$
  select case
    when (storage.foldername(object_name))[1]
         ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then ((storage.foldername(object_name))[1])::uuid
  end;
$$;

-- Same rule as equipment_update in 0002: a technician or HOD in that lab.
create or replace function can_write_equipment_files(object_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select auth_writes_equipment() and exists (
    select 1 from equipment e
    where e.id = storage_equipment_id(object_name) and auth_in_lab(e.lab_id)
  );
$$;

-- Same rule as equipment_read in 0002.
create or replace function can_read_equipment_files(object_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from equipment e
    where e.id = storage_equipment_id(object_name)
      and (auth_is(array['senior_leader', 'admin']::app_role[]) or auth_in_lab(e.lab_id))
  );
$$;

-- The passport lists SOPs to anyone; this lets an anonymous visitor open
-- exactly those files and no other document.
create or replace function is_public_sop(object_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from equipment_documents d
    where d.kind = 'sop' and d.file_path = object_name
  );
$$;

grant execute on function storage_equipment_id(text)      to anon, authenticated;
grant execute on function can_write_equipment_files(text) to authenticated;
grant execute on function can_read_equipment_files(text)  to authenticated;
grant execute on function is_public_sop(text)             to anon, authenticated;

-- ---------------------------------------------------------------- policies
-- Upload with upsert (which sync.ts uses so a retry is harmless) needs
-- SELECT and UPDATE as well as INSERT, so writers get all three.

drop policy if exists equipment_photos_read   on storage.objects;
drop policy if exists equipment_photos_insert on storage.objects;
drop policy if exists equipment_photos_update on storage.objects;

create policy equipment_photos_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'equipment-photos');

create policy equipment_photos_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'equipment-photos' and can_write_equipment_files(name));

create policy equipment_photos_update on storage.objects
  for update to authenticated
  using      (bucket_id = 'equipment-photos' and can_write_equipment_files(name))
  with check (bucket_id = 'equipment-photos' and can_write_equipment_files(name));

drop policy if exists documents_read_staff on storage.objects;
drop policy if exists documents_read_sop   on storage.objects;
drop policy if exists documents_insert     on storage.objects;
drop policy if exists documents_update     on storage.objects;

create policy documents_read_staff on storage.objects
  for select to authenticated
  using (bucket_id = 'documents' and can_read_equipment_files(name));

create policy documents_read_sop on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'documents' and is_public_sop(name));

create policy documents_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'documents' and can_write_equipment_files(name));

create policy documents_update on storage.objects
  for update to authenticated
  using      (bucket_id = 'documents' and can_write_equipment_files(name))
  with check (bucket_id = 'documents' and can_write_equipment_files(name));

drop policy if exists event_files_read   on storage.objects;
drop policy if exists event_files_insert on storage.objects;
drop policy if exists event_files_update on storage.objects;

create policy event_files_read on storage.objects
  for select to authenticated
  using (bucket_id = 'event-files' and can_read_equipment_files(name));

create policy event_files_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'event-files' and can_write_equipment_files(name));

create policy event_files_update on storage.objects
  for update to authenticated
  using      (bucket_id = 'event-files' and can_write_equipment_files(name))
  with check (bucket_id = 'event-files' and can_write_equipment_files(name));

-- ---------------------------------------------------------------- equipment row

-- A photo must live in its own machine's folder, so a row can never point at
-- another machine's picture. NOT VALID: enforced for every write from now on
-- without failing on rows that already exist.
alter table equipment drop constraint if exists equipment_photo_path_own_folder;
alter table equipment
  add constraint equipment_photo_path_own_folder
  check (photo_path is null or photo_path like id::text || '/%') not valid;

-- Devices pull "everything with updated_at after my last pull". A direct edit
-- such as a new photo did not move updated_at, so other phones never saw it.
create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists equipment_touch_updated_at on equipment;
create trigger equipment_touch_updated_at before update on equipment
for each row execute function touch_updated_at();
