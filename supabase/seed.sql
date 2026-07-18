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
