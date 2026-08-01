-- =====================================================================
-- FULL RESET — sales, products and inventory
--
-- Wipes every product, inventory and sales record so the app starts from
-- a clean slate, while leaving the tenant and identity data intact.
--
-- DELETED
--   products, product_units, inventory, stock_batches,
--   inventory_movements, sales, sale_items, sale_returns,
--   sale_return_items
--
-- KEPT
--   companies, profiles, company_members, invitations, customers,
--   audit_logs, auth.users
--   (see the two optional blocks at the bottom for customers/audit_logs)
--
-- SCOPE
--   v_company = null  -> every company (default)
--   v_company = '<uuid>' -> that one tenant only
--
-- SAFETY
--   * Runs in a single transaction — any error rolls the whole thing back.
--   * Deletes children before parents, so it does not rely on cascade
--     rules and stays correct if a FK is ever changed to restrict.
--   * Idempotent — safe to run repeatedly.
--
-- Run:  psql "$DATABASE_URL" -f supabase/scripts/reset_sales_products_inventory.sql
-- =====================================================================

set search_path = point_of_sale;

begin;

do $$
declare
  -- Set to a company uuid to reset a single tenant, or leave null for all.
  v_company constant uuid := null;
  v_deleted int;
begin
  if v_company is null then
    raise notice 'Scope: ALL companies';
  else
    raise notice 'Scope: company %', v_company;
  end if;

  -- -------------------------------------------------------------------
  -- Sales side (deepest children first)
  -- -------------------------------------------------------------------

  -- sale_return_items has no company_id; scope it through its parent.
  delete from point_of_sale.sale_return_items sri
    using point_of_sale.sale_returns sr
   where sri.sale_return_id = sr.id
     and (v_company is null or sr.company_id = v_company);
  get diagnostics v_deleted = row_count;
  raise notice 'sale_return_items: % rows', v_deleted;

  delete from point_of_sale.sale_returns
   where v_company is null or company_id = v_company;
  get diagnostics v_deleted = row_count;
  raise notice 'sale_returns:      % rows', v_deleted;

  delete from point_of_sale.sale_items
   where v_company is null or company_id = v_company;
  get diagnostics v_deleted = row_count;
  raise notice 'sale_items:        % rows', v_deleted;

  delete from point_of_sale.sales
   where v_company is null or company_id = v_company;
  get diagnostics v_deleted = row_count;
  raise notice 'sales:             % rows', v_deleted;

  -- -------------------------------------------------------------------
  -- Inventory side
  -- -------------------------------------------------------------------

  delete from point_of_sale.inventory_movements
   where v_company is null or company_id = v_company;
  get diagnostics v_deleted = row_count;
  raise notice 'inventory_movements: % rows', v_deleted;

  delete from point_of_sale.stock_batches
   where v_company is null or company_id = v_company;
  get diagnostics v_deleted = row_count;
  raise notice 'stock_batches:     % rows', v_deleted;

  delete from point_of_sale.inventory
   where v_company is null or company_id = v_company;
  get diagnostics v_deleted = row_count;
  raise notice 'inventory:         % rows', v_deleted;

  -- -------------------------------------------------------------------
  -- Products last — everything above points at them
  -- -------------------------------------------------------------------

  delete from point_of_sale.product_units
   where v_company is null or company_id = v_company;
  get diagnostics v_deleted = row_count;
  raise notice 'product_units:     % rows', v_deleted;

  delete from point_of_sale.products
   where v_company is null or company_id = v_company;
  get diagnostics v_deleted = row_count;
  raise notice 'products:          % rows', v_deleted;

  -- -------------------------------------------------------------------
  -- OPTIONAL — uncomment if you also want these cleared.
  -- Customers are kept by default: they are contact records, not sales
  -- data, and sales.customer_id is `on delete set null` so removing them
  -- is not required for referential integrity.
  -- -------------------------------------------------------------------
  -- delete from point_of_sale.customers
  --  where v_company is null or company_id = v_company;
  -- get diagnostics v_deleted = row_count;
  -- raise notice 'customers:         % rows', v_deleted;

  -- Audit logs are kept by default so the trail of who did what survives
  -- the reset. Uncomment to drop entries about the wiped entities.
  -- delete from point_of_sale.audit_logs
  --  where (v_company is null or company_id = v_company)
  --    and entity_type in ('product', 'inventory', 'sale');
  -- get diagnostics v_deleted = row_count;
  -- raise notice 'audit_logs:        % rows', v_deleted;

  raise notice 'Reset complete. Companies, users and memberships untouched.';
end $$;

commit;
