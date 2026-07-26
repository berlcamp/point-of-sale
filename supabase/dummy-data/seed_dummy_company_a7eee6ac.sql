-- =====================================================================
-- DUMMY DATA SEED — for testing on a live server.
--
-- Target company: a7eee6ac-766a-48bb-ae70-b7be046750bb
-- Schema:         point_of_sale
--
-- Seeds catalog (products + units), stock (inventory + batches),
-- customers and ~45 sales transactions (with sale_items and inventory
-- movements) spread over the last ~30 days, across cash / cheque / terms.
--
-- SAFETY
--   * This is NOT a Supabase migration. Run it manually. Do not place it
--     in supabase/migrations/ or it will run on every deploy/db reset.
--   * EVERY row created here has an id beginning with 'd5eed000-'. The
--     companion reset script deletes ONLY those rows, so real data for
--     this company is never touched.
--   * Re-running requires running the reset script first (catalog inserts
--     are guarded with ON CONFLICT DO NOTHING, but sales are not).
--
-- Run:   psql "$DATABASE_URL" -f seed_dummy_company_a7eee6ac.sql
-- Reset: psql "$DATABASE_URL" -f reset_dummy_company_a7eee6ac.sql
-- =====================================================================

set search_path = point_of_sale;

do $$
declare
  v_company constant uuid := 'a7eee6ac-766a-48bb-ae70-b7be046750bb';
begin
  -- Fail loudly rather than silently orphaning FKs if the tenant is missing.
  if not exists (select 1 from point_of_sale.companies where id = v_company) then
    raise exception 'Company % not found — create it before seeding dummy data', v_company;
  end if;
  if exists (select 1 from point_of_sale.products
             where company_id = v_company and id::text like 'd5eed000-%') then
    raise exception 'Dummy data already present for company % — run the reset script first', v_company;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. Catalog: products.  ids d5eed000-...-0001-...NN
-- ---------------------------------------------------------------------
insert into point_of_sale.products (id, company_id, name, description, sku, barcode, base_price) values
  ('d5eed000-0000-0000-0001-000000000001','a7eee6ac-766a-48bb-ae70-b7be046750bb','Bottled Water 500ml','Purified drinking water','SEED-WTR-500','4801000000011',20),
  ('d5eed000-0000-0000-0001-000000000002','a7eee6ac-766a-48bb-ae70-b7be046750bb','Instant Coffee 3-in-1','Single sachet','SEED-COF-3IN1','4801000000028',12),
  ('d5eed000-0000-0000-0001-000000000003','a7eee6ac-766a-48bb-ae70-b7be046750bb','White Bread Loaf','Sliced sandwich loaf','SEED-BRD-WHT','4801000000035',55),
  ('d5eed000-0000-0000-0001-000000000004','a7eee6ac-766a-48bb-ae70-b7be046750bb','Canned Sardines 155g','In tomato sauce','SEED-SAR-155','4801000000042',28),
  ('d5eed000-0000-0000-0001-000000000005','a7eee6ac-766a-48bb-ae70-b7be046750bb','Dishwashing Liquid 250ml','Lemon scent','SEED-DWL-250','4801000000059',45),
  ('d5eed000-0000-0000-0001-000000000006','a7eee6ac-766a-48bb-ae70-b7be046750bb','Cooking Oil 1L','Palm cooking oil','SEED-OIL-1L','4801000000066',95),
  ('d5eed000-0000-0000-0001-000000000007','a7eee6ac-766a-48bb-ae70-b7be046750bb','Rice 5kg','Well-milled white rice','SEED-RICE-5KG','4801000000073',320),
  ('d5eed000-0000-0000-0001-000000000008','a7eee6ac-766a-48bb-ae70-b7be046750bb','Soft Drink 1.5L','Cola, PET bottle','SEED-SOFT-15L','4801000000080',75)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 2. Selling units. Every product sells by 'piece' (factor 1); a couple
