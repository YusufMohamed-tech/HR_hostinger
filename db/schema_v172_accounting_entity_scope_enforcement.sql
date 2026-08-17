-- Phase 2: Entity scope enforcement.
-- Adds legal_entity_id to all core accounting tables that lack it,
-- provides backfill function, and prepares for NOT NULL enforcement.

------------------------------------------------------------
-- 1. Add legal_entity_id to tables that need it
------------------------------------------------------------

ALTER TABLE public.accounting_customers
  ADD COLUMN IF NOT EXISTS legal_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE SET NULL;

ALTER TABLE public.accounting_vendors
  ADD COLUMN IF NOT EXISTS legal_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE SET NULL;

ALTER TABLE public.accounting_invoices
  ADD COLUMN IF NOT EXISTS legal_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE SET NULL;

ALTER TABLE public.accounting_expenses
  ADD COLUMN IF NOT EXISTS legal_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE SET NULL;

ALTER TABLE public.accounting_payments
  ADD COLUMN IF NOT EXISTS legal_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE SET NULL;

ALTER TABLE public.accounting_cost_centers
  ADD COLUMN IF NOT EXISTS legal_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE SET NULL;

ALTER TABLE public.banking_accounts
  ADD COLUMN IF NOT EXISTS legal_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE SET NULL;

ALTER TABLE public.banking_statements
  ADD COLUMN IF NOT EXISTS legal_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE SET NULL;

ALTER TABLE public.banking_reconciliations
  ADD COLUMN IF NOT EXISTS legal_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE SET NULL;

------------------------------------------------------------
-- 2. Indexes for entity-filtered queries
------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_accounting_customers_entity
  ON public.accounting_customers(organization_id, legal_entity_id);

CREATE INDEX IF NOT EXISTS idx_accounting_vendors_entity
  ON public.accounting_vendors(organization_id, legal_entity_id);

CREATE INDEX IF NOT EXISTS idx_accounting_invoices_entity
  ON public.accounting_invoices(organization_id, legal_entity_id);

CREATE INDEX IF NOT EXISTS idx_accounting_expenses_entity
  ON public.accounting_expenses(organization_id, legal_entity_id);

CREATE INDEX IF NOT EXISTS idx_accounting_payments_entity
  ON public.accounting_payments(organization_id, legal_entity_id);

CREATE INDEX IF NOT EXISTS idx_accounting_cost_centers_entity
  ON public.accounting_cost_centers(organization_id, legal_entity_id);

CREATE INDEX IF NOT EXISTS idx_banking_accounts_entity
  ON public.banking_accounts(organization_id, legal_entity_id);

CREATE INDEX IF NOT EXISTS idx_banking_statements_entity
  ON public.banking_statements(organization_id, legal_entity_id);

