-- =====================================================================
-- PointOne POS — helper functions, triggers, RLS, and create_sale RPC
-- =====================================================================

-- ---------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER so they bypass RLS on profiles and
-- therefore never recurse inside profile policies).
-- ---------------------------------------------------------------------
create or replace function point_of_sale.current_company_id()
returns uuid language sql stable security definer set search_path = point_of_sale as $$
  select company_id from point_of_sale.profiles where id = auth.uid();
$$;

create or replace function point_of_sale.current_role()
returns point_of_sale.user_role language sql stable security definer set search_path = point_of_sale as $$
  select role from point_of_sale.profiles where id = auth.uid();
$$;

create or replace function point_of_sale.is_super_admin()
returns boolean language sql stable security definer set search_path = point_of_sale as $$
  select coalesce((select role = 'super_admin' from point_of_sale.profiles where id = auth.uid()), false);
$$;

create or replace function point_of_sale.is_company_manager()
returns boolean language sql stable security definer set search_path = point_of_sale as $$
  select coalesce((select role in ('admin','manager') from point_of_sale.profiles where id = auth.uid()), false);
$$;

grant execute on function point_of_sale.current_company_id() to authenticated;
grant execute on function point_of_sale.current_role() to authenticated;
grant execute on function point_of_sale.is_super_admin() to authenticated;
grant execute on function point_of_sale.is_company_manager() to authenticated;

-- ---------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------
create or replace function point_of_sale.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_products_updated on point_of_sale.products;
create trigger trg_products_updated before update on point_of_sale.products
  for each row execute function point_of_sale.touch_updated_at();

-- ---------------------------------------------------------------------
-- Auth provisioning: link new Google users to a company via invitation,
-- or bootstrap the platform super admin.
-- ---------------------------------------------------------------------
create or replace function point_of_sale.handle_new_user()
returns trigger language plpgsql security definer set search_path = point_of_sale as $$
declare
  v_name text := coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', new.email);
  v_inv point_of_sale.invitations%rowtype;
begin
  -- Platform super admin bootstrap.
  if lower(new.email) = 'berlcamp@gmail.com' then
    insert into point_of_sale.profiles (id, company_id, full_name, email, role)
    values (new.id, null, v_name, new.email, 'super_admin')
    on conflict (id) do update set role = 'super_admin';
    return new;
  end if;

  -- Match a pending invitation.
  select * into v_inv from point_of_sale.invitations
    where lower(email) = lower(new.email) and status = 'pending'
    order by created_at desc limit 1;

  if found then
    insert into point_of_sale.profiles (id, company_id, full_name, email, role)
    values (new.id, v_inv.company_id, v_name, new.email, v_inv.role)
    on conflict (id) do update
      set company_id = excluded.company_id, role = excluded.role;
    update point_of_sale.invitations set status = 'accepted' where id = v_inv.id;
  end if;

  -- No invitation → no profile created (user lands on /not-authorized).
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function point_of_sale.handle_new_user();

-- ---------------------------------------------------------------------
-- Enable RLS
-- ---------------------------------------------------------------------
alter table point_of_sale.companies            enable row level security;
alter table point_of_sale.profiles             enable row level security;
alter table point_of_sale.invitations          enable row level security;
alter table point_of_sale.products             enable row level security;
alter table point_of_sale.product_units        enable row level security;
alter table point_of_sale.inventory            enable row level security;
alter table point_of_sale.stock_batches        enable row level security;
alter table point_of_sale.customers            enable row level security;
alter table point_of_sale.sales                enable row level security;
alter table point_of_sale.sale_items           enable row level security;
alter table point_of_sale.sale_returns         enable row level security;
alter table point_of_sale.sale_return_items    enable row level security;
alter table point_of_sale.inventory_movements  enable row level security;
alter table point_of_sale.audit_logs           enable row level security;

-- companies
drop policy if exists companies_super_all on point_of_sale.companies;
create policy companies_super_all on point_of_sale.companies
  for all using (point_of_sale.is_super_admin()) with check (point_of_sale.is_super_admin());
drop policy if exists companies_member_read on point_of_sale.companies;
create policy companies_member_read on point_of_sale.companies
  for select using (id = point_of_sale.current_company_id());

