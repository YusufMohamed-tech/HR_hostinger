-- Editable SIM package commission rules and finance settlement metadata.
-- Additive only: package rules are editable going forward, sale-time values stay snapshotted.

-- ---------------------------------------------------------------------------
-- 1. Package-level commission rules
-- ---------------------------------------------------------------------------
ALTER TABLE public.sim_packages
  ADD COLUMN IF NOT EXISTS commission_currency text;
ALTER TABLE public.sim_packages
  ADD COLUMN IF NOT EXISTS total_commission_type text;
ALTER TABLE public.sim_packages
  ADD COLUMN IF NOT EXISTS total_commission_value numeric(12,2);
ALTER TABLE public.sim_packages
  ADD COLUMN IF NOT EXISTS agent_chain_commission_type text;
ALTER TABLE public.sim_packages
  ADD COLUMN IF NOT EXISTS agent_chain_commission_value numeric(12,2);
ALTER TABLE public.sim_packages
  ADD COLUMN IF NOT EXISTS direct_agent_commission_type text;
ALTER TABLE public.sim_packages
  ADD COLUMN IF NOT EXISTS direct_agent_commission_value numeric(12,2);
ALTER TABLE public.sim_packages
  ADD COLUMN IF NOT EXISTS commission_notes text;
ALTER TABLE public.sim_packages
  ADD COLUMN IF NOT EXISTS commission_updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.sim_packages
  ADD COLUMN IF NOT EXISTS commission_updated_at timestamptz;

ALTER TABLE public.sim_packages
  ADD COLUMN IF NOT EXISTS merchant_commission_type text;
ALTER TABLE public.sim_packages
  ADD COLUMN IF NOT EXISTS merchant_commission_value numeric(12,2);

ALTER TABLE public.sim_packages
  ALTER COLUMN commission_currency SET DEFAULT 'SAR',
  ALTER COLUMN total_commission_type SET DEFAULT 'flat',
  ALTER COLUMN total_commission_value SET DEFAULT 15,
  ALTER COLUMN agent_chain_commission_type SET DEFAULT 'flat',
  ALTER COLUMN agent_chain_commission_value SET DEFAULT 5,
  ALTER COLUMN merchant_commission_type SET DEFAULT 'flat',
  ALTER COLUMN merchant_commission_value SET DEFAULT 10,
  ALTER COLUMN direct_agent_commission_type SET DEFAULT 'flat',
  ALTER COLUMN direct_agent_commission_value SET DEFAULT 15,
  ALTER COLUMN agent_commission_type SET DEFAULT 'flat',
  ALTER COLUMN agent_commission_value SET DEFAULT 5;

UPDATE public.sim_packages
SET
  commission_currency = COALESCE(NULLIF(btrim(commission_currency), ''), 'SAR'),
  agent_chain_commission_type = COALESCE(NULLIF(agent_chain_commission_type, ''), NULLIF(agent_commission_type, ''), 'flat'),
  agent_chain_commission_value = COALESCE(agent_chain_commission_value, agent_commission_value, 5),
  merchant_commission_type = COALESCE(NULLIF(merchant_commission_type, ''), 'flat'),
  merchant_commission_value = COALESCE(merchant_commission_value, 10);

-- v50 seeded packages had legacy zero commissions. Move those untouched seed rows
-- to the client-requested default split without changing user-created packages.
UPDATE public.sim_packages
SET
  agent_commission_type = 'flat',
  agent_commission_value = 5,
  agent_chain_commission_type = 'flat',
  agent_chain_commission_value = 5,
  merchant_commission_type = 'flat',
  merchant_commission_value = 10
WHERE status = 'active'
  AND created_by IS NULL
  AND COALESCE(agent_commission_value, 0) = 0
  AND COALESCE(merchant_commission_value, 0) = 0
  AND commission_updated_at IS NULL;

UPDATE public.sim_packages
SET
  total_commission_type = COALESCE(NULLIF(total_commission_type, ''), 'flat'),
  total_commission_value = COALESCE(
    total_commission_value,
    NULLIF(COALESCE(agent_chain_commission_value, 0) + COALESCE(merchant_commission_value, 0), 0),
    15
  );

