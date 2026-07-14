-- =====================================================================
-- PointOne POS — schema, tenancy + domain tables
-- Custom schema: point_of_sale
-- =====================================================================

create extension if not exists "pgcrypto";

create schema if not exists point_of_sale;

-- Expose schema to the Data API roles.
grant usage on schema point_of_sale to anon, authenticated, service_role;
alter default privileges for role postgres in schema point_of_sale
  grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema point_of_sale
  grant all on routines to anon, authenticated, service_role;
alter default privileges for role postgres in schema point_of_sale
  grant all on sequences to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
do $$ begin
  create type point_of_sale.user_role as enum ('super_admin', 'admin', 'manager', 'cashier');
exception when duplicate_object then null; end $$;

do $$ begin
  create type point_of_sale.invitation_status as enum ('pending', 'accepted');
exception when duplicate_object then null; end $$;

do $$ begin
  create type point_of_sale.movement_type as enum ('SALE', 'RESTOCK', 'ADJUSTMENT', 'RETURN');
exception when duplicate_object then null; end $$;

do $$ begin
  create type point_of_sale.return_type as enum ('VOID', 'RETURN');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Tenancy + auth
-- ---------------------------------------------------------------------
create table if not exists point_of_sale.companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text unique not null,
  address     text,
  phone       text,
  logo_url    text,
  currency    text not null default 'PHP',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists point_of_sale.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  company_id  uuid references point_of_sale.companies(id) on delete set null,
  full_name   text,
  email       text not null,
  role        point_of_sale.user_role not null default 'cashier',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists idx_profiles_company on point_of_sale.profiles(company_id);

create table if not exists point_of_sale.invitations (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references point_of_sale.companies(id) on delete cascade,
  email       text not null,
  role        point_of_sale.user_role not null default 'cashier',
  invited_by  uuid references auth.users(id) on delete set null,
  status      point_of_sale.invitation_status not null default 'pending',
  created_at  timestamptz not null default now()
);
create unique index if not exists idx_invitations_pending_email
  on point_of_sale.invitations(lower(email)) where status = 'pending';

-- ---------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------
create table if not exists point_of_sale.products (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references point_of_sale.companies(id) on delete cascade,
  name         text not null,
  description  text,
  sku          text not null,
  barcode      text,
  base_price   numeric(12,2) not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (company_id, sku)
);
create index if not exists idx_products_company on point_of_sale.products(company_id);
create index if not exists idx_products_barcode on point_of_sale.products(company_id, barcode);

create table if not exists point_of_sale.product_units (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references point_of_sale.companies(id) on delete cascade,
  product_id         uuid not null references point_of_sale.products(id) on delete cascade,
  unit_name          text not null,
  conversion_factor  numeric(12,4) not null default 1,
  price              numeric(12,2) not null default 0,
  unique (product_id, unit_name)
);
create index if not exists idx_product_units_product on point_of_sale.product_units(product_id);

create table if not exists point_of_sale.inventory (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references point_of_sale.companies(id) on delete cascade,
  product_id  uuid not null unique references point_of_sale.products(id) on delete cascade,
  quantity    numeric(14,4) not null default 0,
  low_stock   numeric(14,4) not null default 10,
  updated_at  timestamptz not null default now()
);
create index if not exists idx_inventory_company on point_of_sale.inventory(company_id);

create table if not exists point_of_sale.stock_batches (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references point_of_sale.companies(id) on delete cascade,
  product_id   uuid not null references point_of_sale.products(id) on delete cascade,
  quantity     numeric(14,4) not null,       -- remaining (base units)
  initial_qty  numeric(14,4) not null,
  cost_price   numeric(12,2) not null default 0,
  reference    text,
  received_at  timestamptz not null default now(),
  user_name    text
);
create index if not exists idx_batches_fifo on point_of_sale.stock_batches(product_id, received_at);

create table if not exists point_of_sale.customers (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references point_of_sale.companies(id) on delete cascade,
  name        text not null,
  phone       text,
  email       text,
  address     text,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Sales
-- ---------------------------------------------------------------------
create table if not exists point_of_sale.sales (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references point_of_sale.companies(id) on delete cascade,
  receipt_number text not null,
  customer_id    uuid references point_of_sale.customers(id) on delete set null,
  subtotal       numeric(12,2) not null default 0,
  discount       numeric(12,2) not null default 0,
  total          numeric(12,2) not null default 0,
  payment_method text not null default 'cash',
  amount_paid    numeric(12,2) not null default 0,
  change         numeric(12,2) not null default 0,
  cashier_id     uuid references auth.users(id) on delete set null,
  cashier_name   text,
  terminal_id    text,
  is_voided      boolean not null default false,
  created_at     timestamptz not null default now(),
  unique (company_id, receipt_number)
);
create index if not exists idx_sales_company_date on point_of_sale.sales(company_id, created_at);

create table if not exists point_of_sale.sale_items (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references point_of_sale.companies(id) on delete cascade,
  sale_id       uuid not null references point_of_sale.sales(id) on delete cascade,
  product_id    uuid references point_of_sale.products(id) on delete set null,
  product_name  text not null,
  unit_name     text not null,
  quantity      numeric(14,4) not null,
  price         numeric(12,2) not null,
  cost_price    numeric(12,2) not null default 0,
  discount      numeric(12,2) not null default 0,
  total         numeric(12,2) not null
);
create index if not exists idx_sale_items_sale on point_of_sale.sale_items(sale_id);
create index if not exists idx_sale_items_product on point_of_sale.sale_items(product_id);

create table if not exists point_of_sale.sale_returns (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references point_of_sale.companies(id) on delete cascade,
  sale_id        uuid not null references point_of_sale.sales(id) on delete cascade,
  type           point_of_sale.return_type not null,
  reason         text,
  refund_amount  numeric(12,2) not null default 0,
  created_by     uuid references auth.users(id) on delete set null,
  created_by_name text,
  created_at     timestamptz not null default now()
);

create table if not exists point_of_sale.sale_return_items (
  id              uuid primary key default gen_random_uuid(),
  sale_return_id  uuid not null references point_of_sale.sale_returns(id) on delete cascade,
  sale_item_id    uuid not null references point_of_sale.sale_items(id) on delete cascade,
  quantity        numeric(14,4) not null,
  refund          numeric(12,2) not null default 0
);

-- ---------------------------------------------------------------------
-- Movements + audit
-- ---------------------------------------------------------------------
create table if not exists point_of_sale.inventory_movements (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references point_of_sale.companies(id) on delete cascade,
  product_id   uuid not null references point_of_sale.products(id) on delete cascade,
  type         point_of_sale.movement_type not null,
  quantity     numeric(14,4) not null,
  previous_qty numeric(14,4) not null,
  new_qty      numeric(14,4) not null,
  reason       text,
  reference_id text,
  user_name    text,
  created_at   timestamptz not null default now()
);
create index if not exists idx_movements_product on point_of_sale.inventory_movements(product_id, created_at);
create index if not exists idx_movements_company on point_of_sale.inventory_movements(company_id, created_at);

create table if not exists point_of_sale.audit_logs (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid references point_of_sale.companies(id) on delete cascade,
  user_id      uuid references auth.users(id) on delete set null,
  user_name    text,
  action       text not null,
  entity_type  text,
  entity_id    text,
  details      jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists idx_audit_company_date on point_of_sale.audit_logs(company_id, created_at);