-- profiles
drop policy if exists profiles_super_all on point_of_sale.profiles;
create policy profiles_super_all on point_of_sale.profiles
  for all using (point_of_sale.is_super_admin()) with check (point_of_sale.is_super_admin());
drop policy if exists profiles_self_read on point_of_sale.profiles;
create policy profiles_self_read on point_of_sale.profiles
  for select using (id = auth.uid() or company_id = point_of_sale.current_company_id());
drop policy if exists profiles_admin_write on point_of_sale.profiles;
create policy profiles_admin_write on point_of_sale.profiles
  for update using (company_id = point_of_sale.current_company_id() and point_of_sale.current_role() = 'admin')
  with check (company_id = point_of_sale.current_company_id());

-- invitations
drop policy if exists invitations_super_all on point_of_sale.invitations;
create policy invitations_super_all on point_of_sale.invitations
  for all using (point_of_sale.is_super_admin()) with check (point_of_sale.is_super_admin());
drop policy if exists invitations_admin_all on point_of_sale.invitations;
create policy invitations_admin_all on point_of_sale.invitations
  for all using (company_id = point_of_sale.current_company_id() and point_of_sale.current_role() = 'admin')
  with check (company_id = point_of_sale.current_company_id() and point_of_sale.current_role() = 'admin');

-- Company-scoped read + manager-gated write, applied to catalog tables.
-- products
drop policy if exists products_read on point_of_sale.products;
create policy products_read on point_of_sale.products
  for select using (company_id = point_of_sale.current_company_id());
drop policy if exists products_write on point_of_sale.products;
create policy products_write on point_of_sale.products
  for all using (company_id = point_of_sale.current_company_id() and point_of_sale.is_company_manager())
  with check (company_id = point_of_sale.current_company_id() and point_of_sale.is_company_manager());

-- product_units
drop policy if exists units_read on point_of_sale.product_units;
create policy units_read on point_of_sale.product_units
  for select using (company_id = point_of_sale.current_company_id());
drop policy if exists units_write on point_of_sale.product_units;
create policy units_write on point_of_sale.product_units
  for all using (company_id = point_of_sale.current_company_id() and point_of_sale.is_company_manager())
  with check (company_id = point_of_sale.current_company_id() and point_of_sale.is_company_manager());

-- inventory
drop policy if exists inventory_read on point_of_sale.inventory;
create policy inventory_read on point_of_sale.inventory
  for select using (company_id = point_of_sale.current_company_id());
drop policy if exists inventory_write on point_of_sale.inventory;
create policy inventory_write on point_of_sale.inventory
  for all using (company_id = point_of_sale.current_company_id() and point_of_sale.is_company_manager())
  with check (company_id = point_of_sale.current_company_id() and point_of_sale.is_company_manager());

-- stock_batches
drop policy if exists batches_read on point_of_sale.stock_batches;
create policy batches_read on point_of_sale.stock_batches
  for select using (company_id = point_of_sale.current_company_id());
drop policy if exists batches_write on point_of_sale.stock_batches;
create policy batches_write on point_of_sale.stock_batches
  for all using (company_id = point_of_sale.current_company_id() and point_of_sale.is_company_manager())
  with check (company_id = point_of_sale.current_company_id() and point_of_sale.is_company_manager());

-- customers
drop policy if exists customers_all on point_of_sale.customers;
create policy customers_all on point_of_sale.customers
  for all using (company_id = point_of_sale.current_company_id())
  with check (company_id = point_of_sale.current_company_id());

-- sales (read all roles; update/void manager-gated; insert handled by RPC but allowed for company)
drop policy if exists sales_read on point_of_sale.sales;
create policy sales_read on point_of_sale.sales
  for select using (company_id = point_of_sale.current_company_id());
drop policy if exists sales_insert on point_of_sale.sales;
create policy sales_insert on point_of_sale.sales
  for insert with check (company_id = point_of_sale.current_company_id());
drop policy if exists sales_update on point_of_sale.sales;
create policy sales_update on point_of_sale.sales
  for update using (company_id = point_of_sale.current_company_id() and point_of_sale.is_company_manager());

-- sale_items
drop policy if exists sale_items_read on point_of_sale.sale_items;
create policy sale_items_read on point_of_sale.sale_items
  for select using (company_id = point_of_sale.current_company_id());
