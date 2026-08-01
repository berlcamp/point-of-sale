-- =====================================================================
-- PointOne POS — cashier booth flow: helpers, RPCs and report guards.
-- Everything here reads the 'booth_cashier' role or the sale lifecycle
-- added in 0012.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function point_of_sale.is_booth_cashier()
returns boolean language sql stable security definer set search_path = point_of_sale as $$
  select coalesce((select role = 'booth_cashier' from point_of_sale.profiles where id = auth.uid()), false);
$$;

-- Whoever may take money at the booth: the booth cashier, plus admins and
-- managers so the station is never blocked when the clerk is away.
create or replace function point_of_sale.can_work_booth()
returns boolean language sql stable security definer set search_path = point_of_sale as $$
  select point_of_sale.is_booth_cashier() or point_of_sale.is_company_manager();
$$;

create or replace function point_of_sale.current_transaction_flow()
returns text language sql stable security definer set search_path = point_of_sale as $$
  select transaction_flow from point_of_sale.companies
   where id = point_of_sale.current_company_id();
$$;

-- Next ticket for a store. The upsert is a single statement, so two
-- terminals checking out at the same instant serialise on the row and
-- can never be handed the same number.
create or replace function point_of_sale.next_ticket_number(p_company uuid)
returns int language plpgsql security definer set search_path = point_of_sale as $$
declare
  v_n int;
begin
  insert into point_of_sale.ticket_counters (company_id, last_number)
  values (p_company, 1)
  on conflict (company_id) do update
     set last_number = case when ticket_counters.last_number >= 999
                            then 1 else ticket_counters.last_number + 1 end,
         updated_at = now()
  returning last_number into v_n;
  return v_n;
end $$;

grant execute on function point_of_sale.is_booth_cashier() to authenticated;
grant execute on function point_of_sale.can_work_booth() to authenticated;
grant execute on function point_of_sale.current_transaction_flow() to authenticated;

