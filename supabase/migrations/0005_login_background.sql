-- =====================================================================
-- PointOne POS — per-company login screen background image
-- Adds companies.login_bg_url, an admin update policy, an anon-readable
-- branding RPC (for /login/<slug>), and a public storage bucket.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Column
-- ---------------------------------------------------------------------
alter table point_of_sale.companies
  add column if not exists login_bg_url text;

-- ---------------------------------------------------------------------
-- RLS: let a company admin update their own company row (super admin
-- already has companies_super_all). Mirrors profiles_admin_write.
-- ---------------------------------------------------------------------
drop policy if exists companies_admin_update on point_of_sale.companies;
create policy companies_admin_update on point_of_sale.companies
  for update
  using (id = point_of_sale.current_company_id() and point_of_sale.current_role() = 'admin')
  with check (id = point_of_sale.current_company_id() and point_of_sale.current_role() = 'admin');

-- ---------------------------------------------------------------------
-- Anonymous branding lookup for the public /login/<slug> page.
-- SECURITY DEFINER so it bypasses RLS but only ever exposes the two
-- branding columns of an active company.
-- ---------------------------------------------------------------------
create or replace function point_of_sale.login_branding(p_slug text)
returns table (name text, login_bg_url text)
language sql stable security definer set search_path = point_of_sale as $$
  select name, login_bg_url
  from point_of_sale.companies
  where slug = p_slug and is_active = true;
$$;

grant execute on function point_of_sale.login_branding(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Storage: public bucket for company assets (login backgrounds, logos).
-- Objects are keyed as "<company_id>/login-bg".
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('pos-company-assets', 'pos-company-assets', true)
on conflict (id) do update set public = true;

-- Anyone (incl. the anonymous login page) can read.
drop policy if exists company_assets_public_read on storage.objects;
create policy company_assets_public_read on storage.objects
  for select using (bucket_id = 'pos-company-assets');

-- Super admin can write anywhere; a company admin only within their own
-- "<company_id>/" folder.
drop policy if exists company_assets_admin_insert on storage.objects;
create policy company_assets_admin_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'pos-company-assets' and (
      point_of_sale.is_super_admin()
      or (storage.foldername(name))[1] = point_of_sale.current_company_id()::text
    )
  );

drop policy if exists company_assets_admin_update on storage.objects;
create policy company_assets_admin_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'pos-company-assets' and (
      point_of_sale.is_super_admin()
      or (storage.foldername(name))[1] = point_of_sale.current_company_id()::text
    )
  )
  with check (
    bucket_id = 'pos-company-assets' and (
      point_of_sale.is_super_admin()
      or (storage.foldername(name))[1] = point_of_sale.current_company_id()::text
    )
  );

drop policy if exists company_assets_admin_delete on storage.objects;
create policy company_assets_admin_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'pos-company-assets' and (
      point_of_sale.is_super_admin()
      or (storage.foldername(name))[1] = point_of_sale.current_company_id()::text
    )
  );