drop policy if exists sale_items_insert on point_of_sale.sale_items;
create policy sale_items_insert on point_of_sale.sale_items
  for insert with check (company_id = point_of_sale.current_company_id());

-- sale_returns
drop policy if exists returns_read on point_of_sale.sale_returns;
create policy returns_read on point_of_sale.sale_returns
  for select using (company_id = point_of_sale.current_company_id());
drop policy if exists returns_write on point_of_sale.sale_returns;
create policy returns_write on point_of_sale.sale_returns
  for all using (company_id = point_of_sale.current_company_id() and point_of_sale.is_company_manager())
  with check (company_id = point_of_sale.current_company_id() and point_of_sale.is_company_manager());

-- sale_return_items (scoped through parent return)
drop policy if exists return_items_all on point_of_sale.sale_return_items;
create policy return_items_all on point_of_sale.sale_return_items
  for all using (exists (
    select 1 from point_of_sale.sale_returns r
    where r.id = sale_return_id and r.company_id = point_of_sale.current_company_id()
  ))
  with check (exists (
    select 1 from point_of_sale.sale_returns r
    where r.id = sale_return_id and r.company_id = point_of_sale.current_company_id()
  ));

-- inventory_movements (read company scoped; inserts via definer functions)
drop policy if exists movements_read on point_of_sale.inventory_movements;
create policy movements_read on point_of_sale.inventory_movements
  for select using (company_id = point_of_sale.current_company_id());
drop policy if exists movements_insert on point_of_sale.inventory_movements;
create policy movements_insert on point_of_sale.inventory_movements
  for insert with check (company_id = point_of_sale.current_company_id());

-- audit_logs (admins read their company; inserts via definer functions / app)
drop policy if exists audit_read on point_of_sale.audit_logs;
create policy audit_read on point_of_sale.audit_logs
  for select using (company_id = point_of_sale.current_company_id() and point_of_sale.current_role() = 'admin');
drop policy if exists audit_insert on point_of_sale.audit_logs;
create policy audit_insert on point_of_sale.audit_logs
  for insert with check (company_id = point_of_sale.current_company_id());

-- ---------------------------------------------------------------------
-- create_sale(payload jsonb) — atomic, idempotent sale creation.
-- Consumes FIFO stock batches for COGS, decrements inventory, records
-- movements + audit. Works identically online and from the offline outbox.
-- ---------------------------------------------------------------------
create or replace function point_of_sale.create_sale(payload jsonb)
returns jsonb language plpgsql security definer set search_path = point_of_sale as $$
declare
  v_uid          uuid := auth.uid();
  v_company_id   uuid;
  v_cashier_name text;
  v_sale_id      uuid := (payload->>'id')::uuid;
  v_receipt      text := payload->>'receipt_number';
  v_discount     numeric := coalesce((payload->>'discount')::numeric, 0);
  v_amount_paid  numeric := coalesce((payload->>'amount_paid')::numeric, 0);
  v_method       text := coalesce(payload->>'payment_method', 'cash');
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
  v_cost_unit    numeric;
  v_existing     jsonb;
begin
  -- Resolve tenant + cashier from the authenticated profile.
  select company_id, full_name into v_company_id, v_cashier_name
    from point_of_sale.profiles where id = v_uid;
  if v_company_id is null then
    raise exception 'No company for current user';
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

  insert into point_of_sale.sales (
    id, company_id, receipt_number, subtotal, discount, total,
    payment_method, amount_paid, change, cashier_id, cashier_name,
    terminal_id, created_at
  ) values (
    v_sale_id, v_company_id, v_receipt, v_subtotal, v_discount, v_total,
    v_method, v_amount_paid, v_amount_paid - v_total, v_uid, v_cashier_name,
    v_terminal, v_created_at
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
    'id', v_sale_id, 'receipt_number', v_receipt, 'subtotal', v_subtotal,
    'discount', v_discount, 'total', v_total, 'payment_method', v_method,
    'amount_paid', v_amount_paid, 'change', v_amount_paid - v_total,
    'cashier_name', v_cashier_name, 'created_at', v_created_at,
    'items', payload->'items'
  );
end $$;

grant execute on function point_of_sale.create_sale(jsonb) to authenticated;
