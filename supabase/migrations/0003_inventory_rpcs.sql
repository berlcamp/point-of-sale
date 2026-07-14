-- =====================================================================
-- PointOne POS — inventory + void/return RPCs (atomic, manager-gated)
-- =====================================================================

-- Ensure an inventory row exists for a product.
create or replace function point_of_sale.ensure_inventory(p_product uuid, p_company uuid)
returns void language plpgsql security definer set search_path = point_of_sale as $$
begin
  insert into point_of_sale.inventory (company_id, product_id, quantity, low_stock)
  values (p_company, p_product, 0, 10)
  on conflict (product_id) do nothing;
end $$;

-- Receive stock: create a FIFO batch, bump inventory, log movement + audit.
create or replace function point_of_sale.receive_stock(
  p_product uuid, p_quantity numeric, p_cost numeric, p_reference text, p_reason text
) returns void language plpgsql security definer set search_path = point_of_sale as $$
declare
  v_uid uuid := auth.uid();
  v_company uuid; v_name text; v_prev numeric; v_new numeric;
begin
  select company_id, full_name into v_company, v_name from point_of_sale.profiles where id = v_uid;
  if not point_of_sale.is_company_manager() then raise exception 'Not authorized'; end if;

  perform point_of_sale.ensure_inventory(p_product, v_company);

  insert into point_of_sale.stock_batches (company_id, product_id, quantity, initial_qty, cost_price, reference, user_name)
  values (v_company, p_product, p_quantity, p_quantity, coalesce(p_cost,0), p_reference, v_name);

  select quantity into v_prev from point_of_sale.inventory where product_id = p_product for update;
  v_new := coalesce(v_prev,0) + p_quantity;
  update point_of_sale.inventory set quantity = v_new, updated_at = now() where product_id = p_product;

  insert into point_of_sale.inventory_movements (company_id, product_id, type, quantity, previous_qty, new_qty, reason, user_name)
  values (v_company, p_product, 'RESTOCK', p_quantity, coalesce(v_prev,0), v_new, coalesce(p_reason,'Purchase'), v_name);

  insert into point_of_sale.audit_logs (company_id, user_id, user_name, action, entity_type, entity_id, details)
  values (v_company, v_uid, v_name, 'STOCK_RECEIVED', 'product', p_product::text,
          jsonb_build_object('quantity', p_quantity, 'cost', p_cost, 'reason', p_reason));
end $$;

-- Adjust stock by a signed delta (negative removes via FIFO, positive adds a batch).
create or replace function point_of_sale.adjust_stock(
  p_product uuid, p_delta numeric, p_reason text
) returns void language plpgsql security definer set search_path = point_of_sale as $$
declare
  v_uid uuid := auth.uid();
  v_company uuid; v_name text; v_prev numeric; v_new numeric;
  v_remaining numeric; v_take numeric; v_batch record;
begin
  select company_id, full_name into v_company, v_name from point_of_sale.profiles where id = v_uid;
  if not point_of_sale.is_company_manager() then raise exception 'Not authorized'; end if;

  perform point_of_sale.ensure_inventory(p_product, v_company);

  select quantity into v_prev from point_of_sale.inventory where product_id = p_product for update;
  v_prev := coalesce(v_prev, 0);
  v_new := v_prev + p_delta;

  if p_delta < 0 then
    v_remaining := -p_delta;
    for v_batch in
      select id, quantity from point_of_sale.stock_batches
      where product_id = p_product and quantity > 0 order by received_at, id
    loop
      exit when v_remaining <= 0;
      v_take := least(v_remaining, v_batch.quantity);
      update point_of_sale.stock_batches set quantity = quantity - v_take where id = v_batch.id;
      v_remaining := v_remaining - v_take;
    end loop;
  else
    insert into point_of_sale.stock_batches (company_id, product_id, quantity, initial_qty, cost_price, reference, user_name)
    values (v_company, p_product, p_delta, p_delta, 0, 'Adjustment', v_name);
  end if;

  update point_of_sale.inventory set quantity = v_new, updated_at = now() where product_id = p_product;

  insert into point_of_sale.inventory_movements (company_id, product_id, type, quantity, previous_qty, new_qty, reason, user_name)
  values (v_company, p_product, 'ADJUSTMENT', p_delta, v_prev, v_new, coalesce(p_reason,'Correction'), v_name);

  insert into point_of_sale.audit_logs (company_id, user_id, user_name, action, entity_type, entity_id, details)
  values (v_company, v_uid, v_name, 'STOCK_ADJUSTED', 'product', p_product::text,
          jsonb_build_object('delta', p_delta, 'reason', p_reason));
end $$;

-- Void an entire sale: restore inventory, flag voided, record refund.
create or replace function point_of_sale.void_sale(p_sale uuid, p_reason text)
returns void language plpgsql security definer set search_path = point_of_sale as $$
declare
  v_uid uuid := auth.uid();
  v_company uuid; v_name text; v_sale record; v_item record;
  v_factor numeric; v_base numeric; v_prev numeric; v_new numeric; v_return uuid;
