-- Phase 4a: Unified party model with multi-role support.
-- Adds party_roles table, financial profiles per entity, and open items.

------------------------------------------------------------
-- 1. Party roles (allows same party to be customer AND vendor)
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_party_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  party_id uuid NOT NULL REFERENCES public.accounting_parties(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('customer', 'vendor')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  effective_from date,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, party_id, role)
);

ALTER TABLE public.accounting_party_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY party_roles_org ON public.accounting_party_roles
  FOR ALL USING (organization_id = (current_setting('app.current_org_id', true))::uuid);

CREATE INDEX IF NOT EXISTS idx_party_roles_party
  ON public.accounting_party_roles(party_id, role, status);

------------------------------------------------------------
-- 2. Financial profiles per entity per party
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_party_financial_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  legal_entity_id uuid NOT NULL REFERENCES public.accounting_legal_entities(id) ON DELETE CASCADE,
  party_id uuid NOT NULL REFERENCES public.accounting_parties(id) ON DELETE CASCADE,
  ar_account_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  ap_account_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  payment_terms_days integer DEFAULT 30,
  credit_limit numeric(20,2),
  currency_code text NOT NULL DEFAULT 'SAR',
  version integer NOT NULL DEFAULT 1,
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, legal_entity_id, party_id)
);

ALTER TABLE public.accounting_party_financial_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY party_profiles_org ON public.accounting_party_financial_profiles
  FOR ALL USING (organization_id = (current_setting('app.current_org_id', true))::uuid);

CREATE INDEX IF NOT EXISTS idx_party_profiles_entity
  ON public.accounting_party_financial_profiles(legal_entity_id, party_id);

------------------------------------------------------------
-- 3. Add is_related_party flag to accounting_parties
------------------------------------------------------------

ALTER TABLE public.accounting_parties
  ADD COLUMN IF NOT EXISTS is_related_party boolean NOT NULL DEFAULT false;

ALTER TABLE public.accounting_parties
  ADD COLUMN IF NOT EXISTS related_party_type text;

------------------------------------------------------------
-- 4. Open items (canonical outstanding balance source)
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_open_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  legal_entity_id uuid NOT NULL REFERENCES public.accounting_legal_entities(id) ON DELETE CASCADE,
  book_id uuid REFERENCES public.accounting_books(id),
  party_id uuid NOT NULL REFERENCES public.accounting_parties(id) ON DELETE CASCADE,
  side text NOT NULL CHECK (side IN ('receivable', 'payable')),
  source_type text NOT NULL CHECK (source_type IN (
    'customer_invoice', 'vendor_expense', 'vendor_bill',
    'credit_note', 'debit_note', 'nontrade', 'opening_balance'
  )),
  source_id uuid NOT NULL,
  document_no text,
  document_date date NOT NULL,
  due_date date,
  account_id uuid NOT NULL REFERENCES public.accounting_accounts(id),
  currency_code text NOT NULL DEFAULT 'SAR',
  original_amount numeric(20,2) NOT NULL CHECK (original_amount > 0),
  settled_amount numeric(20,2) NOT NULL DEFAULT 0 CHECK (settled_amount >= 0),
  outstanding_amount numeric(20,2) GENERATED ALWAYS AS (original_amount - settled_amount) STORED,
  status text NOT NULL DEFAULT 'open' CHECK (status IN (
    'open', 'partially_settled', 'settled', 'reversed', 'cancelled'
  )),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, source_type, source_id, side),
  CHECK (settled_amount <= original_amount)
);

ALTER TABLE public.accounting_open_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY open_items_org ON public.accounting_open_items
  FOR ALL USING (organization_id = (current_setting('app.current_org_id', true))::uuid);

CREATE INDEX IF NOT EXISTS idx_open_items_party
  ON public.accounting_open_items(party_id, side, status);

CREATE INDEX IF NOT EXISTS idx_open_items_due
  ON public.accounting_open_items(due_date)
  WHERE status IN ('open', 'partially_settled');

CREATE INDEX IF NOT EXISTS idx_open_items_entity
  ON public.accounting_open_items(organization_id, legal_entity_id, side);

------------------------------------------------------------
-- 5. Party netting tables
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_party_nettings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  legal_entity_id uuid NOT NULL REFERENCES public.accounting_legal_entities(id) ON DELETE CASCADE,
  book_id uuid REFERENCES public.accounting_books(id),
  netting_no text NOT NULL,
  party_id uuid NOT NULL REFERENCES public.accounting_parties(id),
  netting_date date NOT NULL,
  currency_code text NOT NULL DEFAULT 'SAR',
  total_amount numeric(20,2) NOT NULL CHECK (total_amount > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'prepared', 'posted', 'reversed', 'cancelled'
  )),
  journal_entry_id uuid REFERENCES public.accounting_journal_entries(id),
  reversal_journal_entry_id uuid REFERENCES public.accounting_journal_entries(id),
  reference text,
  reason text,
  notes text,
  prepared_by uuid REFERENCES auth.users(id),
  prepared_at timestamptz,
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, netting_no)
);

ALTER TABLE public.accounting_party_nettings ENABLE ROW LEVEL SECURITY;

CREATE POLICY party_nettings_org ON public.accounting_party_nettings
  FOR ALL USING (organization_id = (current_setting('app.current_org_id', true))::uuid);

