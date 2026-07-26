-- ---------------------------------------------------------------------
-- E2E test seed. Runs after migrations on `supabase db reset`.
-- Creates a deterministic admin login + one product with stock so the
-- Playwright suite (cash / cheque / terms / settle) has known data.
--
-- Login: admin@test.local / password123
-- ---------------------------------------------------------------------

-- Fixed identifiers so tests can rely on them.
--   user    00000000-0000-0000-0000-0000000000a1
--   company 00000000-0000-0000-0000-0000000000b1
--   product 00000000-0000-0000-0000-0000000000c1

-- 1. Auth user (GoTrue). handle_new_user() makes no profile for this
--    uninvited email, so we insert the profile ourselves below.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-0000000000a1',
  'authenticated', 'authenticated', 'admin@test.local',
  crypt('password123', gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Ada Admin"}'::jsonb,
  '', '', '', ''
);

-- Email identity so password sign-in resolves the user.
insert into auth.identities (
  id, user_id, provider_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
) values (
  gen_random_uuid(),
  '00000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-0000000000a1',
  jsonb_build_object('sub','00000000-0000-0000-0000-0000000000a1','email','admin@test.local','email_verified',true),
  'email', now(), now(), now()
);

-- 2. Tenant + admin profile.
insert into point_of_sale.companies (id, name, slug, currency)
values ('00000000-0000-0000-0000-0000000000b1', 'Test Co', 'test-co', 'PHP');

insert into point_of_sale.profiles (id, company_id, full_name, email, role)
values (
  '00000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-0000000000b1',
  'Ada Admin', 'admin@test.local', 'admin'
)
on conflict (id) do update
  set company_id = excluded.company_id, full_name = excluded.full_name, role = excluded.role;

-- Membership for the seeded admin. profiles.company_id above is the ACTIVE
-- company; company_members is the source of truth for what they may access.
-- (The 0011 backfill covers existing production profiles, but migrations run
-- before this seed, so a fresh local database needs this explicitly.)
insert into point_of_sale.company_members (user_id, company_id, role)
values (
  '00000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-0000000000b1',
  'admin'
)
on conflict (user_id, company_id) do nothing;

-- 3. A product with a sellable unit + stock, so search/scan + checkout work.
insert into point_of_sale.products (id, company_id, name, sku, barcode, base_price)
values (
  '00000000-0000-0000-0000-0000000000c1',
  '00000000-0000-0000-0000-0000000000b1',
  'Iced Latte', 'LATTE-01', '4800000000015', 120
);

insert into point_of_sale.product_units (product_id, company_id, unit_name, conversion_factor, price)
values (
  '00000000-0000-0000-0000-0000000000c1',
  '00000000-0000-0000-0000-0000000000b1',
  'piece', 1, 120
);

insert into point_of_sale.inventory (product_id, company_id, quantity)
values (
  '00000000-0000-0000-0000-0000000000c1',
  '00000000-0000-0000-0000-0000000000b1',
  500
);

insert into point_of_sale.stock_batches (product_id, company_id, quantity, initial_qty, cost_price, received_at)
values (
  '00000000-0000-0000-0000-0000000000c1',
  '00000000-0000-0000-0000-0000000000b1',
  500, 500, 70, now()
);

-- ---------------------------------------------------------------------
-- Multi-company fixtures.
--   company b2  Second Co     — admin@test.local is a CASHIER here
--   user    a2  super@test.local  — platform super admin
--   user    a3  solo@test.local   — single company, proves the switcher hides
--
-- Memberships are inserted explicitly: the migration's backfill runs against
-- an empty database (migrations precede this seed), so it never sees these
-- rows. The sync trigger leaves each profile's active company alone because
-- profiles are inserted first, already pointing at their company.
-- ---------------------------------------------------------------------

insert into point_of_sale.companies (id, name, slug, currency)
values ('00000000-0000-0000-0000-0000000000b2', 'Second Co', 'second-co', 'PHP');

-- Extra auth users. Same password as the seeded admin: password123
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-0000000000a2',
   'authenticated', 'authenticated', 'super@test.local',
   crypt('password123', gen_salt('bf')), now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"Sam Super"}'::jsonb, '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-0000000000a3',
   'authenticated', 'authenticated', 'solo@test.local',
   crypt('password123', gen_salt('bf')), now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"Sol Solo"}'::jsonb, '', '', '', '');

insert into auth.identities (
  id, user_id, provider_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
) values
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000a2',
   '00000000-0000-0000-0000-0000000000a2',
   jsonb_build_object('sub','00000000-0000-0000-0000-0000000000a2','email','super@test.local','email_verified',true),
   'email', now(), now(), now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000a3',
   '00000000-0000-0000-0000-0000000000a3',
   jsonb_build_object('sub','00000000-0000-0000-0000-0000000000a3','email','solo@test.local','email_verified',true),
   'email', now(), now(), now());

-- Profiles. The super admin has no company by design.
insert into point_of_sale.profiles (id, company_id, full_name, email, role)
values
  ('00000000-0000-0000-0000-0000000000a2', null,
   'Sam Super', 'super@test.local', 'super_admin'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000b1',
   'Sol Solo', 'solo@test.local', 'cashier')
on conflict (id) do update
  set company_id = excluded.company_id, full_name = excluded.full_name, role = excluded.role;

-- Memberships. Task 1 already added admin@test.local's Admin membership in
-- Test Co; adding Cashier in Second Co is what lets the switcher test prove
-- the role follows the switch.
insert into point_of_sale.company_members (user_id, company_id, role) values
  ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b2','cashier'),
  ('00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000b1','cashier')
on conflict (user_id, company_id) do nothing;

-- A distinctly-named product in Second Co, so a switch visibly changes data.
insert into point_of_sale.products (id, company_id, name, sku, base_price)
values ('00000000-0000-0000-0000-0000000000c2',
        '00000000-0000-0000-0000-0000000000b2', 'Second Scone', 'SCONE-02', 90);

insert into point_of_sale.product_units (product_id, company_id, unit_name, conversion_factor, price)
values ('00000000-0000-0000-0000-0000000000c2',
        '00000000-0000-0000-0000-0000000000b2', 'piece', 1, 90);

insert into point_of_sale.inventory (product_id, company_id, quantity)
values ('00000000-0000-0000-0000-0000000000c2',
        '00000000-0000-0000-0000-0000000000b2', 200);
