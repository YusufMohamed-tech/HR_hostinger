-- Post each monthly asset-depreciation batch and advance asset counters in one transaction.

CREATE TABLE IF NOT EXISTS public.asset_depreciation_runs (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  month date NOT NULL CHECK (month = date_trunc('month', month)::date),
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed')),
  journal_entry_id uuid REFERENCES public.accounting_journal_entries(id) ON DELETE RESTRICT,
  assets_processed integer NOT NULL DEFAULT 0 CHECK (assets_processed >= 0),
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (org_id, month)
);
ALTER TABLE public.asset_depreciation_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY asset_depreciation_runs_service_only ON public.asset_depreciation_runs FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.run_asset_depreciation(
  p_org_id uuid, p_actor_user_id uuid, p_request_id uuid, p_command_id uuid, p_month date
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  run_row public.asset_depreciation_runs%ROWTYPE;
  settings_row public.accounting_settings%ROWTYPE;
  journal_row public.accounting_journal_entries%ROWTYPE;
  asset_ids uuid[];
  lines_value jsonb;
  assets_count integer := 0;
  month_start date := date_trunc('month', p_month)::date;
  month_end date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  event_payload jsonb;
  event_id uuid;
  result_value jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  IF p_month IS DISTINCT FROM month_start THEN RAISE EXCEPTION 'Depreciation month must be the first day.' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.org_members WHERE org_id = p_org_id AND user_id = p_actor_user_id
    AND role::text = 'finance_manager') THEN
    RAISE EXCEPTION 'Finance Manager access is required.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO run_row FROM public.asset_depreciation_runs
    WHERE org_id = p_org_id AND month = month_start FOR UPDATE;
  IF run_row.id IS NOT NULL THEN
    IF run_row.status = 'completed' THEN RETURN run_row.result; END IF;
    RAISE EXCEPTION 'Depreciation month is already processing.' USING ERRCODE = '40001';
  END IF;
  INSERT INTO public.asset_depreciation_runs (id, org_id, month, actor_user_id, request_id)
  VALUES (p_command_id, p_org_id, month_start, p_actor_user_id, p_request_id) RETURNING * INTO run_row;
  SELECT * INTO settings_row FROM public.accounting_settings WHERE organization_id = p_org_id;
  IF settings_row.id IS NULL OR NOT COALESCE(settings_row.auto_post_assets, false) THEN
    result_value := jsonb_build_object('journalEntryId', NULL, 'assetsProcessed', 0, 'status', 'disabled');
    UPDATE public.asset_depreciation_runs SET status = 'completed', completed_at = now(), result = result_value
      WHERE id = run_row.id;
    RETURN result_value;
  END IF;
  IF settings_row.default_depreciation_expense_id IS NULL OR settings_row.default_accumulated_depreciation_id IS NULL THEN
    RAISE EXCEPTION 'Depreciation accounts are not configured.' USING ERRCODE = '23514';
  END IF;
  PERFORM 1 FROM public.asset_inventory asset
  WHERE asset.org_id = p_org_id AND asset.purchase_price > asset.salvage_value
    AND round((asset.purchase_price - asset.salvage_value) / asset.useful_life_months, 2) > 0
    AND asset.capitalized_journal_id IS NOT NULL AND asset.purchase_date <= month_end
    AND asset.months_depreciated < asset.useful_life_months
    AND (asset.last_depreciation_date IS NULL OR asset.last_depreciation_date < month_start)
    AND asset.status NOT IN ('lost', 'retired')
  FOR UPDATE;
  SELECT array_agg(asset.id ORDER BY asset.id), count(*)::integer INTO asset_ids, assets_count
  FROM public.asset_inventory asset
  WHERE asset.org_id = p_org_id AND asset.purchase_price > asset.salvage_value
    AND round((asset.purchase_price - asset.salvage_value) / asset.useful_life_months, 2) > 0
    AND asset.capitalized_journal_id IS NOT NULL AND asset.purchase_date <= month_end
    AND asset.months_depreciated < asset.useful_life_months
    AND (asset.last_depreciation_date IS NULL OR asset.last_depreciation_date < month_start)
    AND asset.status NOT IN ('lost', 'retired');
  IF assets_count = 0 THEN
    result_value := jsonb_build_object('journalEntryId', NULL, 'assetsProcessed', 0, 'status', 'completed');
    UPDATE public.asset_depreciation_runs SET status = 'completed', completed_at = now(), result = result_value
      WHERE id = run_row.id;
    RETURN result_value;
  END IF;
  SELECT jsonb_agg(line ORDER BY asset_id, line_order) INTO lines_value FROM (
    SELECT asset.id AS asset_id, 1 AS line_order, jsonb_build_object(
      'account_id', settings_row.default_depreciation_expense_id, 'debit',
      round((asset.purchase_price - asset.salvage_value) / asset.useful_life_months, 2), 'credit', 0,
      'description', 'Asset depreciation: ' || asset.asset_name || ' - ' || to_char(month_start, 'YYYY-MM')) AS line
    FROM public.asset_inventory asset WHERE asset.id = ANY(asset_ids)
    UNION ALL
    SELECT asset.id, 2, jsonb_build_object(
      'account_id', settings_row.default_accumulated_depreciation_id, 'debit', 0, 'credit',
      round((asset.purchase_price - asset.salvage_value) / asset.useful_life_months, 2),
      'description', 'Accumulated depreciation: ' || asset.asset_name || ' - ' || to_char(month_start, 'YYYY-MM'))
    FROM public.asset_inventory asset WHERE asset.id = ANY(asset_ids)
  ) lines;
  SELECT * INTO journal_row FROM public.accounting_save_journal(
    p_org_id, p_actor_user_id, p_command_id, p_request_id, NULL, 0,
    jsonb_build_object('entryDate', month_end, 'description', 'Asset depreciation for ' || to_char(month_start, 'YYYY-MM'),
      'notes', 'Atomic depreciation of ' || assets_count || ' assets', 'sourceModule', 'asset_depreciation',
      'sourceId', p_command_id, 'status', 'posted', 'lines', lines_value)
  );
  UPDATE public.asset_inventory SET last_depreciation_date = month_end,
    months_depreciated = months_depreciated + 1, updated_by = p_actor_user_id, version = version + 1
  WHERE id = ANY(asset_ids);
  result_value := jsonb_build_object('journalEntryId', journal_row.id, 'assetsProcessed', assets_count, 'status', 'completed');
  event_payload := jsonb_build_object('event_type', 'asset.depreciation_posted',
    'journal_entry_id', journal_row.id, 'month', to_char(month_start, 'YYYY-MM'),
    'assets_processed', assets_count, 'actor_user_id', p_actor_user_id);
  INSERT INTO public.business_events (org_id, source_type, business_key, payload, payload_hash, status,
    request_id, actor_user_id, occurred_at, processed_at)
  VALUES (p_org_id, 'asset', 'depreciation:' || to_char(month_start, 'YYYY-MM'), event_payload,
    encode(digest(event_payload::text, 'sha256'), 'hex'), 'completed', p_request_id, p_actor_user_id, now(), now())
  RETURNING id INTO event_id;
  INSERT INTO public.event_outbox (org_id, business_event_id, topic, payload, payload_hash)
  VALUES (p_org_id, event_id, 'asset.depreciation_posted', event_payload, encode(digest(event_payload::text, 'sha256'), 'hex'));
  UPDATE public.asset_depreciation_runs SET status = 'completed', journal_entry_id = journal_row.id,
    assets_processed = assets_count, completed_at = now(), result = result_value WHERE id = run_row.id;
  RETURN result_value;
END;
$$;

REVOKE ALL ON FUNCTION public.run_asset_depreciation(uuid, uuid, uuid, uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_asset_depreciation(uuid, uuid, uuid, uuid, date) TO service_role;