CREATE TABLE IF NOT EXISTS public.accounting_party_netting_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  netting_id uuid NOT NULL REFERENCES public.accounting_party_nettings(id) ON DELETE CASCADE,
  open_item_id uuid NOT NULL REFERENCES public.accounting_open_items(id),
  side text NOT NULL CHECK (side IN ('receivable', 'payable')),
  allocated_amount numeric(20,2) NOT NULL CHECK (allocated_amount > 0),
  account_id uuid NOT NULL REFERENCES public.accounting_accounts(id),
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  document_no text
);

CREATE INDEX IF NOT EXISTS idx_netting_lines_netting
  ON public.accounting_party_netting_lines(netting_id);

CREATE INDEX IF NOT EXISTS idx_netting_lines_item
  ON public.accounting_party_netting_lines(open_item_id);

------------------------------------------------------------
-- 6. Netting execution command
------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.execute_party_netting_command(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_command text;
  v_netting_id uuid;
  v_org_id uuid;
  v_entity_id uuid;
  v_party_id uuid;
  v_currency text;
  v_total numeric(20,2);
  v_sum_ar numeric(20,2);
  v_sum_ap numeric(20,2);
  v_line jsonb;
  v_item record;
  v_version integer;
BEGIN
  v_command := p_payload->>'command';
  v_netting_id := (p_payload->>'netting_id')::uuid;
  v_org_id := (p_payload->>'organization_id')::uuid;

  IF v_command = 'post' THEN
    -- Lock the netting record
    SELECT party_id, legal_entity_id, currency_code, total_amount, version
    INTO v_party_id, v_entity_id, v_currency, v_total, v_version
    FROM accounting_party_nettings
    WHERE id = v_netting_id AND organization_id = v_org_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Netting not found';
    END IF;

    -- Version check
    IF v_version != (p_payload->>'expected_version')::integer THEN
      RAISE EXCEPTION 'version_conflict' USING ERRCODE = '40001';
    END IF;

    -- Validate allocations balance
    SELECT
      coalesce(sum(allocated_amount) FILTER (WHERE side = 'receivable'), 0),
      coalesce(sum(allocated_amount) FILTER (WHERE side = 'payable'), 0)
    INTO v_sum_ar, v_sum_ap
    FROM accounting_party_netting_lines
    WHERE netting_id = v_netting_id;

    IF v_sum_ar != v_sum_ap OR v_sum_ar != v_total THEN
      RAISE EXCEPTION 'Netting allocations do not balance: AR=%, AP=%, total=%', v_sum_ar, v_sum_ap, v_total;
    END IF;

    -- Lock and validate each open item
    FOR v_item IN
      SELECT nl.open_item_id, nl.allocated_amount, nl.side,
             oi.outstanding_amount, oi.version AS item_version
      FROM accounting_party_netting_lines nl
      JOIN accounting_open_items oi ON oi.id = nl.open_item_id
      WHERE nl.netting_id = v_netting_id
      FOR UPDATE OF oi
    LOOP
      IF v_item.outstanding_amount < v_item.allocated_amount THEN
        RAISE EXCEPTION 'Over-allocation on open item %: outstanding=%, allocated=%',
          v_item.open_item_id, v_item.outstanding_amount, v_item.allocated_amount;
      END IF;

      -- Update settled amount
      UPDATE accounting_open_items
      SET settled_amount = settled_amount + v_item.allocated_amount,
          status = CASE
            WHEN (settled_amount + v_item.allocated_amount) >= original_amount THEN 'settled'
            ELSE 'partially_settled'
          END,
          version = version + 1,
          updated_at = now()
      WHERE id = v_item.open_item_id;
    END LOOP;

    -- Mark netting as posted
    UPDATE accounting_party_nettings
    SET status = 'posted',
        approved_at = now(),
        approved_by = (p_payload->>'actor_user_id')::uuid,
        version = version + 1,
        updated_at = now()
    WHERE id = v_netting_id;

    RETURN jsonb_build_object('status', 'posted', 'netting_id', v_netting_id);

  ELSIF v_command = 'reverse' THEN
    -- Lock netting
    SELECT party_id, total_amount, version
    INTO v_party_id, v_total, v_version
    FROM accounting_party_nettings
    WHERE id = v_netting_id AND organization_id = v_org_id AND status = 'posted'
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Posted netting not found';
    END IF;

    IF v_version != (p_payload->>'expected_version')::integer THEN
      RAISE EXCEPTION 'version_conflict' USING ERRCODE = '40001';
    END IF;

    -- Restore open items
    FOR v_item IN
      SELECT nl.open_item_id, nl.allocated_amount
      FROM accounting_party_netting_lines nl
      WHERE nl.netting_id = v_netting_id
      FOR UPDATE OF accounting_open_items
    LOOP
      UPDATE accounting_open_items
      SET settled_amount = GREATEST(0, settled_amount - v_item.allocated_amount),
          status = CASE
            WHEN (settled_amount - v_item.allocated_amount) <= 0 THEN 'open'
            ELSE 'partially_settled'
          END,
          version = version + 1,
          updated_at = now()
      WHERE id = v_item.open_item_id;
    END LOOP;

    -- Mark netting as reversed
    UPDATE accounting_party_nettings
    SET status = 'reversed',
        version = version + 1,
        updated_at = now()
    WHERE id = v_netting_id;

    RETURN jsonb_build_object('status', 'reversed', 'netting_id', v_netting_id);

  ELSE
    RAISE EXCEPTION 'Unknown netting command: %', v_command;
  END IF;
END;
$$;
