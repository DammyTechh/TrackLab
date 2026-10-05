-- 0011_rename_tracklab.sql
--
-- Makes sure the institution row carries the TrackLAB name and artwork.
-- 0005 seeds both directly, so on a fresh database this changes nothing.
-- It is kept because some databases applied it during the rename, and a
-- migration that has been applied must stay in the folder: removing it would
-- make `supabase db push` refuse to run.
--
-- The name matters in the database as well as in the app: it is the sender
-- name on every alert email ("TrackLAB <alerts@…>").

update institution
   set product_name = 'TrackLAB',
       logo_url     = '/brand/tracklab-lockup.png'
 where code = 'TRACKLAB';