begin
  select company_id, full_name into v_company, v_name from point_of_sale.profiles where id = v_uid;
  if not point_of_sale.is_company_manager() then raise exception 'Not authorized'; end if;

  select * into v_sale from point_of_sale.sales where id = p_sale and company_id = v_company;
  if not found then raise exception 'Sale not found'; end if;
  if v_sale.is_voided then raise exception 'Sale already voided'; end if;

  update point_of_sale.sales set is_voided = true where id = p_sale;

  insert into point_of_sale.sale_returns (company_id, sale_id, type, reason, refund_amount, created_by, created_by_name)
  values (v_company, p_sale, 'VOID', p_reason, v_sale.total, v_uid, v_name) returning id into v_return;

  for v_item in select * from point_of_sale.sale_items where sale_id = p_sale loop
    select coalesce(conversion_factor,1) into v_factor from point_of_sale.product_units
      where product_id = v_item.product_id and unit_name = v_item.unit_name limit 1;
    v_factor := coalesce(v_factor, 1);
    v_base := v_item.quantity * v_factor;

    perform point_of_sale.ensure_inventory(v_item.product_id, v_company);
    select quantity into v_prev from point_of_sale.inventory where product_id = v_item.product_id for update;
    v_new := coalesce(v_prev,0) + v_base;
    update point_of_sale.inventory set quantity = v_new, updated_at = now() where product_id = v_item.product_id;

    insert into point_of_sale.stock_batches (company_id, product_id, quantity, initial_qty, cost_price, reference, user_name)
    values (v_company, v_item.product_id, v_base, v_base, v_item.cost_price, 'Void ' || v_sale.receipt_number, v_name);

    insert into point_of_sale.inventory_movements (company_id, product_id, type, quantity, previous_qty, new_qty, reason, reference_id, user_name)
    values (v_company, v_item.product_id, 'RETURN', v_base, coalesce(v_prev,0), v_new, 'Void ' || v_sale.receipt_number, p_sale::text, v_name);
  end loop;

  insert into point_of_sale.audit_logs (company_id, user_id, user_name, action, entity_type, entity_id, details)
  values (v_company, v_uid, v_name, 'SALE_VOIDED', 'sale', p_sale::text,
          jsonb_build_object('receipt_number', v_sale.receipt_number, 'reason', p_reason));
end $$;

-- Partial return of specific line items.
create or replace function point_of_sale.return_items(p_sale uuid, p_items jsonb, p_reason text)
returns numeric language plpgsql security definer set search_path = point_of_sale as $$
declare
  v_uid uuid := auth.uid();
  v_company uuid; v_name text; v_sale record; v_row jsonb; v_item record;
  v_factor numeric; v_base numeric; v_prev numeric; v_new numeric;
  v_qty numeric; v_refund numeric; v_total_refund numeric := 0; v_return uuid;
begin
  select company_id, full_name into v_company, v_name from point_of_sale.profiles where id = v_uid;
  if not point_of_sale.is_company_manager() then raise exception 'Not authorized'; end if;

  select * into v_sale from point_of_sale.sales where id = p_sale and company_id = v_company;
  if not found then raise exception 'Sale not found'; end if;

  insert into point_of_sale.sale_returns (company_id, sale_id, type, reason, refund_amount, created_by, created_by_name)
  values (v_company, p_sale, 'RETURN', p_reason, 0, v_uid, v_name) returning id into v_return;

  for v_row in select * from jsonb_array_elements(p_items) loop
    select * into v_item from point_of_sale.sale_items where id = (v_row->>'sale_item_id')::uuid and sale_id = p_sale;
    if not found then continue; end if;
    v_qty := (v_row->>'quantity')::numeric;
    if v_qty <= 0 or v_qty > v_item.quantity then continue; end if;

    v_refund := v_qty * v_item.price - (v_item.discount * v_qty / nullif(v_item.quantity,0));
    v_total_refund := v_total_refund + v_refund;

    insert into point_of_sale.sale_return_items (sale_return_id, sale_item_id, quantity, refund)
    values (v_return, v_item.id, v_qty, v_refund);

    select coalesce(conversion_factor,1) into v_factor from point_of_sale.product_units
      where product_id = v_item.product_id and unit_name = v_item.unit_name limit 1;
    v_factor := coalesce(v_factor, 1);
    v_base := v_qty * v_factor;

    perform point_of_sale.ensure_inventory(v_item.product_id, v_company);
    select quantity into v_prev from point_of_sale.inventory where product_id = v_item.product_id for update;
    v_new := coalesce(v_prev,0) + v_base;
    update point_of_sale.inventory set quantity = v_new, updated_at = now() where product_id = v_item.product_id;

    insert into point_of_sale.stock_batches (company_id, product_id, quantity, initial_qty, cost_price, reference, user_name)
    values (v_company, v_item.product_id, v_base, v_base, v_item.cost_price, 'Return ' || v_sale.receipt_number, v_name);

    insert into point_of_sale.inventory_movements (company_id, product_id, type, quantity, previous_qty, new_qty, reason, reference_id, user_name)
    values (v_company, v_item.product_id, 'RETURN', v_base, coalesce(v_prev,0), v_new, 'Return ' || v_sale.receipt_number, p_sale::text, v_name);
  end loop;

  update point_of_sale.sale_returns set refund_amount = v_total_refund where id = v_return;

  insert into point_of_sale.audit_logs (company_id, user_id, user_name, action, entity_type, entity_id, details)
  values (v_company, v_uid, v_name, 'SALE_RETURNED', 'sale', p_sale::text,
          jsonb_build_object('receipt_number', v_sale.receipt_number, 'refund', v_total_refund, 'reason', p_reason));

  return v_total_refund;
end $$;

grant execute on function point_of_sale.receive_stock(uuid, numeric, numeric, text, text) to authenticated;
grant execute on function point_of_sale.adjust_stock(uuid, numeric, text) to authenticated;
grant execute on function point_of_sale.void_sale(uuid, text) to authenticated;
grant execute on function point_of_sale.return_items(uuid, jsonb, text) to authenticated;
grant execute on function point_of_sale.ensure_inventory(uuid, uuid) to authenticated;
