-- ---------------------------------------------------------------------
-- Cheque and terms payments.
-- Payment methods at checkout are now cash / cheque / terms (gcash and
-- card removed from the UI; historical rows keep their old values).
--   * cheque  -> cheque_date records the date written on the cheque.
--   * terms   -> payment_terms records the agreed terms (e.g. "30 days");
--                nothing is tendered, so amount_paid and change are 0.
-- ---------------------------------------------------------------------
alter table point_of_sale.sales
  add column if not exists cheque_date date,
  add column if not exists payment_terms text;

-- Recreate create_sale to persist cheque_date / payment_terms and to zero
-- out change on terms sales.
create or replace function point_of_sale.create_sale(payload jsonb)
returns jsonb language plpgsql security definer set search_path = point_of_sale as $$
declare
  v_uid          uuid := auth.uid();
  v_company_id   uuid;
  v_cashier_name text;
  v_sale_id      uuid := (payload->>'id')::uuid;
  v_receipt      text := payload->>'receipt_number';
  v_customer     text := nullif(trim(coalesce(payload->>'customer_name', '')), '');
  v_discount     numeric := coalesce((payload->>'discount')::numeric, 0);
  v_amount_paid  numeric := coalesce((payload->>'amount_paid')::numeric, 0);
  v_method       text := coalesce(payload->>'payment_method', 'cash');
  v_cheque_date  date := nullif(payload->>'cheque_date', '')::date;
  v_terms        text := nullif(trim(coalesce(payload->>'payment_terms', '')), '');
  v_terminal     text := coalesce(payload->>'terminal_id', 'POS-01');
  v_created_at   timestamptz := coalesce((payload->>'created_at')::timestamptz, now());
  v_item         jsonb;
  v_factor       numeric;
  v_base_qty     numeric;
  v_remaining    numeric;
  v_total_cost   numeric;
  v_take         numeric;
  v_batch        record;
  v_prev_qty     numeric;
  v_new_qty      numeric;
  v_line_total   numeric;
  v_subtotal     numeric := 0;
  v_total        numeric;
  v_change       numeric;
  v_cost_unit    numeric;
  v_existing     jsonb;
begin
  -- Resolve tenant + cashier from the authenticated profile.
  select company_id, full_name into v_company_id, v_cashier_name
    from point_of_sale.profiles where id = v_uid;
  if v_company_id is null then
    raise exception 'No company for current user';
  end if;

  -- Only the matching payment detail applies to each method.
  if v_method <> 'cheque' then v_cheque_date := null; end if;
  if v_method <> 'terms' then v_terms := null; end if;

  -- Idempotency: replaying an already-synced offline sale returns it unchanged.
  select to_jsonb(s.*) into v_existing from point_of_sale.sales s where s.id = v_sale_id;
  if v_existing is not null then
    return v_existing;
  end if;

  -- Compute subtotal from line items.
  for v_item in select * from jsonb_array_elements(payload->'items') loop
    v_line_total := (v_item->>'quantity')::numeric * (v_item->>'price')::numeric
                    - coalesce((v_item->>'discount')::numeric, 0);
    v_subtotal := v_subtotal + v_line_total;
  end loop;

  v_total := v_subtotal - v_discount;
  -- Terms sales are charged, not paid at the register — no change is due.
  v_change := case when v_method = 'terms' then 0 else v_amount_paid - v_total end;

  insert into point_of_sale.sales (
    id, company_id, receipt_number, customer_name, subtotal, discount, total,
    payment_method, cheque_date, payment_terms, amount_paid, change,
    cashier_id, cashier_name, terminal_id, created_at
  ) values (
    v_sale_id, v_company_id, v_receipt, v_customer, v_subtotal, v_discount, v_total,
    v_method, v_cheque_date, v_terms, v_amount_paid, v_change,
    v_uid, v_cashier_name, v_terminal, v_created_at
  );

  -- Per-item: FIFO cost, inventory decrement, movement.
  for v_item in select * from jsonb_array_elements(payload->'items') loop
    select coalesce(conversion_factor, 1) into v_factor
      from point_of_sale.product_units
      where product_id = (v_item->>'product_id')::uuid
        and unit_name = v_item->>'unit_name'
      limit 1;
    v_factor := coalesce(v_factor, 1);
    v_base_qty := (v_item->>'quantity')::numeric * v_factor;

    -- Consume FIFO batches.
    v_remaining := v_base_qty;
    v_total_cost := 0;
    for v_batch in
      select id, quantity, cost_price from point_of_sale.stock_batches
      where product_id = (v_item->>'product_id')::uuid and quantity > 0
      order by received_at, id
    loop
      exit when v_remaining <= 0;
      v_take := least(v_remaining, v_batch.quantity);
      v_total_cost := v_total_cost + v_take * v_batch.cost_price;
      update point_of_sale.stock_batches set quantity = quantity - v_take where id = v_batch.id;
      v_remaining := v_remaining - v_take;
    end loop;

    v_cost_unit := case when (v_item->>'quantity')::numeric > 0
                        then v_total_cost / (v_item->>'quantity')::numeric else 0 end;

    v_line_total := (v_item->>'quantity')::numeric * (v_item->>'price')::numeric
                    - coalesce((v_item->>'discount')::numeric, 0);

    insert into point_of_sale.sale_items (
      company_id, sale_id, product_id, product_name, unit_name,
      quantity, price, cost_price, discount, total
    ) values (
      v_company_id, v_sale_id, (v_item->>'product_id')::uuid, v_item->>'product_name',
      v_item->>'unit_name', (v_item->>'quantity')::numeric, (v_item->>'price')::numeric,
      v_cost_unit, coalesce((v_item->>'discount')::numeric, 0), v_line_total
    );

    -- Decrement inventory + record movement.
    select quantity into v_prev_qty from point_of_sale.inventory
      where product_id = (v_item->>'product_id')::uuid for update;
    if v_prev_qty is null then v_prev_qty := 0; end if;
    v_new_qty := v_prev_qty - v_base_qty;

    update point_of_sale.inventory set quantity = v_new_qty, updated_at = now()
      where product_id = (v_item->>'product_id')::uuid;

    insert into point_of_sale.inventory_movements (
      company_id, product_id, type, quantity, previous_qty, new_qty, reason, reference_id, user_name
    ) values (
      v_company_id, (v_item->>'product_id')::uuid, 'SALE', v_base_qty, v_prev_qty, v_new_qty,
      'Sale ' || v_receipt, v_sale_id::text, v_cashier_name
    );
  end loop;

  insert into point_of_sale.audit_logs (company_id, user_id, user_name, action, entity_type, entity_id, details)
  values (v_company_id, v_uid, v_cashier_name, 'SALE_CREATED', 'sale', v_sale_id::text,
          jsonb_build_object('receipt_number', v_receipt, 'total', v_total));

  return jsonb_build_object(
    'id', v_sale_id, 'receipt_number', v_receipt, 'customer_name', v_customer,
    'subtotal', v_subtotal, 'discount', v_discount, 'total', v_total,
    'payment_method', v_method, 'cheque_date', v_cheque_date, 'payment_terms', v_terms,
    'amount_paid', v_amount_paid, 'change', v_change, 'cashier_name', v_cashier_name,
    'created_at', v_created_at, 'items', payload->'items'
  );
end $$;

grant execute on function point_of_sale.create_sale(jsonb) to authenticated;
