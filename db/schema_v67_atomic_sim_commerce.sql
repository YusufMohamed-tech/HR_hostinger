-- Atomic SIM inventory commerce, immutable sale reversals, and reconciled
-- commission settlement batches.

ALTER TYPE public.sim_transfer_type ADD VALUE IF NOT EXISTS 'sale_voided';

ALTER TABLE public.sim_units
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 0;
ALTER TABLE public.sim_units DROP CONSTRAINT IF EXISTS sim_units_version_check;
ALTER TABLE public.sim_units ADD CONSTRAINT sim_units_version_check CHECK (version >= 0);

ALTER TABLE public.sim_sales
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS voided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS void_reason text,
  ADD COLUMN IF NOT EXISTS accounting_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS accounting_journal_entry_id uuid REFERENCES public.accounting_journal_entries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS accounting_reversal_entry_id uuid REFERENCES public.accounting_journal_entries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.sim_sales DROP CONSTRAINT IF EXISTS sim_sales_status_check;
ALTER TABLE public.sim_sales ADD CONSTRAINT sim_sales_status_check
  CHECK (status IN ('active', 'voided'));
ALTER TABLE public.sim_sales DROP CONSTRAINT IF EXISTS sim_sales_accounting_status_check;
ALTER TABLE public.sim_sales ADD CONSTRAINT sim_sales_accounting_status_check
  CHECK (accounting_status IN ('pending', 'posted', 'reversal_pending', 'reversed', 'failed'));
ALTER TABLE public.sim_sales DROP CONSTRAINT IF EXISTS sim_sales_version_check;
ALTER TABLE public.sim_sales ADD CONSTRAINT sim_sales_version_check CHECK (version > 0);
ALTER TABLE public.sim_sales DROP CONSTRAINT IF EXISTS sim_sales_sim_unit_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sim_sales_active_sim
  ON public.sim_sales(organization_id, sim_unit_id) WHERE status = 'active';

ALTER TABLE public.agent_commissions
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'accrued',
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reversal_reason text;
ALTER TABLE public.merchant_commissions
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'accrued',
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reversal_reason text;

UPDATE public.agent_commissions SET status = CASE WHEN is_paid THEN 'settled' ELSE 'accrued' END;
UPDATE public.merchant_commissions SET status = CASE WHEN is_paid THEN 'settled' ELSE 'accrued' END;

ALTER TABLE public.agent_commissions DROP CONSTRAINT IF EXISTS agent_commissions_status_check;
ALTER TABLE public.agent_commissions ADD CONSTRAINT agent_commissions_status_check
  CHECK (status IN ('accrued', 'settled', 'reversed'));
ALTER TABLE public.merchant_commissions DROP CONSTRAINT IF EXISTS merchant_commissions_status_check;
ALTER TABLE public.merchant_commissions ADD CONSTRAINT merchant_commissions_status_check
  CHECK (status IN ('accrued', 'settled', 'reversed'));
ALTER TABLE public.agent_commissions DROP CONSTRAINT IF EXISTS agent_commissions_sim_unit_id_key;
ALTER TABLE public.merchant_commissions DROP CONSTRAINT IF EXISTS merchant_commissions_sim_unit_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_commission_sale
  ON public.agent_commissions(organization_id, sale_id) WHERE sale_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_merchant_commission_sale
  ON public.merchant_commissions(organization_id, sale_id) WHERE sale_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.commission_settlement_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  beneficiary_type text NOT NULL CHECK (beneficiary_type IN ('agent', 'merchant')),
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'reversed')),
  commission_count integer NOT NULL CHECK (commission_count > 0),
  total_amount numeric(14,2) NOT NULL CHECK (total_amount > 0),
  currency text NOT NULL DEFAULT 'SAR' CHECK (length(btrim(currency)) > 0),
  payment_method text NOT NULL CHECK (payment_method IN ('cash', 'bank_transfer', 'wallet', 'other')),
  payment_reference text,
  finance_notes text,
  accounting_payment_id uuid NOT NULL REFERENCES public.accounting_payments(id) ON DELETE RESTRICT,
  accounting_journal_entry_id uuid NOT NULL REFERENCES public.accounting_journal_entries(id) ON DELETE RESTRICT,
  posted_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  posted_at timestamptz NOT NULL DEFAULT now(),
  reversed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reversed_at timestamptz,
  reversal_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.commission_settlement_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  settlement_batch_id uuid NOT NULL REFERENCES public.commission_settlement_batches(id) ON DELETE RESTRICT,
  beneficiary_type text NOT NULL CHECK (beneficiary_type IN ('agent', 'merchant')),
  commission_id uuid NOT NULL,
  sale_id uuid NOT NULL REFERENCES public.sim_sales(id) ON DELETE RESTRICT,
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, beneficiary_type, commission_id),
  UNIQUE (settlement_batch_id, beneficiary_type, commission_id)
);

ALTER TABLE public.agent_commissions
  ADD COLUMN IF NOT EXISTS settlement_batch_id uuid REFERENCES public.commission_settlement_batches(id) ON DELETE RESTRICT;
ALTER TABLE public.merchant_commissions
  ADD COLUMN IF NOT EXISTS settlement_batch_id uuid REFERENCES public.commission_settlement_batches(id) ON DELETE RESTRICT;

ALTER TABLE public.accounting_settings
  ADD COLUMN IF NOT EXISTS default_commission_expense_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS default_commission_payable_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL;

INSERT INTO public.accounting_accounts (
  organization_id, code, name_ar, name_en, type, subtype, normal_balance, is_system
)
SELECT id, '2250', 'عمولات مستحقة الدفع', 'Commissions Payable', 'liability', 'commission_payable', 'credit', true
FROM public.organizations
ON CONFLICT (organization_id, code) DO UPDATE SET
  name_ar = EXCLUDED.name_ar, name_en = EXCLUDED.name_en, type = EXCLUDED.type,
  subtype = EXCLUDED.subtype, normal_balance = EXCLUDED.normal_balance,
  is_system = true, updated_at = now();

UPDATE public.accounting_settings settings SET
  default_commission_expense_id = COALESCE(settings.default_commission_expense_id, expense.id),
  default_commission_payable_id = COALESCE(settings.default_commission_payable_id, payable.id),
  updated_at = now()
