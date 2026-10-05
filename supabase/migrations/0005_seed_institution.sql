-- =====================================================================
-- 0005_seed_institution.sql — the deployment's own row, and its labs.
--
-- EDIT THIS FILE before the first run. It must come before 0006, because
-- users are attached to labs by the `code` column below.
--
-- Branding here is what the database knows. The frontend reads its two
-- colours and its logo from deploy/env/.env.<mode> at build time; keep
-- the two in step.
-- =====================================================================

insert into institution (
  code, name, product_name, logo_url,
  brand_primary, brand_accent, email_from, timezone,
  threshold_upcoming, threshold_warning, critical_repeat_days
) values (
  'TRACKLAB',
  'Federal University ___',
  'TrackLAB',
  '/brand/tracklab-lockup.png',
  '#0b4a28',
  '#e8b93f',
  'alerts@tracklab.edu.ng',
  'Africa/Lagos',
  30,   -- Upcoming: alert this many days ahead
  7,    -- Warning: alert this many days ahead
  3     -- Critical: repeat every this many days until serviced
)
on conflict (code) do nothing;


-- One row per laboratory. `code` is what appears in an asset ID
-- (TRACKLAB-CHEM2-0042) and what 0006 uses to place people, so keep it short
-- and do not change it after labels are printed.
--
-- public_token is generated automatically and is permanent: it is the QR
-- code printed on the card at the lab entrance.

insert into labs (name, code, building, room) values
  ('Chemistry Lab 1',      'CHEM1', 'Science Block A', 'G12'),
  ('Chemistry Lab 2',      'CHEM2', 'Science Block A', 'G14'),
  ('Physics Lab 1',        'PHY1',  'Science Block B', '101'),
  ('Biology Lab 1',        'BIO1',  'Science Block B', '205'),
  ('Microbiology Lab',     'MICRO', 'Science Block C', 'G03'),
  ('Engineering Workshop', 'ENG',   'Engineering',     'W1')
on conflict (code) do nothing;


-- The entrance-card addresses, once this has run:
--   select name, code, '/l/' || public_token as entrance_url from labs order by code;