------------------------------------------------------------
-- 3. Backfill function
------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.accounting_backfill_entity_ids(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_default_entity_id uuid;
  v_counts jsonb := '{}'::jsonb;
  v_count integer;
BEGIN
  -- Find default entity
  SELECT id INTO v_default_entity_id
  FROM accounting_legal_entities
  WHERE organization_id = p_org_id AND is_default = true AND status = 'active'
  LIMIT 1;

  IF v_default_entity_id IS NULL THEN
    RAISE EXCEPTION 'No default active entity for organization %', p_org_id;
  END IF;

  -- Backfill customers
  UPDATE accounting_customers SET legal_entity_id = v_default_entity_id
  WHERE organization_id = p_org_id AND legal_entity_id IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('customers', v_count);

  -- Backfill vendors
  UPDATE accounting_vendors SET legal_entity_id = v_default_entity_id
  WHERE organization_id = p_org_id AND legal_entity_id IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('vendors', v_count);

  -- Backfill invoices
  UPDATE accounting_invoices SET legal_entity_id = v_default_entity_id
  WHERE organization_id = p_org_id AND legal_entity_id IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('invoices', v_count);

  -- Backfill expenses
  UPDATE accounting_expenses SET legal_entity_id = v_default_entity_id
  WHERE organization_id = p_org_id AND legal_entity_id IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('expenses', v_count);

  -- Backfill payments
  UPDATE accounting_payments SET legal_entity_id = v_default_entity_id
  WHERE organization_id = p_org_id AND legal_entity_id IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('payments', v_count);

  -- Backfill cost centers
  UPDATE accounting_cost_centers SET legal_entity_id = v_default_entity_id
  WHERE organization_id = p_org_id AND legal_entity_id IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('cost_centers', v_count);

  -- Backfill banking accounts
  UPDATE banking_accounts SET legal_entity_id = v_default_entity_id
  WHERE organization_id = p_org_id AND legal_entity_id IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('banking_accounts', v_count);

  -- Backfill banking statements (derive from bank account)
  UPDATE banking_statements bs
  SET legal_entity_id = ba.legal_entity_id
  FROM banking_accounts ba
  WHERE bs.bank_account_id = ba.id
    AND bs.organization_id = p_org_id
    AND bs.legal_entity_id IS NULL
    AND ba.legal_entity_id IS NOT NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('banking_statements', v_count);

  -- Backfill banking reconciliations
  UPDATE banking_reconciliations br
  SET legal_entity_id = ba.legal_entity_id
  FROM banking_accounts ba
  WHERE br.bank_account_id = ba.id
    AND br.organization_id = p_org_id
    AND br.legal_entity_id IS NULL
    AND ba.legal_entity_id IS NOT NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('banking_reconciliations', v_count);

  -- Backfill accounts (already has column from v112)
  UPDATE accounting_accounts SET legal_entity_id = v_default_entity_id
  WHERE organization_id = p_org_id AND legal_entity_id IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('accounts', v_count);

  -- Backfill journal entries (already has column from v112)
  UPDATE accounting_journal_entries SET legal_entity_id = v_default_entity_id
  WHERE organization_id = p_org_id AND legal_entity_id IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('journal_entries', v_count);

  RETURN jsonb_build_object(
    'organization_id', p_org_id,
    'default_entity_id', v_default_entity_id,
    'backfilled_counts', v_counts
  );
END;
$$;

------------------------------------------------------------
-- 4. Entity audit: count NULLs per table
------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.accounting_entity_audit(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb := '{}'::jsonb;
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM accounting_accounts WHERE organization_id = p_org_id AND legal_entity_id IS NULL;
  v_result := v_result || jsonb_build_object('accounts_null_entity', v_count);

  SELECT count(*) INTO v_count FROM accounting_journal_entries WHERE organization_id = p_org_id AND legal_entity_id IS NULL;
  v_result := v_result || jsonb_build_object('journal_entries_null_entity', v_count);

  SELECT count(*) INTO v_count FROM accounting_customers WHERE organization_id = p_org_id AND legal_entity_id IS NULL;
  v_result := v_result || jsonb_build_object('customers_null_entity', v_count);

  SELECT count(*) INTO v_count FROM accounting_vendors WHERE organization_id = p_org_id AND legal_entity_id IS NULL;
  v_result := v_result || jsonb_build_object('vendors_null_entity', v_count);

  SELECT count(*) INTO v_count FROM accounting_invoices WHERE organization_id = p_org_id AND legal_entity_id IS NULL;
  v_result := v_result || jsonb_build_object('invoices_null_entity', v_count);

  SELECT count(*) INTO v_count FROM accounting_expenses WHERE organization_id = p_org_id AND legal_entity_id IS NULL;
  v_result := v_result || jsonb_build_object('expenses_null_entity', v_count);

  SELECT count(*) INTO v_count FROM accounting_payments WHERE organization_id = p_org_id AND legal_entity_id IS NULL;
  v_result := v_result || jsonb_build_object('payments_null_entity', v_count);

  SELECT count(*) INTO v_count FROM accounting_cost_centers WHERE organization_id = p_org_id AND legal_entity_id IS NULL;
  v_result := v_result || jsonb_build_object('cost_centers_null_entity', v_count);

  SELECT count(*) INTO v_count FROM banking_accounts WHERE organization_id = p_org_id AND legal_entity_id IS NULL;
  v_result := v_result || jsonb_build_object('banking_accounts_null_entity', v_count);

  SELECT count(*) INTO v_count FROM banking_statements WHERE organization_id = p_org_id AND legal_entity_id IS NULL;
  v_result := v_result || jsonb_build_object('banking_statements_null_entity', v_count);

  SELECT count(*) INTO v_count FROM accounting_user_scopes WHERE organization_id = p_org_id AND is_active = true;
  v_result := v_result || jsonb_build_object('active_user_scopes', v_count);

  RETURN v_result;
END;
$$;