-- ---------------------------------------------------------------------
-- create_sale — now also opens PENDING sales for the booth flow.
--
-- A pending sale still consumes stock: the goods leave the shelf when the
-- cart is rung up, and cancelling the ticket (void_sale) puts them back.
-- What it does NOT carry is payment — no method, nothing tendered, no
-- change — because none of that is known until the customer reaches the
-- booth.
-- ---------------------------------------------------------------------
create or replace function point_of_sale.create_sale(payload jsonb)
returns jsonb language plpgsql security definer set search_path = point_of_sale as $$
declare
  v_uid          uuid := auth.uid();
  v_company_id   uuid;
  v_cashier_name text;
  v_flow         text;
  v_status       point_of_sale.sale_status
                   := coalesce(nullif(payload->>'status', ''), 'completed')::point_of_sale.sale_status;
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
  v_ticket       int;
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

  -- A pending sale is only meaningful where a booth exists to complete it.
  if v_status = 'pending' then
    select transaction_flow into v_flow from point_of_sale.companies where id = v_company_id;
    if v_flow is distinct from 'cashier_booth' then
      raise exception 'This store does not use the cashier booth flow';
    end if;
    -- Payment belongs to the booth, not the terminal.
    v_method := null;
    v_cheque_date := null;
    v_terms := null;
    v_amount_paid := 0;
  else
    -- Only the matching payment detail applies to each method.
    if v_method <> 'cheque' then v_cheque_date := null; end if;
    if v_method <> 'terms' then v_terms := null; end if;
  end if;

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
  -- Nothing is tendered on a pending or a terms sale, so no change is due.
  v_change := case when v_status = 'pending' or v_method = 'terms'
                   then 0 else v_amount_paid - v_total end;

  if v_status = 'pending' then
    v_ticket := point_of_sale.next_ticket_number(v_company_id);
  end if;

  insert into point_of_sale.sales (
    id, company_id, receipt_number, customer_name, subtotal, discount, total,
    payment_method, cheque_date, payment_terms, amount_paid, change,
    cashier_id, cashier_name, terminal_id, created_at, status, ticket_number,
    completed_at, completed_by, completed_by_name
  ) values (
    v_sale_id, v_company_id, v_receipt, v_customer, v_subtotal, v_discount, v_total,
    v_method, v_cheque_date, v_terms, v_amount_paid, v_change,
    v_uid, v_cashier_name, v_terminal, v_created_at, v_status, v_ticket,
    case when v_status = 'completed' then v_created_at end,
    case when v_status = 'completed' then v_uid end,
    case when v_status = 'completed' then v_cashier_name end
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
  values (v_company_id, v_uid, v_cashier_name,
          case when v_status = 'pending' then 'SALE_PENDING' else 'SALE_CREATED' end,
          'sale', v_sale_id::text,
          jsonb_build_object('receipt_number', v_receipt, 'total', v_total, 'ticket_number', v_ticket));

  return jsonb_build_object(
    'id', v_sale_id, 'receipt_number', v_receipt, 'customer_name', v_customer,
    'subtotal', v_subtotal, 'discount', v_discount, 'total', v_total,
    'payment_method', v_method, 'cheque_date', v_cheque_date, 'payment_terms', v_terms,
    'amount_paid', v_amount_paid, 'change', v_change, 'cashier_name', v_cashier_name,
    'created_at', v_created_at, 'status', v_status, 'ticket_number', v_ticket,
    'items', payload->'items'
  );
end $$;

grant execute on function point_of_sale.create_sale(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- complete_sale — the booth records the payment and closes the ticket.
-- Returns everything the receipt needs so the caller never has to
-- re-read the sale.
-- ---------------------------------------------------------------------
create or replace function point_of_sale.complete_sale(
  p_sale        uuid,
  p_method      text,
  p_amount_paid numeric,
  p_cheque_date date default null,
  p_terms       text default null
) returns jsonb language plpgsql security definer set search_path = point_of_sale as $$
declare
  v_uid     uuid := auth.uid();
  v_company uuid;
  v_name    text;
  v_sale    record;
  v_terms   text := nullif(trim(coalesce(p_terms, '')), '');
  v_paid    numeric := coalesce(p_amount_paid, 0);
  v_change  numeric;
begin
  select company_id, full_name into v_company, v_name
    from point_of_sale.profiles where id = v_uid;
  if not point_of_sale.can_work_booth() then raise exception 'Not authorized'; end if;

  -- Lock the ticket: two booth terminals opening the same one must not
  -- both take payment for it.
  select * into v_sale from point_of_sale.sales
   where id = p_sale and company_id = v_company for update;
  if not found then raise exception 'Transaction not found'; end if;
  if v_sale.is_voided then raise exception 'Transaction was cancelled'; end if;
  if v_sale.status <> 'pending' then raise exception 'Transaction is already completed'; end if;

  if p_method not in ('cash', 'cheque', 'terms') then
    raise exception 'Unknown payment method: %', p_method;
  end if;
  if p_method = 'cheque' and p_cheque_date is null then
    raise exception 'A cheque date is required';
  end if;
  if p_method = 'terms' and v_terms is null then
    raise exception 'Payment terms are required';
  end if;

  -- A terms sale is charged, not paid at the booth.
  if p_method = 'terms' then
    v_paid := 0;
    v_change := 0;
  else
    v_change := v_paid - v_sale.total;
    if v_change < 0 then raise exception 'Amount tendered is less than the total due'; end if;
  end if;

  update point_of_sale.sales
     set status            = 'completed',
         payment_method    = p_method,
         cheque_date       = case when p_method = 'cheque' then p_cheque_date end,
         payment_terms     = case when p_method = 'terms' then v_terms end,
         amount_paid       = v_paid,
         change            = v_change,
         completed_at      = now(),
         completed_by      = v_uid,
         completed_by_name = v_name
   where id = p_sale;

  insert into point_of_sale.audit_logs (company_id, user_id, user_name, action, entity_type, entity_id, details)
  values (v_company, v_uid, v_name, 'SALE_COMPLETED', 'sale', p_sale::text,
          jsonb_build_object('receipt_number', v_sale.receipt_number,
                             'ticket_number', v_sale.ticket_number,
                             'total', v_sale.total, 'payment_method', p_method));

  return jsonb_build_object(
    'id', p_sale,
    'receipt_number', v_sale.receipt_number,
    'ticket_number', v_sale.ticket_number,
    'customer_name', v_sale.customer_name,
    'subtotal', v_sale.subtotal,
    'discount', v_sale.discount,
    'total', v_sale.total,
    'payment_method', p_method,
    'cheque_date', case when p_method = 'cheque' then p_cheque_date end,
    'payment_terms', case when p_method = 'terms' then v_terms end,
    'amount_paid', v_paid,
    'change', v_change,
    'cashier_name', coalesce(v_sale.cashier_name, v_name),
    'completed_by_name', v_name,
    'created_at', v_sale.created_at,
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'product_name', si.product_name, 'unit_name', si.unit_name,
               'quantity', si.quantity, 'price', si.price, 'total', si.total
             ) order by si.product_name), '[]'::jsonb)
        from point_of_sale.sale_items si where si.sale_id = p_sale
    )
  );
