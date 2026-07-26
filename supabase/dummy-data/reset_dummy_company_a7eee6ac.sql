-- =====================================================================
-- DUMMY DATA RESET — removes everything seeded by
--   seed_dummy_company_a7eee6ac.sql
--
-- Target company: a7eee6ac-766a-48bb-ae70-b7be046750bb
-- Schema:         point_of_sale
--
-- SAFETY
--   * Deletes ONLY rows whose id begins with 'd5eed000-'. Real products,
--     inventory and sales for this company are never matched, so genuine
--     data is left untouched.
--   * The company_id filter is a second guard: even the prefix match is
--     scoped to this one tenant.
--   * Idempotent — safe to run repeatedly.
--
-- Run:  psql "$DATABASE_URL" -f reset_dummy_company_a7eee6ac.sql
-- =====================================================================

set search_path = point_of_sale;

do $$
declare
  v_company constant uuid := 'a7eee6ac-766a-48bb-ae70-b7be046750bb';
  v_prefix  constant text := 'd5eed000-%';
  v_deleted int;
begin
  -- Children first, then parents. Most would cascade from products/sales,
  -- but deleting explicitly keeps this order-independent and auditable.

  delete from point_of_sale.inventory_movements
    where company_id = v_company and id::text like v_prefix;
  get diagnostics v_deleted = row_count;
  raise notice 'inventory_movements: % rows', v_deleted;

  delete from point_of_sale.sale_items
    where company_id = v_company and id::text like v_prefix;
  get diagnostics v_deleted = row_count;
  raise notice 'sale_items: % rows', v_deleted;

  delete from point_of_sale.sales
    where company_id = v_company and id::text like v_prefix;
  get diagnostics v_deleted = row_count;
  raise notice 'sales: % rows', v_deleted;

  delete from point_of_sale.stock_batches
    where company_id = v_company and id::text like v_prefix;
  get diagnostics v_deleted = row_count;
  raise notice 'stock_batches: % rows', v_deleted;

  delete from point_of_sale.inventory
    where company_id = v_company and id::text like v_prefix;
  get diagnostics v_deleted = row_count;
  raise notice 'inventory: % rows', v_deleted;

  delete from point_of_sale.product_units
    where company_id = v_company and id::text like v_prefix;
  get diagnostics v_deleted = row_count;
  raise notice 'product_units: % rows', v_deleted;

  delete from point_of_sale.products
    where company_id = v_company and id::text like v_prefix;
  get diagnostics v_deleted = row_count;
  raise notice 'products: % rows', v_deleted;

  delete from point_of_sale.customers
    where company_id = v_company and id::text like v_prefix;
  get diagnostics v_deleted = row_count;
  raise notice 'customers: % rows', v_deleted;

  raise notice 'Dummy data cleared for company %', v_company;
end $$;