--    also offer a bulk unit. Only 'piece' is used by the sales loop.
--    ids d5eed000-...-0002-...NN
-- ---------------------------------------------------------------------
insert into point_of_sale.product_units (id, product_id, company_id, unit_name, conversion_factor, price) values
  ('d5eed000-0000-0000-0002-000000000001','d5eed000-0000-0000-0001-000000000001','a7eee6ac-766a-48bb-ae70-b7be046750bb','piece',1,20),
  ('d5eed000-0000-0000-0002-000000000002','d5eed000-0000-0000-0001-000000000002','a7eee6ac-766a-48bb-ae70-b7be046750bb','piece',1,12),
  ('d5eed000-0000-0000-0002-000000000003','d5eed000-0000-0000-0001-000000000003','a7eee6ac-766a-48bb-ae70-b7be046750bb','piece',1,55),
  ('d5eed000-0000-0000-0002-000000000004','d5eed000-0000-0000-0001-000000000004','a7eee6ac-766a-48bb-ae70-b7be046750bb','piece',1,28),
  ('d5eed000-0000-0000-0002-000000000005','d5eed000-0000-0000-0001-000000000005','a7eee6ac-766a-48bb-ae70-b7be046750bb','piece',1,45),
  ('d5eed000-0000-0000-0002-000000000006','d5eed000-0000-0000-0001-000000000006','a7eee6ac-766a-48bb-ae70-b7be046750bb','piece',1,95),
  ('d5eed000-0000-0000-0002-000000000007','d5eed000-0000-0000-0001-000000000007','a7eee6ac-766a-48bb-ae70-b7be046750bb','piece',1,320),
  ('d5eed000-0000-0000-0002-000000000008','d5eed000-0000-0000-0001-000000000008','a7eee6ac-766a-48bb-ae70-b7be046750bb','piece',1,75),
  -- bulk units (not sold by the loop, just present for realism)
  ('d5eed000-0000-0000-0002-000000000101','d5eed000-0000-0000-0001-000000000001','a7eee6ac-766a-48bb-ae70-b7be046750bb','case',24,432),
  ('d5eed000-0000-0000-0002-000000000102','d5eed000-0000-0000-0001-000000000002','a7eee6ac-766a-48bb-ae70-b7be046750bb','box',30,330)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 3. Opening stock levels.  ids d5eed000-...-0003-...NN
-- ---------------------------------------------------------------------
insert into point_of_sale.inventory (id, product_id, company_id, quantity, low_stock) values
  ('d5eed000-0000-0000-0003-000000000001','d5eed000-0000-0000-0001-000000000001','a7eee6ac-766a-48bb-ae70-b7be046750bb',1000,50),
  ('d5eed000-0000-0000-0003-000000000002','d5eed000-0000-0000-0001-000000000002','a7eee6ac-766a-48bb-ae70-b7be046750bb',1000,50),
  ('d5eed000-0000-0000-0003-000000000003','d5eed000-0000-0000-0001-000000000003','a7eee6ac-766a-48bb-ae70-b7be046750bb',600,30),
  ('d5eed000-0000-0000-0003-000000000004','d5eed000-0000-0000-0001-000000000004','a7eee6ac-766a-48bb-ae70-b7be046750bb',800,40),
  ('d5eed000-0000-0000-0003-000000000005','d5eed000-0000-0000-0001-000000000005','a7eee6ac-766a-48bb-ae70-b7be046750bb',500,25),
  ('d5eed000-0000-0000-0003-000000000006','d5eed000-0000-0000-0001-000000000006','a7eee6ac-766a-48bb-ae70-b7be046750bb',500,25),
  ('d5eed000-0000-0000-0003-000000000007','d5eed000-0000-0000-0001-000000000007','a7eee6ac-766a-48bb-ae70-b7be046750bb',300,15),
  ('d5eed000-0000-0000-0003-000000000008','d5eed000-0000-0000-0001-000000000008','a7eee6ac-766a-48bb-ae70-b7be046750bb',700,35)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 4. FIFO stock batches (one per product) carrying cost prices.
--    ids d5eed000-...-0004-...NN
-- ---------------------------------------------------------------------
insert into point_of_sale.stock_batches (id, product_id, company_id, quantity, initial_qty, cost_price, reference, received_at, user_name) values
  ('d5eed000-0000-0000-0004-000000000001','d5eed000-0000-0000-0001-000000000001','a7eee6ac-766a-48bb-ae70-b7be046750bb',1000,1000,12,'SEED-PO-001',now() - interval '35 days','Seed Script'),
  ('d5eed000-0000-0000-0004-000000000002','d5eed000-0000-0000-0001-000000000002','a7eee6ac-766a-48bb-ae70-b7be046750bb',1000,1000,8,'SEED-PO-002',now() - interval '35 days','Seed Script'),
  ('d5eed000-0000-0000-0004-000000000003','d5eed000-0000-0000-0001-000000000003','a7eee6ac-766a-48bb-ae70-b7be046750bb',600,600,38,'SEED-PO-003',now() - interval '35 days','Seed Script'),
  ('d5eed000-0000-0000-0004-000000000004','d5eed000-0000-0000-0001-000000000004','a7eee6ac-766a-48bb-ae70-b7be046750bb',800,800,20,'SEED-PO-004',now() - interval '35 days','Seed Script'),
  ('d5eed000-0000-0000-0004-000000000005','d5eed000-0000-0000-0001-000000000005','a7eee6ac-766a-48bb-ae70-b7be046750bb',500,500,30,'SEED-PO-005',now() - interval '35 days','Seed Script'),
  ('d5eed000-0000-0000-0004-000000000006','d5eed000-0000-0000-0001-000000000006','a7eee6ac-766a-48bb-ae70-b7be046750bb',500,500,78,'SEED-PO-006',now() - interval '35 days','Seed Script'),
  ('d5eed000-0000-0000-0004-000000000007','d5eed000-0000-0000-0001-000000000007','a7eee6ac-766a-48bb-ae70-b7be046750bb',300,300,285,'SEED-PO-007',now() - interval '35 days','Seed Script'),
  ('d5eed000-0000-0000-0004-000000000008','d5eed000-0000-0000-0001-000000000008','a7eee6ac-766a-48bb-ae70-b7be046750bb',700,700,55,'SEED-PO-008',now() - interval '35 days','Seed Script')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 5. Customers.  ids d5eed000-...-0005-...NN