FROM public.accounting_accounts expense, public.accounting_accounts payable
WHERE expense.organization_id = settings.organization_id AND expense.code = '5020'
  AND payable.organization_id = settings.organization_id AND payable.code = '2250';

CREATE OR REPLACE FUNCTION public.ensure_sim_finance_defaults()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE expense_id uuid; payable_id uuid;
BEGIN
  INSERT INTO public.accounting_accounts (
    organization_id, code, name_ar, name_en, type, subtype, normal_balance, is_system
  ) VALUES
    (NEW.id, '5020', 'مصروف العمولات', 'Commissions Expense', 'expense', 'commissions', 'debit', true),
    (NEW.id, '2250', 'عمولات مستحقة الدفع', 'Commissions Payable', 'liability', 'commission_payable', 'credit', true)
  ON CONFLICT (organization_id, code) DO UPDATE SET is_system = true, updated_at = now();
  SELECT id INTO expense_id FROM public.accounting_accounts WHERE organization_id = NEW.id AND code = '5020';
  SELECT id INTO payable_id FROM public.accounting_accounts WHERE organization_id = NEW.id AND code = '2250';
  INSERT INTO public.accounting_settings (
    organization_id, default_commission_expense_id, default_commission_payable_id
  ) VALUES (NEW.id, expense_id, payable_id)
  ON CONFLICT (organization_id) DO UPDATE SET
    default_commission_expense_id = COALESCE(public.accounting_settings.default_commission_expense_id, EXCLUDED.default_commission_expense_id),
    default_commission_payable_id = COALESCE(public.accounting_settings.default_commission_payable_id, EXCLUDED.default_commission_payable_id),
    updated_at = now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS ensure_sim_finance_defaults_trigger ON public.organizations;
CREATE TRIGGER ensure_sim_finance_defaults_trigger AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.ensure_sim_finance_defaults();

