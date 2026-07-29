-- Phase 6: production hardening for serialized product inventory.
-- Adds indexed paged feeds and exact server-side operational/finance summaries
-- so large tenants never derive balances from a capped API result set.

CREATE INDEX IF NOT EXISTS product_inventory_units_org_created_idx
  ON public.product_inventory_units (organization_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS product_inventory_movements_org_date_idx
  ON public.product_inventory_movements (
    organization_id, movement_at DESC, id DESC
  );

CREATE INDEX IF NOT EXISTS product_receipts_org_created_idx
  ON public.product_receipts (organization_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS product_inventory_units_available_serial_idx
  ON public.product_inventory_units (
    organization_id, normalized_serial_number, created_at DESC
  )
  WHERE status = 'in_stock';

CREATE INDEX IF NOT EXISTS product_inventory_commands_processing_idx
  ON public.product_inventory_commands (organization_id, created_at)
  WHERE status = 'processing';

CREATE INDEX IF NOT EXISTS product_inventory_accounting_pending_idx
  ON public.product_inventory_accounting_postings (
    organization_id, updated_at, source_type, source_id
  )
  WHERE status IN ('pending', 'pending_approval', 'failed');

CREATE INDEX IF NOT EXISTS product_inventory_accounting_overdue_idx
  ON public.product_inventory_accounting_postings (updated_at, id)
  WHERE status IN ('pending', 'pending_approval');

CREATE OR REPLACE FUNCTION public.get_product_inventory_stock_summary(
  p_org_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result_value jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'Organization is required.' USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_build_object(
    'units', count(*)::integer,
    'cost', COALESCE(sum(unit.unit_cost_snapshot), 0),
    'expectedSales', COALESCE(sum(unit.planned_sale_price_snapshot), 0),
    'margin', COALESCE(sum(
      unit.planned_sale_price_snapshot - unit.unit_cost_snapshot
    ), 0)
  )
  INTO result_value
  FROM public.product_inventory_units unit
  WHERE unit.organization_id = p_org_id;

  RETURN COALESCE(
    result_value,
    '{"units":0,"cost":0,"expectedSales":0,"margin":0}'::jsonb
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_product_inventory_agent_balances(
  p_org_id uuid,
  p_agent_id uuid DEFAULT NULL
)
RETURNS TABLE (
  agent_id uuid,
  agent_name text,
  custody_units bigint,
  custody_cost numeric,
  custody_retail numeric,
  active_sales numeric,
  collected numeric,
  outstanding numeric,
  gross_profit numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'Organization is required.' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    agent.id,
    agent.full_name,
    COALESCE(custody.units, 0)::bigint,
    COALESCE(custody.cost, 0)::numeric,
    COALESCE(custody.retail, 0)::numeric,
    COALESCE(sales.total, 0)::numeric,
    COALESCE(collections.total, 0)::numeric,
    (COALESCE(sales.total, 0) - COALESCE(collections.total, 0))::numeric,
    COALESCE(profit.total, 0)::numeric
  FROM public.field_agents agent
  LEFT JOIN LATERAL (
    SELECT
      count(*) AS units,
      sum(unit.unit_cost_snapshot) AS cost,
      sum(unit.planned_sale_price_snapshot) AS retail
    FROM public.product_inventory_units unit
    WHERE unit.organization_id = p_org_id
      AND unit.current_agent_id = agent.id
      AND unit.status IN ('in_transit', 'with_agent')
  ) custody ON true
  LEFT JOIN LATERAL (
    SELECT sum(sale.total_amount) AS total
    FROM public.agent_product_sales sale
    WHERE sale.organization_id = p_org_id
      AND sale.agent_id = agent.id
      AND sale.status = 'active'
  ) sales ON true
  LEFT JOIN LATERAL (
    SELECT sum(line.gross_profit) AS total
    FROM public.agent_product_sale_lines line
    JOIN public.agent_product_sales sale
      ON sale.organization_id = line.organization_id
     AND sale.id = line.sale_id
     AND sale.status = 'active'
    WHERE line.organization_id = p_org_id
      AND sale.agent_id = agent.id
  ) profit ON true
  LEFT JOIN LATERAL (
    SELECT sum(collection.amount) AS total
    FROM public.agent_product_collections collection
    WHERE collection.organization_id = p_org_id
      AND collection.agent_id = agent.id
      AND collection.status = 'posted'
  ) collections ON true
  WHERE agent.organization_id = p_org_id
    AND agent.status = 'active'
    AND (p_agent_id IS NULL OR agent.id = p_agent_id)
  ORDER BY agent.full_name, agent.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_product_inventory_finance_summary(
  p_org_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  settings_row public.accounting_settings%ROWTYPE;
  inventory_account_ids uuid[] := ARRAY[]::uuid[];
  owned_units integer := 0;
  stock_cost numeric := 0;
  expected_sales numeric := 0;
  expected_margin numeric := 0;
  consignment_units integer := 0;
  consignment_memo_cost numeric := 0;
  sales_revenue numeric := 0;
  company_owned_sales_revenue numeric := 0;
  consignment_sales_revenue numeric := 0;
  sales_cost numeric := 0;
  gross_profit numeric := 0;
  output_vat numeric := 0;
  requested_commission numeric := 0;
  collected_value numeric := 0;
  commission_accrued numeric := 0;
  commission_settled numeric := 0;
  inventory_gl_balance numeric := 0;
  agent_receivable_gl_balance numeric := 0;
  failed_postings integer := 0;
  pending_postings integer := 0;
  missing_postings integer := 0;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'Organization is required.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO settings_row
  FROM public.accounting_settings settings
  WHERE settings.organization_id = p_org_id;

  SELECT
    count(*) FILTER (WHERE unit.ownership_type = 'purchased')::integer,
    COALESCE(sum(unit.unit_cost_snapshot)
      FILTER (WHERE unit.ownership_type = 'purchased'), 0),
    COALESCE(sum(unit.planned_sale_price_snapshot)
      FILTER (WHERE unit.ownership_type = 'purchased'), 0),
    COALESCE(sum(unit.planned_sale_price_snapshot - unit.unit_cost_snapshot)
      FILTER (WHERE unit.ownership_type = 'purchased'), 0),
    count(*) FILTER (WHERE unit.ownership_type = 'consignment')::integer,
    COALESCE(sum(unit.unit_cost_snapshot)
      FILTER (WHERE unit.ownership_type = 'consignment'), 0)
  INTO
    owned_units, stock_cost, expected_sales, expected_margin,
    consignment_units, consignment_memo_cost
  FROM public.product_inventory_units unit
  WHERE unit.organization_id = p_org_id
    AND unit.status IN (
      'in_stock', 'reserved', 'in_transit', 'with_agent',
      'returned', 'quarantine', 'damaged'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.product_inventory_loss_records loss
      WHERE loss.organization_id = unit.organization_id
        AND loss.unit_id = unit.id
        AND loss.status = 'recorded'
    );

  SELECT
    COALESCE(sum(sale.total_amount), 0),
    COALESCE(sum(sale.total_amount)
      FILTER (WHERE sale.accounting_status <> 'not_required'), 0),
    COALESCE(sum(sale.total_amount)
      FILTER (WHERE sale.accounting_status = 'not_required'), 0),
    COALESCE(sum(sale.vat_amount), 0)
  INTO
    sales_revenue, company_owned_sales_revenue,
    consignment_sales_revenue, output_vat
  FROM public.agent_product_sales sale
  WHERE sale.organization_id = p_org_id
    AND sale.status = 'active';

  SELECT
    COALESCE(sum(line.unit_cost_snapshot), 0),
    COALESCE(sum(line.gross_profit), 0),
    COALESCE(sum(line.agent_commission_amount), 0)
  INTO sales_cost, gross_profit, requested_commission
  FROM public.agent_product_sale_lines line
  JOIN public.agent_product_sales sale
    ON sale.organization_id = line.organization_id
   AND sale.id = line.sale_id
   AND sale.status = 'active'
  WHERE line.organization_id = p_org_id;

  SELECT COALESCE(sum(collection.amount), 0)
  INTO collected_value
  FROM public.agent_product_collections collection
  WHERE collection.organization_id = p_org_id
    AND collection.status = 'posted';

  SELECT
    COALESCE(sum(commission.commission_amount)
      FILTER (WHERE commission.status = 'accrued'), 0),
    COALESCE(sum(commission.commission_amount)
      FILTER (WHERE commission.status = 'settled'), 0)
  INTO commission_accrued, commission_settled
  FROM public.product_agent_commissions commission
  WHERE commission.organization_id = p_org_id;

  SELECT
    count(*) FILTER (WHERE posting.status = 'failed')::integer,
    count(*) FILTER (
      WHERE posting.status IN ('pending', 'pending_approval')
    )::integer
  INTO failed_postings, pending_postings
  FROM public.product_inventory_accounting_postings posting
  WHERE posting.organization_id = p_org_id;

  SELECT count(*)::integer INTO missing_postings
  FROM (
    SELECT 'receipt'::text AS source_type, receipt.id
    FROM public.product_receipts receipt
    WHERE receipt.organization_id = p_org_id
      AND receipt.status = 'confirmed'
      AND receipt.accounting_status NOT IN ('posted', 'not_required', 'reversed')
    UNION ALL
    SELECT 'sale', sale.id
    FROM public.agent_product_sales sale
    WHERE sale.organization_id = p_org_id
      AND sale.accounting_status NOT IN ('posted', 'not_required', 'reversed')
    UNION ALL
    SELECT 'collection', collection.id
    FROM public.agent_product_collections collection
    WHERE collection.organization_id = p_org_id
      AND collection.status = 'posted'
      AND collection.accounting_status NOT IN ('posted', 'not_required', 'reversed')
    UNION ALL
    SELECT 'loss', loss.id
    FROM public.product_inventory_loss_records loss
    WHERE loss.organization_id = p_org_id
      AND loss.status = 'recorded'
      AND loss.accounting_status NOT IN ('posted', 'not_required', 'reversed')
  ) source
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.product_inventory_accounting_postings posting
    WHERE posting.organization_id = p_org_id
      AND posting.source_type = source.source_type
      AND posting.source_id = source.id
  );
  pending_postings := pending_postings + missing_postings;

  SELECT COALESCE(array_agg(DISTINCT account_id), ARRAY[]::uuid[])
  INTO inventory_account_ids
  FROM (
    SELECT settings_row.default_inventory_asset_id AS account_id
    UNION ALL
    SELECT product.inventory_account_id
    FROM public.sales_products product
    WHERE product.organization_id = p_org_id
    UNION ALL
    SELECT line.inventory_account_id
    FROM public.agent_product_sale_lines line
    WHERE line.organization_id = p_org_id
  ) account
  WHERE account_id IS NOT NULL;

  SELECT COALESCE(sum(line.debit - line.credit), 0)
  INTO inventory_gl_balance
  FROM public.accounting_journal_lines line
  JOIN public.accounting_journal_entries entry
    ON entry.organization_id = line.organization_id
   AND entry.id = line.journal_entry_id
  WHERE line.organization_id = p_org_id
    AND line.account_id = ANY(inventory_account_ids)
    AND entry.status IN ('posted', 'reversed');

  IF settings_row.default_agent_receivable_id IS NOT NULL THEN
    SELECT COALESCE(sum(line.debit - line.credit), 0)
    INTO agent_receivable_gl_balance
    FROM public.accounting_journal_lines line
    JOIN public.accounting_journal_entries entry
      ON entry.organization_id = line.organization_id
     AND entry.id = line.journal_entry_id
    WHERE line.organization_id = p_org_id
      AND line.account_id = settings_row.default_agent_receivable_id
      AND entry.status IN ('posted', 'reversed');
  END IF;

  RETURN jsonb_build_object(
    'units', owned_units,
    'cost', stock_cost,
    'expectedSales', expected_sales,
    'margin', expected_margin,
    'consignmentUnits', consignment_units,
    'consignmentMemoCost', consignment_memo_cost,
    'salesRevenue', sales_revenue,
    'companyOwnedSalesRevenue', company_owned_sales_revenue,
    'consignmentSalesRevenue', consignment_sales_revenue,
    'salesCost', sales_cost,
    'grossProfit', gross_profit,
    'vat', output_vat,
    'commission', requested_commission,
    'commissionAccrued', commission_accrued,
    'commissionSettled', commission_settled,
    'collected', collected_value,
    'outstanding', sales_revenue - collected_value,
    'failedPostings', failed_postings,
    'pendingPostings', pending_postings,
    'inventoryGlBalance', inventory_gl_balance,
    'agentReceivableGlBalance', agent_receivable_gl_balance
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_product_inventory_stock_summary(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_product_inventory_agent_balances(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_product_inventory_finance_summary(uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_product_inventory_stock_summary(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_product_inventory_agent_balances(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_product_inventory_finance_summary(uuid)
  TO service_role;

COMMENT ON FUNCTION public.get_product_inventory_stock_summary(uuid) IS
  'Returns exact uncapped serialized inventory register totals for server APIs.';
COMMENT ON FUNCTION public.get_product_inventory_agent_balances(uuid, uuid) IS
  'Returns exact agent custody and commercial balances without relying on paged detail rows.';
COMMENT ON FUNCTION public.get_product_inventory_finance_summary(uuid) IS
  'Returns exact inventory subledger, sales, collection, posting, and GL reconciliation totals.';