-- ---------------------------------------------------------------------
insert into point_of_sale.customers (id, company_id, name, phone, email, address) values
  ('d5eed000-0000-0000-0005-000000000001','a7eee6ac-766a-48bb-ae70-b7be046750bb','Maria Santos','09171234567','maria.santos@example.com','12 Rizal St, Cebu City'),
  ('d5eed000-0000-0000-0005-000000000002','a7eee6ac-766a-48bb-ae70-b7be046750bb','Juan dela Cruz','09182345678','juan.delacruz@example.com','8 Mabini Ave, Mandaue'),
  ('d5eed000-0000-0000-0005-000000000003','a7eee6ac-766a-48bb-ae70-b7be046750bb','Corner Sari-Sari Store','09193456789',null,'Purok 3, Lapu-Lapu'),
  ('d5eed000-0000-0000-0005-000000000004','a7eee6ac-766a-48bb-ae70-b7be046750bb','Ana Reyes','09204567890','ana.reyes@example.com','45 Osmeña Blvd, Cebu City')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 6. Sales transactions (~45) over the last 30 days.
--    Generates sales + sale_items + inventory_movements, decrements
--    inventory and the FIFO batch. Deterministic via setseed().
--    ids: sales d5eed000-...-0006-..  items -0007-..  movements -0008-..
-- ---------------------------------------------------------------------
do $$
declare
  v_company   constant uuid := 'a7eee6ac-766a-48bb-ae70-b7be046750bb';
  v_num_sales constant int  := 45;

  v_pids   uuid[];
  v_names  text[];
  v_prices numeric[];
  v_costs  numeric[];
  v_n      int;

  v_customers constant text[] := array[
    null, null, null, 'Maria Santos', 'Juan dela Cruz',
    'Corner Sari-Sari Store', 'Ana Reyes', null, 'Walk-in'
  ];
  v_cashiers constant text[] := array['Rosa Cruz','Mark Lim','Grace Tan'];

  i          int;
  j          int;
  k          int;
  idx        int;
  seq        int := 0;   -- global counter for item/movement ids

  item_idx   int[];
  item_qty   numeric[];

  v_sale_id  uuid;
  v_receipt  text;
  v_subtotal numeric;
  v_discount numeric;
  v_total    numeric;
  v_method   text;
  v_paid     numeric;
  v_change   numeric;
  v_cheque   date;
  v_terms    text;
  v_settled_at timestamptz;
  v_settled_by text;
  v_created  timestamptz;
  v_cashier  text;
  v_customer text;
  r          numeric;

  v_prev     numeric;
  v_new      numeric;
  v_qty      numeric;
  v_price    numeric;
  v_cost     numeric;
  v_line     numeric;