end $$;

grant execute on function point_of_sale.complete_sale(uuid, text, numeric, date, text) to authenticated;

-- ---------------------------------------------------------------------
-- void_sale — unchanged for completed sales, but the booth cashier may
-- also cancel a PENDING ticket (the customer changed their mind on the
-- way over), which is the only way the reserved stock goes back.
-- ---------------------------------------------------------------------
create or replace function point_of_sale.void_sale(p_sale uuid, p_reason text)
returns void language plpgsql security definer set search_path = point_of_sale as $$
declare
  v_uid uuid := auth.uid();
  v_company uuid; v_name text; v_sale record; v_item record;
  v_factor numeric; v_base numeric; v_prev numeric; v_new numeric; v_return uuid;
begin
  select company_id, full_name into v_company, v_name from point_of_sale.profiles where id = v_uid;

  select * into v_sale from point_of_sale.sales where id = p_sale and company_id = v_company;
  if not found then raise exception 'Sale not found'; end if;
  if v_sale.is_voided then raise exception 'Sale already voided'; end if;

  -- Authorization depends on what is being voided: cancelling an unpaid
  -- ticket is booth work, reversing a paid sale stays manager-only.
  if not (point_of_sale.is_company_manager()
          or (v_sale.status = 'pending' and point_of_sale.is_booth_cashier())) then
    raise exception 'Not authorized';
  end if;

  update point_of_sale.sales set is_voided = true where id = p_sale;

  insert into point_of_sale.sale_returns (company_id, sale_id, type, reason, refund_amount, created_by, created_by_name)
  values (v_company, p_sale, 'VOID', p_reason,
          -- A pending ticket was never paid, so cancelling it refunds nothing.
          case when v_sale.status = 'pending' then 0 else v_sale.total end,
          v_uid, v_name) returning id into v_return;

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
  values (v_company, v_uid, v_name,
          case when v_sale.status = 'pending' then 'SALE_CANCELLED' else 'SALE_VOIDED' end,
          'sale', p_sale::text,
          jsonb_build_object('receipt_number', v_sale.receipt_number,
                             'ticket_number', v_sale.ticket_number, 'reason', p_reason));
end $$;

