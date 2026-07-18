-- ---------------------------------------------------------------------
-- Collectibles: settle cheque / terms sales.
-- Cheque and terms sales are receivables until an admin/manager marks
-- them paid. Cash sales never enter this flow.
-- ---------------------------------------------------------------------
alter table point_of_sale.sales
  add column if not exists settled_at timestamptz,
  add column if not exists settled_by_name text;

-- Fast lookup of outstanding collectibles per company.
create index if not exists idx_sales_unsettled
  on point_of_sale.sales (company_id, created_at)
  where payment_method in ('cheque', 'terms')
    and settled_at is null
    and not is_voided;

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