begin
  -- Reproducible pseudo-randomness so a reseed yields the same data.
  perform setseed(0.4242);

  -- Load the seeded catalog into parallel arrays (ordered by sku).
  select array_agg(p.id order by p.sku),
         array_agg(p.name order by p.sku),
         array_agg(p.base_price order by p.sku),
         array_agg(b.cost_price order by p.sku)
    into v_pids, v_names, v_prices, v_costs
    from point_of_sale.products p
    join point_of_sale.stock_batches b on b.product_id = p.id
   where p.company_id = v_company and p.sku like 'SEED-%';

  v_n := coalesce(array_length(v_pids, 1), 0);
  if v_n = 0 then
    raise exception 'No seeded products found — run steps 1-4 first';
  end if;

  for i in 1..v_num_sales loop
    -- Build a basket of 1-3 distinct-ish line items.
    k := 1 + floor(random() * 3)::int;
    item_idx := array[]::int[];
    item_qty := array[]::numeric[];
    v_subtotal := 0;

    for j in 1..k loop
      idx := 1 + floor(random() * v_n)::int;
      v_qty := 1 + floor(random() * 5)::int;
      item_idx := item_idx || idx;
      item_qty := item_qty || v_qty;
      v_subtotal := v_subtotal + v_qty * v_prices[idx];
    end loop;

    -- Occasional whole-ticket discount.
    v_discount := case when random() < 0.2 then round((v_subtotal * 0.05)::numeric, 2) else 0 end;
    v_total := v_subtotal - v_discount;

    -- When did it happen: within the last 30 days, business hours-ish.
    v_created := now()
                 - (random() * 30) * interval '1 day'
                 - (random() * 10) * interval '1 hour';

    v_cashier  := v_cashiers[1 + floor(random() * array_length(v_cashiers,1))::int];
    v_customer := v_customers[1 + floor(random() * array_length(v_customers,1))::int];

    -- Payment method mix: ~70% cash, ~15% cheque, ~15% terms.
    r := random();
    v_cheque := null; v_terms := null; v_settled_at := null; v_settled_by := null;
    if r < 0.70 then
      v_method := 'cash';
      v_paid   := ceil(v_total / 50.0) * 50;   -- rounded cash tendered
      v_change := v_paid - v_total;
    elsif r < 0.85 then
      v_method := 'cheque';
      v_cheque := (v_created + (7 + floor(random() * 24)) * interval '1 day')::date;
      v_paid   := v_total;   -- cheque tendered for the full amount
      v_change := 0;
      if random() < 0.5 then                    -- half already cleared
        v_settled_at := v_created + interval '10 days';
        v_settled_by := 'Grace Tan';
      end if;
    else
      v_method := 'terms';
      v_terms  := (array['15 days','30 days','60 days'])[1 + floor(random() * 3)::int];
      v_paid   := 0;         -- nothing tendered at the register
      v_change := 0;
      if random() < 0.5 then                    -- half already collected
        v_settled_at := v_created + interval '20 days';
        v_settled_by := 'Grace Tan';
        v_paid := v_total;   -- fully collected on settlement
      end if;
    end if;

    seq := seq + 1;
    v_sale_id := ('d5eed000-0000-0000-0006-' || lpad(to_hex(seq), 12, '0'))::uuid;
    v_receipt := 'SEED-' || lpad(i::text, 5, '0');

    insert into point_of_sale.sales (
      id, company_id, receipt_number, customer_name, subtotal, discount, total,
      payment_method, cheque_date, payment_terms, amount_paid, change,
      cashier_id, cashier_name, terminal_id, settled_at, settled_by_name, created_at
    ) values (
      v_sale_id, v_company, v_receipt, v_customer, v_subtotal, v_discount, v_total,
      v_method, v_cheque, v_terms, v_paid, v_change,
      null, v_cashier, 'POS-01', v_settled_at, v_settled_by, v_created
    );

    -- Line items + stock movements.
    for j in 1..array_length(item_idx, 1) loop
      idx   := item_idx[j];
      v_qty := item_qty[j];
      v_price := v_prices[idx];
      v_cost  := v_costs[idx];
      v_line  := v_qty * v_price;

      seq := seq + 1;
      insert into point_of_sale.sale_items (
        id, company_id, sale_id, product_id, product_name, unit_name,
        quantity, price, cost_price, discount, total
      ) values (
        ('d5eed000-0000-0000-0007-' || lpad(to_hex(seq), 12, '0'))::uuid,
        v_company, v_sale_id, v_pids[idx], v_names[idx], 'piece',
        v_qty, v_price, v_cost, 0, v_line
      );

      -- Decrement on-hand + the FIFO batch, record the movement.
      select quantity into v_prev from point_of_sale.inventory
        where product_id = v_pids[idx] for update;
      v_prev := coalesce(v_prev, 0);
      v_new  := v_prev - v_qty;

      update point_of_sale.inventory
         set quantity = v_new, updated_at = v_created
       where product_id = v_pids[idx];

      update point_of_sale.stock_batches
         set quantity = greatest(quantity - v_qty, 0)
       where product_id = v_pids[idx];

      insert into point_of_sale.inventory_movements (
        id, company_id, product_id, type, quantity, previous_qty, new_qty,
        reason, reference_id, user_name, created_at
      ) values (
        ('d5eed000-0000-0000-0008-' || lpad(to_hex(seq), 12, '0'))::uuid,
        v_company, v_pids[idx], 'SALE', v_qty, v_prev, v_new,
        'Sale ' || v_receipt, v_sale_id::text, v_cashier, v_created
      );
    end loop;
  end loop;

  raise notice 'Seeded % sales for company %', v_num_sales, v_company;
end $$;