grant execute on function point_of_sale.void_sale(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- return_items — refunding a ticket the booth has not collected on yet
-- would pay out money that was never taken. Cancelling it (void_sale) is
-- the right move while it is still pending.
-- ---------------------------------------------------------------------
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
  if v_sale.status <> 'completed' then
    raise exception 'Transaction has not been paid yet — cancel it at the cashier instead';
  end if;

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

grant execute on function point_of_sale.return_items(uuid, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------
-- settle_sale — a ticket that has not been paid at the booth yet cannot
-- also be a collectible.
-- ---------------------------------------------------------------------
create or replace function point_of_sale.settle_sale(p_sale uuid)
returns void language plpgsql security definer set search_path = point_of_sale as $$
declare
  v_uid uuid := auth.uid();
  v_company uuid; v_name text; v_sale record;
begin
  select company_id, full_name into v_company, v_name
    from point_of_sale.profiles where id = v_uid;
  if not point_of_sale.is_company_manager() then raise exception 'Not authorized'; end if;

  select * into v_sale from point_of_sale.sales where id = p_sale and company_id = v_company;
  if not found then raise exception 'Sale not found'; end if;
  if v_sale.status <> 'completed' then
    raise exception 'Transaction has not been completed at the cashier yet';
  end if;
  if v_sale.payment_method not in ('cheque', 'terms') then
    raise exception 'Only cheque or terms sales can be settled';
  end if;
  if v_sale.is_voided then raise exception 'Sale is voided'; end if;
  if v_sale.settled_at is not null then return; end if; -- already paid: no-op

  update point_of_sale.sales
     set settled_at = now(),
         settled_by_name = v_name,
         -- A terms sale is fully collected on settlement.
         amount_paid = case when payment_method = 'terms' then total else amount_paid end
   where id = p_sale;

  insert into point_of_sale.audit_logs (company_id, user_id, user_name, action, entity_type, entity_id, details)
  values (v_company, v_uid, v_name, 'SALE_SETTLED', 'sale', p_sale::text,
          jsonb_build_object('receipt_number', v_sale.receipt_number, 'total', v_sale.total,
                             'payment_method', v_sale.payment_method));
end $$;

grant execute on function point_of_sale.settle_sale(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Reports count money that has actually been taken. A pending ticket has
-- consumed stock but earned nothing yet, so every revenue aggregate below
-- now filters on status = 'completed'.
-- ---------------------------------------------------------------------
create or replace function point_of_sale.report_summary(p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql security definer set search_path = point_of_sale as $$
declare
  v_cid uuid := point_of_sale.current_company_id();
  v_rev numeric; v_disc numeric; v_txns int; v_cogs numeric; v_refunds numeric;
begin
  select coalesce(sum(total),0), coalesce(sum(discount),0), count(*)
    into v_rev, v_disc, v_txns
    from point_of_sale.sales
    where company_id = v_cid and not is_voided and status = 'completed'
      and created_at >= p_from and created_at < p_to;

  select coalesce(sum(si.cost_price * si.quantity),0) into v_cogs
    from point_of_sale.sale_items si
    join point_of_sale.sales s on s.id = si.sale_id
    where s.company_id = v_cid and not s.is_voided and s.status = 'completed'
      and s.created_at >= p_from and s.created_at < p_to;

  select coalesce(sum(refund_amount),0) into v_refunds
    from point_of_sale.sale_returns
    where company_id = v_cid and created_at >= p_from and created_at < p_to;

  return jsonb_build_object(
    'revenue', v_rev, 'discounts', v_disc, 'transactions', v_txns,
    'cogs', v_cogs, 'gross_profit', v_rev - v_cogs,
    'margin', case when v_rev > 0 then round((v_rev - v_cogs) / v_rev * 100, 2) else 0 end,
    'refunds', v_refunds
  );
end $$;

create or replace function point_of_sale.report_sales_by_day(p_days int)
returns jsonb language plpgsql security definer set search_path = point_of_sale as $$
declare
  v_cid uuid := point_of_sale.current_company_id();
  v_result jsonb;
begin
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into v_result from (
    select to_char(d::date, 'YYYY-MM-DD') as date,
           coalesce(sum(s.total),0) as revenue,
           count(s.id) as txns
    from generate_series((now() - (p_days || ' days')::interval)::date, now()::date, '1 day') d
    left join point_of_sale.sales s
      on s.company_id = v_cid and not s.is_voided and s.status = 'completed'
         and s.created_at::date = d::date
    group by d order by d
  ) t;
  return v_result;
end $$;

create or replace function point_of_sale.report_top_products(p_from timestamptz, p_to timestamptz, p_limit int)
returns jsonb language plpgsql security definer set search_path = point_of_sale as $$
declare
  v_cid uuid := point_of_sale.current_company_id();
  v_result jsonb;
begin
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into v_result from (
    select si.product_id, si.product_name,
           sum(si.quantity) as units,
           sum(si.total) as revenue,
           sum(si.cost_price * si.quantity) as cost,
           sum(si.total) - sum(si.cost_price * si.quantity) as profit
    from point_of_sale.sale_items si
    join point_of_sale.sales s on s.id = si.sale_id
    where s.company_id = v_cid and not s.is_voided and s.status = 'completed'
      and s.created_at >= p_from and s.created_at < p_to
    group by si.product_id, si.product_name
    order by revenue desc
    limit p_limit
  ) t;
  return v_result;
end $$;

create or replace function point_of_sale.report_payment_breakdown(p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql security definer set search_path = point_of_sale as $$
declare
  v_cid uuid := point_of_sale.current_company_id();
  v_result jsonb;
begin
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into v_result from (
    select payment_method as method, sum(total) as total, count(*) as count
    from point_of_sale.sales
    where company_id = v_cid and not is_voided and status = 'completed'
      and created_at >= p_from and created_at < p_to
    group by payment_method
  ) t;
  return v_result;
end $$;

create or replace function point_of_sale.report_by_cashier(p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql security definer set search_path = point_of_sale as $$
declare
  v_cid uuid := point_of_sale.current_company_id();
  v_result jsonb;
begin
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into v_result from (
    select coalesce(cashier_name, 'Unknown') as cashier,
           sum(total) as revenue, sum(discount) as discount, count(*) as txns,
           round(avg(total), 2) as avg_sale
    from point_of_sale.sales
    where company_id = v_cid and not is_voided and status = 'completed'
      and created_at >= p_from and created_at < p_to
    group by cashier_name
    order by revenue desc
  ) t;
  return v_result;
end $$;