UPDATE public.sim_packages
SET
  direct_agent_commission_type = COALESCE(NULLIF(direct_agent_commission_type, ''), total_commission_type, 'flat'),
  direct_agent_commission_value = COALESCE(direct_agent_commission_value, NULLIF(total_commission_value, 0), 15);

ALTER TABLE public.sim_packages
  ALTER COLUMN commission_currency SET NOT NULL,
  ALTER COLUMN total_commission_type SET NOT NULL,
  ALTER COLUMN total_commission_value SET NOT NULL,
  ALTER COLUMN agent_chain_commission_type SET NOT NULL,
  ALTER COLUMN agent_chain_commission_value SET NOT NULL,
  ALTER COLUMN merchant_commission_type SET NOT NULL,
  ALTER COLUMN merchant_commission_value SET NOT NULL,
  ALTER COLUMN direct_agent_commission_type SET NOT NULL,
  ALTER COLUMN direct_agent_commission_value SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sim_packages_commission_currency_check'
      AND conrelid = 'public.sim_packages'::regclass
  ) THEN
    ALTER TABLE public.sim_packages
      ADD CONSTRAINT sim_packages_commission_currency_check
      CHECK (btrim(commission_currency) <> '');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sim_packages_total_commission_type_check'
      AND conrelid = 'public.sim_packages'::regclass
  ) THEN
    ALTER TABLE public.sim_packages
      ADD CONSTRAINT sim_packages_total_commission_type_check
      CHECK (total_commission_type IN ('flat', 'percentage'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sim_packages_agent_chain_commission_type_check'
      AND conrelid = 'public.sim_packages'::regclass
  ) THEN
    ALTER TABLE public.sim_packages
      ADD CONSTRAINT sim_packages_agent_chain_commission_type_check
      CHECK (agent_chain_commission_type IN ('flat', 'percentage'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sim_packages_agent_commission_type_check'
      AND conrelid = 'public.sim_packages'::regclass
  ) THEN
    ALTER TABLE public.sim_packages
      ADD CONSTRAINT sim_packages_agent_commission_type_check
      CHECK (agent_commission_type IN ('flat', 'percentage'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sim_packages_merchant_commission_type_check'
      AND conrelid = 'public.sim_packages'::regclass
  ) THEN
    ALTER TABLE public.sim_packages
      ADD CONSTRAINT sim_packages_merchant_commission_type_check
      CHECK (merchant_commission_type IN ('flat', 'percentage'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sim_packages_direct_agent_commission_type_check'
      AND conrelid = 'public.sim_packages'::regclass
  ) THEN
    ALTER TABLE public.sim_packages
      ADD CONSTRAINT sim_packages_direct_agent_commission_type_check
      CHECK (direct_agent_commission_type IN ('flat', 'percentage'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sim_packages_total_commission_value_check'
      AND conrelid = 'public.sim_packages'::regclass
  ) THEN
    ALTER TABLE public.sim_packages
      ADD CONSTRAINT sim_packages_total_commission_value_check
      CHECK (total_commission_value >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sim_packages_agent_chain_commission_value_check'
      AND conrelid = 'public.sim_packages'::regclass
  ) THEN
    ALTER TABLE public.sim_packages
      ADD CONSTRAINT sim_packages_agent_chain_commission_value_check
      CHECK (agent_chain_commission_value >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sim_packages_agent_commission_value_check'
      AND conrelid = 'public.sim_packages'::regclass
  ) THEN
    ALTER TABLE public.sim_packages
      ADD CONSTRAINT sim_packages_agent_commission_value_check
      CHECK (agent_commission_value >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sim_packages_merchant_commission_value_check'
      AND conrelid = 'public.sim_packages'::regclass
  ) THEN
    ALTER TABLE public.sim_packages
      ADD CONSTRAINT sim_packages_merchant_commission_value_check
      CHECK (merchant_commission_value >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sim_packages_direct_agent_commission_value_check'
      AND conrelid = 'public.sim_packages'::regclass
  ) THEN
    ALTER TABLE public.sim_packages
      ADD CONSTRAINT sim_packages_direct_agent_commission_value_check
      CHECK (direct_agent_commission_value >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sim_packages_org_status
  ON public.sim_packages (organization_id, status);

-- ---------------------------------------------------------------------------
-- 2. Sale-time commission snapshots
-- ---------------------------------------------------------------------------
ALTER TABLE public.sim_sales
  ADD COLUMN IF NOT EXISTS commission_currency text;
ALTER TABLE public.sim_sales
  ADD COLUMN IF NOT EXISTS total_commission_amount numeric(12,2);
ALTER TABLE public.sim_sales
  ADD COLUMN IF NOT EXISTS direct_agent_commission_amount numeric(12,2);
ALTER TABLE public.sim_sales
  ADD COLUMN IF NOT EXISTS commission_rule_snapshot jsonb;

ALTER TABLE public.sim_sales
  ALTER COLUMN commission_currency SET DEFAULT 'SAR',
  ALTER COLUMN total_commission_amount SET DEFAULT 0,
  ALTER COLUMN agent_commission_amount SET DEFAULT 0,
  ALTER COLUMN merchant_commission_amount SET DEFAULT 0,
  ALTER COLUMN direct_agent_commission_amount SET DEFAULT 0,
  ALTER COLUMN commission_rule_snapshot SET DEFAULT '{}'::jsonb;

UPDATE public.sim_sales
SET
  commission_currency = COALESCE(NULLIF(btrim(commission_currency), ''), 'SAR'),
  agent_commission_amount = COALESCE(agent_commission_amount, 0),
  merchant_commission_amount = COALESCE(merchant_commission_amount, 0),
  direct_agent_commission_amount = COALESCE(direct_agent_commission_amount, 0),
  total_commission_amount = COALESCE(
    total_commission_amount,
    COALESCE(agent_commission_amount, 0) + COALESCE(merchant_commission_amount, 0) + COALESCE(direct_agent_commission_amount, 0),
    0
  ),
  commission_rule_snapshot = COALESCE(commission_rule_snapshot, '{}'::jsonb);

ALTER TABLE public.sim_sales
  ALTER COLUMN commission_rule_snapshot SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sim_sales_total_commission_amount_check'
      AND conrelid = 'public.sim_sales'::regclass
  ) THEN
    ALTER TABLE public.sim_sales
      ADD CONSTRAINT sim_sales_total_commission_amount_check
      CHECK (total_commission_amount IS NULL OR total_commission_amount >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sim_sales_direct_agent_commission_amount_check'
      AND conrelid = 'public.sim_sales'::regclass
  ) THEN
    ALTER TABLE public.sim_sales
      ADD CONSTRAINT sim_sales_direct_agent_commission_amount_check
      CHECK (direct_agent_commission_amount IS NULL OR direct_agent_commission_amount >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sim_sales_org_package_sold_at
  ON public.sim_sales (organization_id, package_id, sold_at DESC);

-- ---------------------------------------------------------------------------
-- 3. Commission finance settlement fields
-- ---------------------------------------------------------------------------
ALTER TABLE public.agent_commissions
  ADD COLUMN IF NOT EXISTS commission_currency text;
ALTER TABLE public.agent_commissions
  ADD COLUMN IF NOT EXISTS sale_id uuid;
ALTER TABLE public.agent_commissions
  ADD COLUMN IF NOT EXISTS payment_method text;
ALTER TABLE public.agent_commissions
  ADD COLUMN IF NOT EXISTS payment_reference text;
ALTER TABLE public.agent_commissions
  ADD COLUMN IF NOT EXISTS finance_notes text;

ALTER TABLE public.merchant_commissions
  ADD COLUMN IF NOT EXISTS commission_currency text;
ALTER TABLE public.merchant_commissions
  ADD COLUMN IF NOT EXISTS sale_id uuid;
ALTER TABLE public.merchant_commissions
  ADD COLUMN IF NOT EXISTS payment_method text;
ALTER TABLE public.merchant_commissions
  ADD COLUMN IF NOT EXISTS payment_reference text;
ALTER TABLE public.merchant_commissions
  ADD COLUMN IF NOT EXISTS finance_notes text;

ALTER TABLE public.agent_commissions
  ALTER COLUMN commission_currency SET DEFAULT 'SAR';
ALTER TABLE public.merchant_commissions
  ALTER COLUMN commission_currency SET DEFAULT 'SAR';

UPDATE public.agent_commissions
SET commission_currency = COALESCE(NULLIF(btrim(commission_currency), ''), 'SAR');

UPDATE public.merchant_commissions
SET commission_currency = COALESCE(NULLIF(btrim(commission_currency), ''), 'SAR');

UPDATE public.agent_commissions ac
SET sale_id = ss.id
FROM public.sim_sales ss
WHERE ac.sale_id IS NULL
  AND ac.organization_id = ss.organization_id
  AND ac.sim_unit_id = ss.sim_unit_id
  AND ac.agent_id = ss.agent_id;

UPDATE public.merchant_commissions mc
SET sale_id = ss.id
FROM public.sim_sales ss
WHERE mc.sale_id IS NULL
  AND mc.organization_id = ss.organization_id
  AND mc.sim_unit_id = ss.sim_unit_id
  AND mc.merchant_id = ss.merchant_id;

ALTER TABLE public.agent_commissions
  DROP CONSTRAINT IF EXISTS agent_commissions_paid_by_fkey;
ALTER TABLE public.agent_commissions
  ADD CONSTRAINT agent_commissions_paid_by_fkey
  FOREIGN KEY (paid_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.merchant_commissions
  DROP CONSTRAINT IF EXISTS merchant_commissions_paid_by_fkey;
ALTER TABLE public.merchant_commissions
  ADD CONSTRAINT merchant_commissions_paid_by_fkey
  FOREIGN KEY (paid_by) REFERENCES auth.users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_commissions_sale_id_fkey'
      AND conrelid = 'public.agent_commissions'::regclass
  ) THEN
    ALTER TABLE public.agent_commissions
      ADD CONSTRAINT agent_commissions_sale_id_fkey
      FOREIGN KEY (sale_id) REFERENCES public.sim_sales(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'merchant_commissions_sale_id_fkey'
      AND conrelid = 'public.merchant_commissions'::regclass
  ) THEN
    ALTER TABLE public.merchant_commissions
      ADD CONSTRAINT merchant_commissions_sale_id_fkey
      FOREIGN KEY (sale_id) REFERENCES public.sim_sales(id) ON DELETE SET NULL;
  END IF;

  IF to_regclass('public.accounting_journal_entries') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'agent_commissions'
        AND column_name = 'accounting_journal_entry_id'
    ) THEN
      ALTER TABLE public.agent_commissions
        ADD COLUMN accounting_journal_entry_id uuid REFERENCES public.accounting_journal_entries(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'merchant_commissions'
        AND column_name = 'accounting_journal_entry_id'
    ) THEN
      ALTER TABLE public.merchant_commissions
        ADD COLUMN accounting_journal_entry_id uuid REFERENCES public.accounting_journal_entries(id) ON DELETE SET NULL;
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_commissions_payment_method_check'
      AND conrelid = 'public.agent_commissions'::regclass
  ) THEN
    ALTER TABLE public.agent_commissions
      ADD CONSTRAINT agent_commissions_payment_method_check
      CHECK (payment_method IS NULL OR payment_method IN ('cash', 'bank_transfer', 'wallet', 'other'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'merchant_commissions_payment_method_check'
      AND conrelid = 'public.merchant_commissions'::regclass
  ) THEN
    ALTER TABLE public.merchant_commissions
      ADD CONSTRAINT merchant_commissions_payment_method_check
      CHECK (payment_method IS NULL OR payment_method IN ('cash', 'bank_transfer', 'wallet', 'other'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_agent_commissions_org_paid_agent
  ON public.agent_commissions (organization_id, is_paid, agent_id);
CREATE INDEX IF NOT EXISTS idx_merchant_commissions_org_paid_merchant
  ON public.merchant_commissions (organization_id, is_paid, merchant_id);
CREATE INDEX IF NOT EXISTS idx_agent_commissions_org_sale
  ON public.agent_commissions (organization_id, sale_id);
CREATE INDEX IF NOT EXISTS idx_merchant_commissions_org_sale
  ON public.merchant_commissions (organization_id, sale_id);
