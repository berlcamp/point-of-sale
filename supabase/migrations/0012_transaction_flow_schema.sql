-- =====================================================================
-- PointOne POS — two-stage (cashier booth) transactions: schema only.
--
-- A store practises ONE of two transaction flows:
--
--   direct         the sales person takes payment and hands over the
--                  receipt at the POS. The sale is COMPLETED the moment
--                  it is rung up. (Today's behaviour, and the default.)
--
--   cashier_booth  the sales person rings up the cart and the sale is
--                  left PENDING with a short ticket number. The customer
--                  carries that number and their money to the cashier
--                  booth, where the cashier records the payment, marks
--                  the sale completed, prints the receipt and gives the
--                  change.
--
-- Splitting the enum value and the column additions into their own
-- migration is deliberate: Postgres refuses to USE a value added to an
-- existing enum inside the transaction that added it, and every
-- migration file runs in one transaction. 0013 holds everything that
-- reads 'booth_cashier'.
-- =====================================================================

alter type point_of_sale.user_role add value if not exists 'booth_cashier';

do $$ begin
  create type point_of_sale.sale_status as enum ('pending', 'completed');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Per-company setting
-- ---------------------------------------------------------------------
alter table point_of_sale.companies
  add column if not exists transaction_flow text not null default 'direct';

do $$ begin
  alter table point_of_sale.companies
    add constraint companies_transaction_flow_check
    check (transaction_flow in ('direct', 'cashier_booth'));
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Sales gain a lifecycle. Existing rows were all paid at the register,
-- so the default backfills them as 'completed'.
-- ---------------------------------------------------------------------
alter table point_of_sale.sales
  add column if not exists status point_of_sale.sale_status not null default 'completed',
  add column if not exists ticket_number int,
  add column if not exists completed_at timestamptz,
  add column if not exists completed_by uuid references auth.users(id) on delete set null,
  add column if not exists completed_by_name text;

-- A pending sale has not been paid yet, so it has no payment method —
-- storing a placeholder 'cash' would lie to the payment reports.
alter table point_of_sale.sales
  alter column payment_method drop not null,
  alter column payment_method drop default;

do $$ begin
  alter table point_of_sale.sales
    add constraint sales_completed_has_payment_method
    check (status = 'pending' or payment_method is not null);
exception when duplicate_object then null; end $$;

-- The booth's work queue.
create index if not exists idx_sales_pending
  on point_of_sale.sales (company_id, created_at)
  where status = 'pending' and not is_voided;

-- ---------------------------------------------------------------------
-- Ticket numbers.
--
-- Short and read-aloud-able (#001…#999), handed to the customer to carry
-- to the booth. They wrap at 999 rather than resetting on a calendar day:
-- a ticket is only live for the few minutes between checkout and payment,
-- so a rolling counter is unambiguous in practice and avoids pinning the
-- rollover to a timezone the platform does not track. The receipt number
-- remains the permanent, unique identifier for a sale.
-- ---------------------------------------------------------------------
create table if not exists point_of_sale.ticket_counters (
  company_id  uuid primary key references point_of_sale.companies(id) on delete cascade,
  last_number int not null default 0,
  updated_at  timestamptz not null default now()
);

-- No policies: only the SECURITY DEFINER functions in 0013 touch this table,
-- and RLS with no policy denies every direct client read or write.
alter table point_of_sale.ticket_counters enable row level security;
