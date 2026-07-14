-- =====================================================================
-- PointOne POS — reporting aggregate RPCs (company-scoped)
-- =====================================================================

create or replace function point_of_sale.report_summary(p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql security definer set search_path = point_of_sale as $$
declare
  v_cid uuid := point_of_sale.current_company_id();
  v_rev numeric; v_disc numeric; v_txns int; v_cogs numeric; v_refunds numeric;
begin
  select coalesce(sum(total),0), coalesce(sum(discount),0), count(*)
    into v_rev, v_disc, v_txns
    from point_of_sale.sales
    where company_id = v_cid and not is_voided and created_at >= p_from and created_at < p_to;

  select coalesce(sum(si.cost_price * si.quantity),0) into v_cogs
    from point_of_sale.sale_items si
    join point_of_sale.sales s on s.id = si.sale_id
    where s.company_id = v_cid and not s.is_voided and s.created_at >= p_from and s.created_at < p_to;

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
      on s.company_id = v_cid and not s.is_voided and s.created_at::date = d::date
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
    where s.company_id = v_cid and not s.is_voided and s.created_at >= p_from and s.created_at < p_to
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
    where company_id = v_cid and not is_voided and created_at >= p_from and created_at < p_to
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
    where company_id = v_cid and not is_voided and created_at >= p_from and created_at < p_to
    group by cashier_name
    order by revenue desc
  ) t;
  return v_result;
end $$;

grant execute on function point_of_sale.report_summary(timestamptz, timestamptz) to authenticated;
grant execute on function point_of_sale.report_sales_by_day(int) to authenticated;
grant execute on function point_of_sale.report_top_products(timestamptz, timestamptz, int) to authenticated;
grant execute on function point_of_sale.report_payment_breakdown(timestamptz, timestamptz) to authenticated;
grant execute on function point_of_sale.report_by_cashier(timestamptz, timestamptz) to authenticated;