CREATE TABLE IF NOT EXISTS public.sim_commerce_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  idempotency_key uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('sale', 'return', 'void', 'commission_settle')),
  entity_id uuid,
  payload_hash text NOT NULL CHECK (length(payload_hash) = 64),
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed')),
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (organization_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS sim_commerce_commands_org_created_idx
  ON public.sim_commerce_commands(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS commission_settlement_batches_org_posted_idx
  ON public.commission_settlement_batches(organization_id, posted_at DESC);

ALTER TABLE public.commission_settlement_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_settlement_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sim_commerce_commands ENABLE ROW LEVEL SECURITY;

CREATE POLICY commission_settlement_batches_select ON public.commission_settlement_batches
  FOR SELECT USING (auth.role() = 'service_role' OR (
    organization_id = public.current_org_id() AND public.can_view_accounting()
  ));
CREATE POLICY commission_settlement_lines_select ON public.commission_settlement_lines
  FOR SELECT USING (auth.role() = 'service_role' OR (
    organization_id = public.current_org_id() AND public.can_view_accounting()
  ));
CREATE POLICY sim_commerce_commands_select ON public.sim_commerce_commands
  FOR SELECT USING (auth.role() = 'service_role' OR (
    organization_id = public.current_org_id() AND public.can_manage_field_agents()
  ));

-- All mutable SIM commerce tables are command-owned. Browser sessions keep
-- their scoped SELECT access but cannot bypass row locks or event creation.
DROP POLICY IF EXISTS sim_units_write ON public.sim_units;
DROP POLICY IF EXISTS sim_transfers_insert ON public.sim_transfers;
DROP POLICY IF EXISTS sim_sales_write ON public.sim_sales;
DROP POLICY IF EXISTS agent_commissions_write ON public.agent_commissions;
DROP POLICY IF EXISTS merchant_commissions_write ON public.merchant_commissions;

CREATE OR REPLACE FUNCTION public.sim_commission_amount(
  p_type text, p_value numeric, p_sale_price numeric
)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT round(CASE WHEN p_type = 'percentage' THEN p_sale_price * p_value / 100 ELSE p_value END, 2);
$$;

CREATE OR REPLACE FUNCTION public.record_sim_sale(
  p_org_id uuid, p_actor_user_id uuid, p_command_id uuid, p_request_id uuid,
  p_sim_unit_id uuid, p_package_id uuid, p_seller_type text, p_customer jsonb
)
RETURNS SETOF public.sim_sales
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  command_row public.sim_commerce_commands%ROWTYPE;
  sim_row public.sim_units%ROWTYPE;
  package_row public.sim_packages%ROWTYPE;
  agent_row public.field_agents%ROWTYPE;
  merchant_row public.merchants%ROWTYPE;
  sale_row public.sim_sales%ROWTYPE;
  actor_role_value text;
  sale_price_value numeric(14,2);
  total_amount numeric(14,2);
  agent_amount numeric(14,2);
  merchant_amount numeric(14,2) := 0;
  direct_amount numeric(14,2) := 0;
  agent_type text;
  agent_value numeric;
  merchant_type text;
  merchant_value numeric;
  snapshot jsonb;
  event_payload jsonb;
  event_id uuid;
  payload_value jsonb := jsonb_build_object(
    'sim_unit_id', p_sim_unit_id, 'package_id', p_package_id,
    'seller_type', p_seller_type, 'customer', COALESCE(p_customer, '{}'::jsonb)
  );
  hash_value text := encode(digest(payload_value::text, 'sha256'), 'hex');
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  IF p_seller_type NOT IN ('agent', 'merchant') THEN RAISE EXCEPTION 'Unsupported SIM seller type.' USING ERRCODE = '22023'; END IF;
  SELECT role::text INTO actor_role_value FROM public.org_members
    WHERE org_id = p_org_id AND user_id = p_actor_user_id;
  IF actor_role_value IS NULL THEN RAISE EXCEPTION 'Organization membership is required.' USING ERRCODE = '42501'; END IF;

  INSERT INTO public.sim_commerce_commands (
    organization_id, idempotency_key, action, entity_id, payload_hash, actor_user_id, request_id
  ) VALUES (p_org_id, p_command_id, 'sale', p_sim_unit_id, hash_value, p_actor_user_id, p_request_id)
  ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
  SELECT * INTO command_row FROM public.sim_commerce_commands
    WHERE organization_id = p_org_id AND idempotency_key = p_command_id FOR UPDATE;
  IF command_row.action <> 'sale' OR command_row.payload_hash <> hash_value THEN
    RAISE EXCEPTION 'Idempotency key was reused for a different SIM command.' USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN
    RETURN QUERY SELECT * FROM public.sim_sales
      WHERE organization_id = p_org_id AND id = (command_row.result->>'sale_id')::uuid;
    RETURN;
  END IF;

  SELECT * INTO sim_row FROM public.sim_units
    WHERE organization_id = p_org_id AND id = p_sim_unit_id FOR UPDATE;
  IF sim_row.id IS NULL THEN RAISE EXCEPTION 'SIM was not found.' USING ERRCODE = 'P0002'; END IF;

  IF p_seller_type = 'agent' THEN
    IF sim_row.status::text <> 'with_agent' OR sim_row.current_agent_id IS NULL THEN
      RAISE EXCEPTION 'SIM is not available for an agent sale.' USING ERRCODE = '55000';
    END IF;
    SELECT * INTO agent_row FROM public.field_agents
      WHERE organization_id = p_org_id AND id = sim_row.current_agent_id FOR UPDATE;
    IF agent_row.id IS NULL OR agent_row.status <> 'active' THEN
      RAISE EXCEPTION 'Selling agent is not active.' USING ERRCODE = '23514';
    END IF;
    IF actor_role_value NOT IN ('admin', 'sales_manager', 'onground_agent_manager')
       AND agent_row.user_id <> p_actor_user_id THEN
      RAISE EXCEPTION 'The actor does not own this agent inventory.' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF sim_row.status::text <> 'with_merchant' OR sim_row.current_merchant_id IS NULL THEN
      RAISE EXCEPTION 'SIM is not available for a merchant sale.' USING ERRCODE = '55000';
    END IF;
    SELECT * INTO merchant_row FROM public.merchants
      WHERE organization_id = p_org_id AND id = sim_row.current_merchant_id FOR UPDATE;
    SELECT * INTO agent_row FROM public.field_agents
      WHERE organization_id = p_org_id AND id = merchant_row.agent_id FOR UPDATE;
    IF merchant_row.id IS NULL OR merchant_row.status <> 'active'
       OR agent_row.id IS NULL OR agent_row.status <> 'active'
       OR sim_row.current_agent_id IS DISTINCT FROM merchant_row.agent_id THEN
      RAISE EXCEPTION 'Merchant ownership chain is invalid or inactive.' USING ERRCODE = '23514';
    END IF;
    IF actor_role_value NOT IN ('admin', 'sales_manager', 'onground_agent_manager')
       AND merchant_row.user_id <> p_actor_user_id THEN
      RAISE EXCEPTION 'The actor does not own this merchant inventory.' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT * INTO package_row FROM public.sim_packages
    WHERE organization_id = p_org_id AND id = p_package_id AND status = 'active' FOR SHARE;
  IF package_row.id IS NULL OR package_row.provider <> sim_row.provider THEN
    RAISE EXCEPTION 'Active package must belong to the SIM provider.' USING ERRCODE = '23514';
  END IF;

  sale_price_value := round(package_row.sale_price, 2);
  total_amount := public.sim_commission_amount(package_row.total_commission_type, package_row.total_commission_value, sale_price_value);
  IF p_seller_type = 'agent' THEN
    agent_type := package_row.direct_agent_commission_type;
    agent_value := package_row.direct_agent_commission_value;
    agent_amount := public.sim_commission_amount(agent_type, agent_value, sale_price_value);
    direct_amount := agent_amount;
    merchant_type := NULL;
    merchant_value := NULL;
  ELSE
    agent_type := package_row.agent_chain_commission_type;
    agent_value := package_row.agent_chain_commission_value;
    merchant_type := package_row.merchant_commission_type;
    merchant_value := package_row.merchant_commission_value;
    agent_amount := public.sim_commission_amount(agent_type, agent_value, sale_price_value);
    merchant_amount := public.sim_commission_amount(merchant_type, merchant_value, sale_price_value);
  END IF;
  IF total_amount < 0 OR agent_amount < 0 OR merchant_amount < 0 THEN
    RAISE EXCEPTION 'Commission calculation produced a negative amount.' USING ERRCODE = '23514';
  END IF;

  snapshot := jsonb_build_object(
    'version', 1, 'saleType', CASE WHEN p_seller_type = 'agent' THEN 'agent_direct' ELSE 'merchant_sale' END,
    'salePrice', sale_price_value, 'currency', package_row.commission_currency,
    'package', jsonb_build_object('id', package_row.id, 'name', package_row.package_name, 'provider', package_row.provider),
    'rules', jsonb_build_object(
      'total', jsonb_build_object('type', package_row.total_commission_type, 'value', package_row.total_commission_value, 'amount', total_amount),
      'agentChain', jsonb_build_object('type', package_row.agent_chain_commission_type, 'value', package_row.agent_chain_commission_value,
        'amount', public.sim_commission_amount(package_row.agent_chain_commission_type, package_row.agent_chain_commission_value, sale_price_value)),
      'merchant', jsonb_build_object('type', package_row.merchant_commission_type, 'value', package_row.merchant_commission_value,
        'amount', public.sim_commission_amount(package_row.merchant_commission_type, package_row.merchant_commission_value, sale_price_value)),
      'directAgent', jsonb_build_object('type', package_row.direct_agent_commission_type, 'value', package_row.direct_agent_commission_value,
        'amount', public.sim_commission_amount(package_row.direct_agent_commission_type, package_row.direct_agent_commission_value, sale_price_value))
    ),
    'calculated', jsonb_build_object('totalCommissionAmount', total_amount, 'agentCommissionAmount', agent_amount,
      'merchantCommissionAmount', merchant_amount, 'directAgentCommissionAmount', direct_amount)
  );

  INSERT INTO public.sim_sales (
    organization_id, sim_unit_id, package_id, seller_type, agent_id, merchant_id,
    sale_price, customer_name, customer_national_id, customer_absher_mobile,
    customer_birth_date_hijri, customer_id_expiry_hijri, customer_email,
    customer_nationality, package_reference, device_serial, city_district,
    marketer_name, national_address, supervisor_name, commission_currency,
    total_commission_amount, agent_commission_type, agent_commission_value,
    agent_commission_amount, merchant_commission_type, merchant_commission_value,
    merchant_commission_amount, direct_agent_commission_amount,
    commission_rule_snapshot, created_by, status, version, accounting_status
  ) VALUES (
    p_org_id, sim_row.id, package_row.id, p_seller_type, agent_row.id, merchant_row.id,
    sale_price_value, NULLIF(btrim(p_customer->>'customer_name'), ''),
    NULLIF(btrim(p_customer->>'customer_national_id'), ''), NULLIF(btrim(p_customer->>'customer_absher_mobile'), ''),
    NULLIF(btrim(p_customer->>'customer_birth_date_hijri'), ''), NULLIF(btrim(p_customer->>'customer_id_expiry_hijri'), ''),
    NULLIF(btrim(p_customer->>'customer_email'), ''), NULLIF(btrim(p_customer->>'customer_nationality'), ''),
    NULLIF(btrim(p_customer->>'package_reference'), ''), NULLIF(btrim(p_customer->>'device_serial'), ''),
    NULLIF(btrim(p_customer->>'city_district'), ''), NULLIF(btrim(p_customer->>'marketer_name'), ''),
    NULLIF(btrim(p_customer->>'national_address'), ''), NULLIF(btrim(p_customer->>'supervisor_name'), ''),
    package_row.commission_currency, total_amount, agent_type, agent_value, agent_amount,
    merchant_type, merchant_value, merchant_amount, direct_amount, snapshot,
    p_actor_user_id, 'active', 1, 'pending'
  ) RETURNING * INTO sale_row;

  UPDATE public.sim_units SET status = 'sold', sold_at = sale_row.sold_at,
    sold_by_agent_id = agent_row.id, sold_by_merchant_id = merchant_row.id,
    sold_price = sale_price_value, sold_package_id = package_row.id,
    sold_package_name = package_row.package_name,
    customer_name = NULLIF(btrim(p_customer->>'customer_name'), ''), version = version + 1,
    updated_at = now()
  WHERE id = sim_row.id;

  INSERT INTO public.sim_transfers (
    organization_id, sim_unit_id, transfer_type, from_agent_id, from_merchant_id, performed_by, notes
  ) VALUES (p_org_id, sim_row.id, 'sold',
    CASE WHEN p_seller_type = 'agent' THEN agent_row.id ELSE NULL END,
    CASE WHEN p_seller_type = 'merchant' THEN merchant_row.id ELSE NULL END,
    p_actor_user_id, 'Atomic SIM sale ' || sale_row.id::text);

  INSERT INTO public.agent_commissions (
    organization_id, agent_id, sim_unit_id, sim_package_id, sale_id, sale_price,
    commission_currency, commission_type, commission_rate, commission_amount, status
  ) VALUES (p_org_id, agent_row.id, sim_row.id, package_row.id, sale_row.id, sale_price_value,
    package_row.commission_currency, agent_type, agent_value, agent_amount, 'accrued');
  IF p_seller_type = 'merchant' THEN
    INSERT INTO public.merchant_commissions (
      organization_id, merchant_id, agent_id, sim_unit_id, sim_package_id, sale_id,
      sale_price, commission_currency, commission_type, commission_rate, commission_amount, status
    ) VALUES (p_org_id, merchant_row.id, agent_row.id, sim_row.id, package_row.id, sale_row.id,
      sale_price_value, package_row.commission_currency, merchant_type, merchant_value, merchant_amount, 'accrued');
  END IF;

  event_payload := jsonb_build_object(
    'event_type', 'sim.sale_recorded', 'sale_id', sale_row.id, 'sim_unit_id', sim_row.id,
    'seller_type', p_seller_type, 'agent_id', agent_row.id, 'merchant_id', merchant_row.id,
    'sale_price', sale_price_value, 'commission_accrual', round(agent_amount + merchant_amount, 2),
    'currency', package_row.commission_currency, 'version', sale_row.version
  );
  INSERT INTO public.business_events (
    org_id, source_type, business_key, event_version, payload, payload_hash,
    status, request_id, actor_user_id, occurred_at, processed_at
  ) VALUES (p_org_id, 'sim_sale', sale_row.id::text || ':recorded:1', 1, event_payload,
    encode(digest(event_payload::text, 'sha256'), 'hex'), 'completed', p_request_id,
    p_actor_user_id, now(), now()) RETURNING id INTO event_id;
  INSERT INTO public.event_outbox (org_id, business_event_id, topic, payload, payload_hash)
  VALUES (p_org_id, event_id, 'sim.sale_recorded', event_payload,
    encode(digest(event_payload::text, 'sha256'), 'hex'));
  INSERT INTO public.operational_audit_logs (
    org_id, request_id, actor_user_id, actor_role, action, target_type, target_id,
    outcome, status_code, metadata
  ) VALUES (p_org_id, p_request_id, p_actor_user_id, actor_role_value,
    'sim.sale_recorded', 'sim_sales', sale_row.id::text, 'success', 201,
    jsonb_build_object('sim_unit_id', sim_row.id, 'seller_type', p_seller_type,
      'sale_price', sale_price_value, 'commission_accrual', agent_amount + merchant_amount));
  UPDATE public.sim_commerce_commands SET entity_id = sale_row.id, status = 'completed', completed_at = now(),
    result = jsonb_build_object('sale_id', sale_row.id, 'sim_unit_id', sim_row.id, 'status', sale_row.status)
  WHERE id = command_row.id;
  RETURN NEXT sale_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.return_sim_unit(
  p_org_id uuid, p_actor_user_id uuid, p_command_id uuid, p_request_id uuid,
  p_sim_unit_id uuid, p_notes text
)
RETURNS SETOF public.sim_units
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  command_row public.sim_commerce_commands%ROWTYPE;
  sim_row public.sim_units%ROWTYPE;
  agent_row public.field_agents%ROWTYPE;
  merchant_row public.merchants%ROWTYPE;
  actor_role_value text;
  transfer_value public.sim_transfer_type;
  event_payload jsonb;
  event_id uuid;
  payload_value jsonb := jsonb_build_object('sim_unit_id', p_sim_unit_id, 'notes', COALESCE(p_notes, ''));
  hash_value text := encode(digest(payload_value::text, 'sha256'), 'hex');
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  SELECT role::text INTO actor_role_value FROM public.org_members
    WHERE org_id = p_org_id AND user_id = p_actor_user_id;
  IF actor_role_value IS NULL THEN RAISE EXCEPTION 'Organization membership is required.' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.sim_commerce_commands (
    organization_id, idempotency_key, action, entity_id, payload_hash, actor_user_id, request_id
  ) VALUES (p_org_id, p_command_id, 'return', p_sim_unit_id, hash_value, p_actor_user_id, p_request_id)
  ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
  SELECT * INTO command_row FROM public.sim_commerce_commands
    WHERE organization_id = p_org_id AND idempotency_key = p_command_id FOR UPDATE;
  IF command_row.action <> 'return' OR command_row.payload_hash <> hash_value THEN
    RAISE EXCEPTION 'Idempotency key was reused for a different SIM command.' USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN
    RETURN QUERY SELECT * FROM public.sim_units WHERE organization_id = p_org_id AND id = p_sim_unit_id;
    RETURN;
  END IF;
  SELECT * INTO sim_row FROM public.sim_units
    WHERE organization_id = p_org_id AND id = p_sim_unit_id FOR UPDATE;
  IF sim_row.id IS NULL THEN RAISE EXCEPTION 'SIM was not found.' USING ERRCODE = 'P0002'; END IF;

  IF sim_row.status::text = 'with_agent' THEN
    SELECT * INTO agent_row FROM public.field_agents
      WHERE organization_id = p_org_id AND id = sim_row.current_agent_id FOR UPDATE;
    IF agent_row.id IS NULL THEN RAISE EXCEPTION 'SIM agent ownership is invalid.' USING ERRCODE = '23514'; END IF;
    IF actor_role_value NOT IN ('admin', 'sales_manager', 'onground_agent_manager')
       AND agent_row.user_id <> p_actor_user_id THEN
      RAISE EXCEPTION 'The actor does not own this agent inventory.' USING ERRCODE = '42501';
    END IF;
    transfer_value := 'return_to_stock';
    UPDATE public.sim_units SET status = 'in_stock', current_agent_id = NULL,
      current_merchant_id = NULL, assigned_at = NULL, merchant_assigned_at = NULL,
      version = version + 1, updated_at = now()
    WHERE id = sim_row.id RETURNING * INTO sim_row;
    INSERT INTO public.sim_transfers (
      organization_id, sim_unit_id, transfer_type, from_agent_id, performed_by, notes
    ) VALUES (p_org_id, sim_row.id, transfer_value, agent_row.id, p_actor_user_id, NULLIF(btrim(p_notes), ''));
  ELSIF sim_row.status::text = 'with_merchant' THEN
    SELECT * INTO merchant_row FROM public.merchants
      WHERE organization_id = p_org_id AND id = sim_row.current_merchant_id FOR UPDATE;
    SELECT * INTO agent_row FROM public.field_agents
      WHERE organization_id = p_org_id AND id = merchant_row.agent_id FOR UPDATE;
    IF merchant_row.id IS NULL OR agent_row.id IS NULL
       OR sim_row.current_agent_id IS DISTINCT FROM merchant_row.agent_id THEN
      RAISE EXCEPTION 'SIM merchant ownership chain is invalid.' USING ERRCODE = '23514';
    END IF;
    IF actor_role_value NOT IN ('admin', 'sales_manager', 'onground_agent_manager')
       AND merchant_row.user_id <> p_actor_user_id THEN
      RAISE EXCEPTION 'The actor does not own this merchant inventory.' USING ERRCODE = '42501';
    END IF;
    transfer_value := 'return_from_merchant';
    UPDATE public.sim_units SET status = 'with_agent', current_merchant_id = NULL,
      merchant_assigned_at = NULL, version = version + 1, updated_at = now()
    WHERE id = sim_row.id RETURNING * INTO sim_row;
    INSERT INTO public.sim_transfers (
      organization_id, sim_unit_id, transfer_type, from_merchant_id, to_agent_id, performed_by, notes
    ) VALUES (p_org_id, sim_row.id, transfer_value, merchant_row.id, agent_row.id,
      p_actor_user_id, NULLIF(btrim(p_notes), ''));
  ELSE
    RAISE EXCEPTION 'Only assigned, unsold SIMs can be returned.' USING ERRCODE = '55000';
  END IF;

  event_payload := jsonb_build_object('event_type', 'sim.inventory_returned',
    'sim_unit_id', sim_row.id, 'transfer_type', transfer_value::text,
    'status', sim_row.status::text, 'version', sim_row.version);
  INSERT INTO public.business_events (
    org_id, source_type, business_key, event_version, payload, payload_hash,
    status, request_id, actor_user_id, occurred_at, processed_at
  ) VALUES (p_org_id, 'sim_inventory', sim_row.id::text || ':return:' || sim_row.version::text,
    sim_row.version, event_payload, encode(digest(event_payload::text, 'sha256'), 'hex'),
    'completed', p_request_id, p_actor_user_id, now(), now()) RETURNING id INTO event_id;
  INSERT INTO public.event_outbox (org_id, business_event_id, topic, payload, payload_hash)
  VALUES (p_org_id, event_id, 'sim.inventory_returned', event_payload,
    encode(digest(event_payload::text, 'sha256'), 'hex'));
  UPDATE public.sim_commerce_commands SET status = 'completed', completed_at = now(),
    result = jsonb_build_object('sim_unit_id', sim_row.id, 'status', sim_row.status::text, 'version', sim_row.version)
  WHERE id = command_row.id;
  RETURN NEXT sim_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.void_sim_sale(
  p_org_id uuid, p_actor_user_id uuid, p_command_id uuid, p_request_id uuid,
  p_sale_id uuid, p_expected_version integer, p_reason text
)
RETURNS SETOF public.sim_sales
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  command_row public.sim_commerce_commands%ROWTYPE;
  sale_row public.sim_sales%ROWTYPE;
  sim_row public.sim_units%ROWTYPE;
  actor_role_value text;
  event_payload jsonb;
  event_id uuid;
  payload_value jsonb := jsonb_build_object('sale_id', p_sale_id,
    'expected_version', p_expected_version, 'reason', COALESCE(p_reason, ''));
  hash_value text := encode(digest(payload_value::text, 'sha256'), 'hex');
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  SELECT role::text INTO actor_role_value FROM public.org_members
    WHERE org_id = p_org_id AND user_id = p_actor_user_id
      AND role::text IN ('admin', 'sales_manager', 'onground_agent_manager');
  IF actor_role_value IS NULL THEN RAISE EXCEPTION 'Sales management access is required.' USING ERRCODE = '42501'; END IF;
  IF length(btrim(COALESCE(p_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'A meaningful void reason is required.' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.sim_commerce_commands (
    organization_id, idempotency_key, action, entity_id, payload_hash, actor_user_id, request_id
  ) VALUES (p_org_id, p_command_id, 'void', p_sale_id, hash_value, p_actor_user_id, p_request_id)
  ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
  SELECT * INTO command_row FROM public.sim_commerce_commands
    WHERE organization_id = p_org_id AND idempotency_key = p_command_id FOR UPDATE;
  IF command_row.action <> 'void' OR command_row.payload_hash <> hash_value THEN
    RAISE EXCEPTION 'Idempotency key was reused for a different SIM command.' USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN
    RETURN QUERY SELECT * FROM public.sim_sales WHERE organization_id = p_org_id AND id = p_sale_id;
    RETURN;
  END IF;
  SELECT * INTO sale_row FROM public.sim_sales
    WHERE organization_id = p_org_id AND id = p_sale_id FOR UPDATE;
  IF sale_row.id IS NULL THEN RAISE EXCEPTION 'SIM sale was not found.' USING ERRCODE = 'P0002'; END IF;
  IF sale_row.status <> 'active' OR sale_row.version <> p_expected_version THEN
    RAISE EXCEPTION 'SIM sale state or version conflict.' USING ERRCODE = '40001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.agent_commissions
      WHERE organization_id = p_org_id AND sale_id = sale_row.id AND status = 'settled')
     OR EXISTS (SELECT 1 FROM public.merchant_commissions
      WHERE organization_id = p_org_id AND sale_id = sale_row.id AND status = 'settled') THEN
    RAISE EXCEPTION 'A settled commission must be financially reversed before this sale can be voided.' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO sim_row FROM public.sim_units
    WHERE organization_id = p_org_id AND id = sale_row.sim_unit_id FOR UPDATE;
  IF sim_row.id IS NULL OR sim_row.status::text <> 'sold' THEN
    RAISE EXCEPTION 'SIM inventory no longer matches the active sale.' USING ERRCODE = '55000';
  END IF;

  UPDATE public.agent_commissions SET status = 'reversed', is_paid = false,
    reversed_at = now(), reversal_reason = btrim(p_reason), updated_at = now()
  WHERE organization_id = p_org_id AND sale_id = sale_row.id AND status = 'accrued';
  UPDATE public.merchant_commissions SET status = 'reversed', is_paid = false,
    reversed_at = now(), reversal_reason = btrim(p_reason), updated_at = now()
  WHERE organization_id = p_org_id AND sale_id = sale_row.id AND status = 'accrued';

  UPDATE public.sim_units SET
    status = CASE WHEN sale_row.seller_type = 'agent' THEN 'with_agent'::public.sim_status ELSE 'with_merchant'::public.sim_status END,
    current_agent_id = sale_row.agent_id,
    current_merchant_id = CASE WHEN sale_row.seller_type = 'merchant' THEN sale_row.merchant_id ELSE NULL END,
    assigned_at = COALESCE(assigned_at, now()),
    merchant_assigned_at = CASE WHEN sale_row.seller_type = 'merchant' THEN COALESCE(merchant_assigned_at, now()) ELSE NULL END,
    sold_at = NULL, sold_by_agent_id = NULL, sold_by_merchant_id = NULL,
    sold_price = NULL, sold_package_id = NULL, sold_package_name = NULL,
    customer_name = NULL, version = version + 1, updated_at = now()
  WHERE id = sim_row.id RETURNING * INTO sim_row;
  INSERT INTO public.sim_transfers (
    organization_id, sim_unit_id, transfer_type, to_agent_id, to_merchant_id, performed_by, notes
  ) VALUES (p_org_id, sim_row.id, 'sale_voided', sale_row.agent_id,
    CASE WHEN sale_row.seller_type = 'merchant' THEN sale_row.merchant_id ELSE NULL END,
    p_actor_user_id, btrim(p_reason));

  UPDATE public.sim_sales SET status = 'voided', voided_by = p_actor_user_id,
    voided_at = now(), void_reason = btrim(p_reason),
    accounting_status = CASE WHEN accounting_status = 'posted' THEN 'reversal_pending' ELSE 'reversed' END,
    version = version + 1, updated_at = now()
  WHERE id = sale_row.id RETURNING * INTO sale_row;

  event_payload := jsonb_build_object('event_type', 'sim.sale_voided',
    'sale_id', sale_row.id, 'sim_unit_id', sale_row.sim_unit_id,
    'seller_type', sale_row.seller_type, 'sale_price', sale_row.sale_price,
    'commission_reversal', round(sale_row.agent_commission_amount + COALESCE(sale_row.merchant_commission_amount, 0), 2),
    'accounting_journal_entry_id', sale_row.accounting_journal_entry_id,
    'reason', sale_row.void_reason, 'version', sale_row.version);
  INSERT INTO public.business_events (
    org_id, source_type, business_key, event_version, payload, payload_hash,
    status, request_id, actor_user_id, occurred_at, processed_at
  ) VALUES (p_org_id, 'sim_sale', sale_row.id::text || ':voided:' || sale_row.version::text,
    sale_row.version, event_payload, encode(digest(event_payload::text, 'sha256'), 'hex'),
    'completed', p_request_id, p_actor_user_id, now(), now()) RETURNING id INTO event_id;
  INSERT INTO public.event_outbox (org_id, business_event_id, topic, payload, payload_hash)
  VALUES (p_org_id, event_id, 'sim.sale_voided', event_payload,
    encode(digest(event_payload::text, 'sha256'), 'hex'));
  INSERT INTO public.operational_audit_logs (
    org_id, request_id, actor_user_id, actor_role, action, target_type, target_id,
    outcome, status_code, metadata
  ) VALUES (p_org_id, p_request_id, p_actor_user_id, actor_role_value,
    'sim.sale_voided', 'sim_sales', sale_row.id::text, 'success', 200,
    jsonb_build_object('sim_unit_id', sale_row.sim_unit_id, 'reason', sale_row.void_reason,
      'accounting_status', sale_row.accounting_status, 'version', sale_row.version));
  UPDATE public.sim_commerce_commands SET status = 'completed', completed_at = now(),
    result = jsonb_build_object('sale_id', sale_row.id, 'status', sale_row.status,
      'accounting_status', sale_row.accounting_status, 'version', sale_row.version)
  WHERE id = command_row.id;
  RETURN NEXT sale_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_sim_commissions(
  p_org_id uuid, p_actor_user_id uuid, p_command_id uuid, p_request_id uuid,
  p_beneficiary_type text, p_commission_ids jsonb, p_payment_date date,
  p_account_id uuid, p_payment_method text, p_payment_reference text, p_finance_notes text
)
RETURNS SETOF public.commission_settlement_batches
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  command_row public.sim_commerce_commands%ROWTYPE;
  batch_row public.commission_settlement_batches%ROWTYPE;
  payment_row public.accounting_payments%ROWTYPE;
  settings_row public.accounting_settings%ROWTYPE;
  actor_role_value text;
  id_values uuid[];
  requested_count integer;
  eligible_count integer;
  total_value numeric(14,2);
  currency_value text;
  payment_date_value date := COALESCE(p_payment_date, public.organization_business_date(p_org_id, now()));
  event_payload jsonb;
  event_id uuid;
  payload_value jsonb;
  hash_value text;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  SELECT role::text INTO actor_role_value FROM public.org_members
    WHERE org_id = p_org_id AND user_id = p_actor_user_id AND role::text = 'finance_manager';
  IF actor_role_value IS NULL THEN RAISE EXCEPTION 'Finance Manager access is required.' USING ERRCODE = '42501'; END IF;
  IF p_beneficiary_type NOT IN ('agent', 'merchant')
     OR p_payment_method NOT IN ('cash', 'bank_transfer', 'wallet', 'other')
     OR jsonb_typeof(p_commission_ids) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Commission settlement input is invalid.' USING ERRCODE = '22023';
  END IF;
  SELECT array_agg(DISTINCT value::uuid ORDER BY value::uuid), count(DISTINCT value)::integer
    INTO id_values, requested_count
  FROM jsonb_array_elements_text(p_commission_ids) value;
  IF requested_count IS NULL OR requested_count = 0 OR requested_count > 500 THEN
    RAISE EXCEPTION 'Select between 1 and 500 commissions.' USING ERRCODE = '23514';
  END IF;
  payload_value := jsonb_build_object('beneficiary_type', p_beneficiary_type,
    'commission_ids', to_jsonb(id_values), 'payment_date', payment_date_value,
    'account_id', p_account_id, 'payment_method', p_payment_method,
    'payment_reference', COALESCE(p_payment_reference, ''), 'finance_notes', COALESCE(p_finance_notes, ''));
  hash_value := encode(digest(payload_value::text, 'sha256'), 'hex');
  INSERT INTO public.sim_commerce_commands (
    organization_id, idempotency_key, action, payload_hash, actor_user_id, request_id
  ) VALUES (p_org_id, p_command_id, 'commission_settle', hash_value, p_actor_user_id, p_request_id)
  ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
  SELECT * INTO command_row FROM public.sim_commerce_commands
    WHERE organization_id = p_org_id AND idempotency_key = p_command_id FOR UPDATE;
  IF command_row.action <> 'commission_settle' OR command_row.payload_hash <> hash_value THEN
    RAISE EXCEPTION 'Idempotency key was reused for a different SIM command.' USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN
    RETURN QUERY SELECT * FROM public.commission_settlement_batches
      WHERE organization_id = p_org_id AND id = command_row.entity_id;
    RETURN;
  END IF;

  IF p_beneficiary_type = 'agent' THEN
    PERFORM id FROM public.agent_commissions
      WHERE organization_id = p_org_id AND id = ANY(id_values) ORDER BY id FOR UPDATE;
    SELECT count(*)::integer, round(sum(c.commission_amount), 2), min(c.commission_currency)
      INTO eligible_count, total_value, currency_value
    FROM public.agent_commissions c
    JOIN public.sim_sales sale ON sale.organization_id = c.organization_id AND sale.id = c.sale_id
    WHERE c.organization_id = p_org_id AND c.id = ANY(id_values)
      AND c.status = 'accrued' AND c.is_paid = false AND c.settlement_batch_id IS NULL
      AND sale.status = 'active';
  ELSE
    PERFORM id FROM public.merchant_commissions
      WHERE organization_id = p_org_id AND id = ANY(id_values) ORDER BY id FOR UPDATE;
    SELECT count(*)::integer, round(sum(c.commission_amount), 2), min(c.commission_currency)
      INTO eligible_count, total_value, currency_value
    FROM public.merchant_commissions c
    JOIN public.sim_sales sale ON sale.organization_id = c.organization_id AND sale.id = c.sale_id
    WHERE c.organization_id = p_org_id AND c.id = ANY(id_values)
      AND c.status = 'accrued' AND c.is_paid = false AND c.settlement_batch_id IS NULL
      AND sale.status = 'active';
  END IF;
  IF eligible_count <> requested_count OR total_value IS NULL OR total_value <= 0 THEN
    RAISE EXCEPTION 'Every selected commission must be accrued, unpaid, unique, and linked to an active sale.' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM (
      SELECT commission_currency FROM public.agent_commissions
        WHERE p_beneficiary_type = 'agent' AND organization_id = p_org_id AND id = ANY(id_values)
      UNION ALL
      SELECT commission_currency FROM public.merchant_commissions
        WHERE p_beneficiary_type = 'merchant' AND organization_id = p_org_id AND id = ANY(id_values)
    ) currencies WHERE commission_currency IS DISTINCT FROM currency_value
  ) THEN RAISE EXCEPTION 'One settlement batch cannot mix currencies.' USING ERRCODE = '23514'; END IF;

  SELECT * INTO settings_row FROM public.accounting_settings WHERE organization_id = p_org_id;
  IF settings_row.default_commission_payable_id IS NULL
     OR COALESCE(p_account_id, settings_row.default_bank_account_id, settings_row.default_cash_account_id) IS NULL THEN
    RAISE EXCEPTION 'Commission payable and cash/bank accounts must be configured.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO payment_row FROM public.accounting_save_payment(
    p_org_id, p_actor_user_id, public.accounting_child_command_id(p_command_id, 'commission-payment'),
    p_request_id, NULL, 0, true,
    jsonb_build_object('paymentDate', payment_date_value, 'type', 'manual', 'direction', 'outbound',
      'amount', total_value, 'accountId', COALESCE(p_account_id, settings_row.default_bank_account_id, settings_row.default_cash_account_id),
      'counterpartAccountId', settings_row.default_commission_payable_id,
      'description', 'Commission settlement', 'referenceNo', NULLIF(btrim(p_payment_reference), ''),
      'method', p_payment_method, 'notes', NULLIF(btrim(p_finance_notes), ''))
  );

  INSERT INTO public.commission_settlement_batches (
    organization_id, beneficiary_type, commission_count, total_amount, currency,
    payment_method, payment_reference, finance_notes, accounting_payment_id,
    accounting_journal_entry_id, posted_by
  ) VALUES (p_org_id, p_beneficiary_type, requested_count, total_value,
    COALESCE(NULLIF(btrim(currency_value), ''), 'SAR'), p_payment_method,
    NULLIF(btrim(p_payment_reference), ''), NULLIF(btrim(p_finance_notes), ''),
    payment_row.id, payment_row.journal_entry_id, p_actor_user_id)
  RETURNING * INTO batch_row;

  IF p_beneficiary_type = 'agent' THEN
    INSERT INTO public.commission_settlement_lines (
      organization_id, settlement_batch_id, beneficiary_type, commission_id, sale_id, amount
    ) SELECT p_org_id, batch_row.id, 'agent', c.id, c.sale_id, c.commission_amount
      FROM public.agent_commissions c WHERE c.organization_id = p_org_id AND c.id = ANY(id_values);
    UPDATE public.agent_commissions SET status = 'settled', is_paid = true,
      paid_at = batch_row.posted_at, paid_by = p_actor_user_id, payment_method = p_payment_method,
      payment_reference = NULLIF(btrim(p_payment_reference), ''), finance_notes = NULLIF(btrim(p_finance_notes), ''),
      settlement_batch_id = batch_row.id, accounting_journal_entry_id = payment_row.journal_entry_id,
      updated_at = now()
    WHERE organization_id = p_org_id AND id = ANY(id_values);
  ELSE
    INSERT INTO public.commission_settlement_lines (
      organization_id, settlement_batch_id, beneficiary_type, commission_id, sale_id, amount
    ) SELECT p_org_id, batch_row.id, 'merchant', c.id, c.sale_id, c.commission_amount
      FROM public.merchant_commissions c WHERE c.organization_id = p_org_id AND c.id = ANY(id_values);
    UPDATE public.merchant_commissions SET status = 'settled', is_paid = true,
      paid_at = batch_row.posted_at, paid_by = p_actor_user_id, payment_method = p_payment_method,
      payment_reference = NULLIF(btrim(p_payment_reference), ''), finance_notes = NULLIF(btrim(p_finance_notes), ''),
      settlement_batch_id = batch_row.id, accounting_journal_entry_id = payment_row.journal_entry_id,
      updated_at = now()
    WHERE organization_id = p_org_id AND id = ANY(id_values);
  END IF;

  event_payload := jsonb_build_object('event_type', 'commission.settlement_posted',
    'settlement_batch_id', batch_row.id, 'beneficiary_type', p_beneficiary_type,
    'commission_count', requested_count, 'total_amount', total_value,
    'currency', batch_row.currency, 'payment_id', payment_row.id,
    'journal_entry_id', payment_row.journal_entry_id);
  INSERT INTO public.business_events (
    org_id, source_type, business_key, event_version, payload, payload_hash,
    status, request_id, actor_user_id, occurred_at, processed_at
  ) VALUES (p_org_id, 'commission_settlement', batch_row.id::text || ':posted:1', 1,
    event_payload, encode(digest(event_payload::text, 'sha256'), 'hex'), 'completed',
    p_request_id, p_actor_user_id, now(), now()) RETURNING id INTO event_id;
  INSERT INTO public.event_outbox (org_id, business_event_id, topic, payload, payload_hash)
  VALUES (p_org_id, event_id, 'commission.settlement_posted', event_payload,
    encode(digest(event_payload::text, 'sha256'), 'hex'));
  INSERT INTO public.operational_audit_logs (
    org_id, request_id, actor_user_id, actor_role, action, target_type, target_id,
    outcome, status_code, metadata
  ) VALUES (p_org_id, p_request_id, p_actor_user_id, actor_role_value,
    'commission.settlement_posted', 'commission_settlement_batches', batch_row.id::text,
    'success', 201, event_payload);
  UPDATE public.sim_commerce_commands SET entity_id = batch_row.id, status = 'completed',
    completed_at = now(), result = event_payload WHERE id = command_row.id;
  RETURN NEXT batch_row;
END;
$$;

REVOKE ALL ON FUNCTION public.sim_commission_amount(text, numeric, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_sim_sale(uuid, uuid, uuid, uuid, uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.return_sim_unit(uuid, uuid, uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.void_sim_sale(uuid, uuid, uuid, uuid, uuid, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_sim_commissions(uuid, uuid, uuid, uuid, text, jsonb, date, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_sim_sale(uuid, uuid, uuid, uuid, uuid, uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.return_sim_unit(uuid, uuid, uuid, uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.void_sim_sale(uuid, uuid, uuid, uuid, uuid, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_sim_commissions(uuid, uuid, uuid, uuid, text, jsonb, date, uuid, text, text, text) TO service_role;

COMMENT ON FUNCTION public.record_sim_sale(uuid, uuid, uuid, uuid, uuid, uuid, text, jsonb) IS
  'Locks one SIM and atomically records inventory, transfer, immutable sale, commission accruals, audit, and outbox event.';
COMMENT ON TABLE public.commission_settlement_batches IS
  'Immutable finance settlement header linked to one posted cash/bank payment and balanced GL journal.';
