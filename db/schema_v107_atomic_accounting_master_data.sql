-- Atomic accounting master-data and journal-cancellation commands.
-- These replace service-role row writes followed by a best-effort audit call.

ALTER TABLE public.accounting_accounts
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 0;
ALTER TABLE public.accounting_cost_centers
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 0;
ALTER TABLE public.accounting_vendors
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 0;
ALTER TABLE public.accounting_settings
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 0;

ALTER TABLE public.accounting_accounts
  DROP CONSTRAINT IF EXISTS accounting_accounts_version_check,
  ADD CONSTRAINT accounting_accounts_version_check CHECK (version >= 0);
ALTER TABLE public.accounting_cost_centers
  DROP CONSTRAINT IF EXISTS accounting_cost_centers_version_check,
  ADD CONSTRAINT accounting_cost_centers_version_check CHECK (version >= 0);
ALTER TABLE public.accounting_vendors
  DROP CONSTRAINT IF EXISTS accounting_vendors_version_check,
  ADD CONSTRAINT accounting_vendors_version_check CHECK (version >= 0);
ALTER TABLE public.accounting_settings
  DROP CONSTRAINT IF EXISTS accounting_settings_version_check,
  ADD CONSTRAINT accounting_settings_version_check CHECK (version >= 0);

ALTER TABLE public.accounting_commands DROP CONSTRAINT IF EXISTS accounting_commands_action_check;
ALTER TABLE public.accounting_commands ADD CONSTRAINT accounting_commands_action_check CHECK (action IN (
  'journal_create', 'journal_update', 'journal_post', 'journal_reverse', 'journal_cancel',
  'invoice_create', 'invoice_update', 'invoice_issue',
  'expense_create', 'expense_update', 'expense_approve', 'expense_reject',
  'payment_create', 'payment_update', 'payment_post',
  'period_close', 'period_reopen', 'budget_create', 'budget_update', 'budget_approve',
  'master_save', 'master_deactivate'
));

-- Browser sessions keep read access. Master-data changes now go through the
-- service-only command below, just like journals and financial documents.
DROP POLICY IF EXISTS accounting_accounts_insert ON public.accounting_accounts;
DROP POLICY IF EXISTS accounting_accounts_update ON public.accounting_accounts;
DROP POLICY IF EXISTS accounting_accounts_delete ON public.accounting_accounts;
DROP POLICY IF EXISTS accounting_cost_centers_insert ON public.accounting_cost_centers;
DROP POLICY IF EXISTS accounting_cost_centers_update ON public.accounting_cost_centers;
DROP POLICY IF EXISTS accounting_cost_centers_delete ON public.accounting_cost_centers;
DROP POLICY IF EXISTS accounting_vendors_insert ON public.accounting_vendors;
DROP POLICY IF EXISTS accounting_vendors_update ON public.accounting_vendors;
DROP POLICY IF EXISTS accounting_vendors_delete ON public.accounting_vendors;
DROP POLICY IF EXISTS accounting_settings_insert ON public.accounting_settings;
DROP POLICY IF EXISTS accounting_settings_update ON public.accounting_settings;
DROP POLICY IF EXISTS accounting_settings_delete ON public.accounting_settings;

-- v101 emitted update notifications from triggers. The command below emits the
-- same topic explicitly so audit, event, and source mutation share idempotency.
DROP TRIGGER IF EXISTS trg_accounting_settings_record_event ON public.accounting_settings;
DROP TRIGGER IF EXISTS trg_accounting_account_record_event ON public.accounting_accounts;
DROP TRIGGER IF EXISTS trg_accounting_cost_center_record_event ON public.accounting_cost_centers;
DROP TRIGGER IF EXISTS trg_accounting_vendor_record_event ON public.accounting_vendors;

CREATE OR REPLACE FUNCTION public.accounting_master_increment_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.version = OLD.version THEN
    NEW.version := OLD.version + 1;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE table_name_value text;
BEGIN
  FOREACH table_name_value IN ARRAY ARRAY[
    'accounting_accounts', 'accounting_cost_centers',
    'accounting_vendors', 'accounting_settings'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_master_version ON public.%I',
      table_name_value, table_name_value);
    EXECUTE format(
      'CREATE TRIGGER trg_%I_master_version BEFORE UPDATE ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.accounting_master_increment_version()',
      table_name_value, table_name_value
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.execute_accounting_master_command(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_command_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_expected_version integer,
  p_operation text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  command_row public.accounting_commands%ROWTYPE;
  account_row public.accounting_accounts%ROWTYPE;
  original_account_row public.accounting_accounts%ROWTYPE;
  cost_center_row public.accounting_cost_centers%ROWTYPE;
  vendor_row public.accounting_vendors%ROWTYPE;
  settings_row public.accounting_settings%ROWTYPE;
  journal_row public.accounting_journal_entries%ROWTYPE;
  actor_role_value text;
  action_value text := CASE
    WHEN p_entity_type = 'journal' THEN 'journal_cancel'
    WHEN p_operation = 'deactivate' THEN 'master_deactivate'
    ELSE 'master_save'
  END;
  clean_payload jsonb;
  hash_value text;
  result_value jsonb;
  event_payload jsonb;
  event_id uuid;
  target_id_value uuid;
  version_value integer;
  change_value text;
  operation_value text := 'update';
  table_name_value text;
  record_type_value text;
  name_value text;
  description_value text;
  settings_created boolean := false;
  settings_inserted_count integer := 0;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_org_id IS NULL OR p_actor_user_id IS NULL OR p_request_id IS NULL OR p_command_id IS NULL THEN
    RAISE EXCEPTION 'Organization, actor, request, and command ids are required.' USING ERRCODE = '22023';
  END IF;
  IF p_entity_type NOT IN ('account', 'cost_center', 'vendor', 'settings', 'journal')
     OR p_operation NOT IN ('save', 'deactivate', 'cancel')
     OR (p_entity_type = 'journal') IS DISTINCT FROM (p_operation = 'cancel')
     OR (p_entity_type = 'settings' AND p_operation <> 'save') THEN
    RAISE EXCEPTION 'Unsupported accounting master-data command.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_payload, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Accounting master payload must be an object.' USING ERRCODE = '22023';
  END IF;

  SELECT member.role::text INTO actor_role_value
  FROM public.org_members member
  JOIN public.organizations organization ON organization.id = member.org_id
  JOIN public.profiles profile ON profile.user_id = member.user_id
    AND profile.org_id = member.org_id
  WHERE member.org_id = p_org_id
    AND member.user_id = p_actor_user_id
    AND member.role::text IN ('finance_manager', 'accountant')
    AND lower(COALESCE(organization.status, '')) = 'active'
    AND lower(COALESCE(profile.account_status, 'active')) = 'active'
  LIMIT 1;
  IF actor_role_value IS NULL
     OR (p_entity_type = 'settings' AND actor_role_value <> 'finance_manager') THEN
    RAISE EXCEPTION 'Accounting management access is required.' USING ERRCODE = '42501';
  END IF;

  clean_payload := COALESCE(p_payload, '{}'::jsonb) - ARRAY[
    'id', 'organization_id', 'created_by', 'updated_by', 'created_at',
    'updated_at', 'version', 'command_id', 'request_id', 'expected_version'
  ];
  hash_value := encode(digest(jsonb_build_object(
    'entity_type', p_entity_type,
    'entity_id', p_entity_id,
    'expected_version', COALESCE(p_expected_version, 0),
    'operation', p_operation,
    'payload', clean_payload
  )::text, 'sha256'), 'hex');

  INSERT INTO public.accounting_commands (
    organization_id, idempotency_key, action, entity_id, payload_hash,
    actor_user_id, request_id
  ) VALUES (
    p_org_id, p_command_id, action_value, p_entity_id, hash_value,
    p_actor_user_id, p_request_id
  )
  ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
  SELECT * INTO command_row FROM public.accounting_commands
  WHERE organization_id = p_org_id AND idempotency_key = p_command_id
  FOR UPDATE;
  IF command_row.action <> action_value OR command_row.payload_hash <> hash_value
     OR command_row.actor_user_id IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION 'Idempotency key was reused for a different accounting command.'
      USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN
    RETURN command_row.result;
  END IF;

  IF p_entity_type = 'account' THEN
    table_name_value := 'accounting_accounts';
    IF p_operation = 'save' AND p_entity_id IS NULL THEN
      IF NULLIF(btrim(clean_payload->>'code'), '') IS NULL
         OR NULLIF(btrim(clean_payload->>'name_ar'), '') IS NULL
         OR clean_payload->>'type' NOT IN ('asset', 'liability', 'equity', 'revenue', 'expense')
         OR clean_payload->>'normal_balance' NOT IN ('debit', 'credit') THEN
        RAISE EXCEPTION 'Account code, Arabic name, type, and normal balance are required.'
          USING ERRCODE = '23514';
      END IF;
      INSERT INTO public.accounting_accounts (
        organization_id, code, name_ar, name_en, type, subtype, parent_id,
        normal_balance, is_system, is_active, description, cash_flow_category,
        created_by, updated_by, version
      ) VALUES (
        p_org_id, btrim(clean_payload->>'code'), btrim(clean_payload->>'name_ar'),
        NULLIF(btrim(clean_payload->>'name_en'), ''), clean_payload->>'type',
        NULLIF(btrim(clean_payload->>'subtype'), ''), NULLIF(clean_payload->>'parent_id', '')::uuid,
        clean_payload->>'normal_balance', false, COALESCE((clean_payload->>'is_active')::boolean, true),
        NULLIF(btrim(clean_payload->>'description'), ''),
        NULLIF(clean_payload->>'cash_flow_category', ''), p_actor_user_id, p_actor_user_id, 1
      ) RETURNING * INTO account_row;
      operation_value := 'insert';
      change_value := 'created';
    ELSE
      SELECT * INTO account_row FROM public.accounting_accounts
      WHERE organization_id = p_org_id AND id = p_entity_id FOR UPDATE;
      IF account_row.id IS NULL THEN
        RAISE EXCEPTION 'Accounting account was not found.' USING ERRCODE = 'P0002';
      END IF;
      IF account_row.version <> COALESCE(p_expected_version, 0) THEN
        RAISE EXCEPTION 'Accounting account version conflict.' USING ERRCODE = '40001';
      END IF;
      original_account_row := account_row;
      IF p_operation = 'deactivate' THEN
        IF account_row.is_system THEN
          RAISE EXCEPTION 'System accounts cannot be deactivated.' USING ERRCODE = '55000';
        END IF;
        account_row.is_active := false;
        change_value := 'deactivated';
      ELSE
        account_row := jsonb_populate_record(account_row, clean_payload);
        account_row.id := original_account_row.id;
        account_row.organization_id := original_account_row.organization_id;
        account_row.created_by := original_account_row.created_by;
        account_row.created_at := original_account_row.created_at;
        account_row.is_system := original_account_row.is_system;
        IF original_account_row.is_system AND (
          account_row.code IS DISTINCT FROM original_account_row.code
          OR account_row.type IS DISTINCT FROM original_account_row.type
          OR account_row.normal_balance IS DISTINCT FROM original_account_row.normal_balance
        ) THEN
          RAISE EXCEPTION 'System account classification cannot be changed.' USING ERRCODE = '55000';
        END IF;
        IF EXISTS (SELECT 1 FROM public.accounting_journal_lines line WHERE line.account_id = account_row.id)
           AND (account_row.type IS DISTINCT FROM original_account_row.type
             OR account_row.normal_balance IS DISTINCT FROM original_account_row.normal_balance) THEN
          RAISE EXCEPTION 'An account used by journals cannot change type or normal balance.' USING ERRCODE = '55000';
        END IF;
        change_value := 'updated';
      END IF;
      IF account_row.parent_id = account_row.id THEN
        RAISE EXCEPTION 'An account cannot be its own parent.' USING ERRCODE = '23514';
      END IF;
      IF account_row.parent_id IS NOT NULL AND EXISTS (
        WITH RECURSIVE ancestors AS (
          SELECT parent.id, parent.parent_id FROM public.accounting_accounts parent
          WHERE parent.organization_id = p_org_id AND parent.id = account_row.parent_id
          UNION ALL
          SELECT parent.id, parent.parent_id FROM public.accounting_accounts parent
          JOIN ancestors prior ON parent.id = prior.parent_id
          WHERE parent.organization_id = p_org_id
        )
        SELECT 1 FROM ancestors WHERE id = account_row.id
      ) THEN
        RAISE EXCEPTION 'Account hierarchy cannot contain a cycle.' USING ERRCODE = '23514';
      END IF;
      account_row.updated_by := p_actor_user_id;
      account_row.version := original_account_row.version + 1;
      UPDATE public.accounting_accounts SET
        code = account_row.code, name_ar = account_row.name_ar, name_en = account_row.name_en,
        type = account_row.type, subtype = account_row.subtype, parent_id = account_row.parent_id,
        normal_balance = account_row.normal_balance, is_active = account_row.is_active,
        description = account_row.description, cash_flow_category = account_row.cash_flow_category,
        updated_by = account_row.updated_by, version = account_row.version
      WHERE id = account_row.id RETURNING * INTO account_row;
    END IF;
    target_id_value := account_row.id;
    version_value := account_row.version;
    record_type_value := account_row.type;
    name_value := account_row.name_ar;
    description_value := account_row.description;
    result_value := to_jsonb(account_row);

  ELSIF p_entity_type = 'cost_center' THEN
    table_name_value := 'accounting_cost_centers';
    IF p_operation = 'save' AND p_entity_id IS NULL THEN
      INSERT INTO public.accounting_cost_centers (
        organization_id, code, name_ar, name_en, type, reference_id,
        is_active, created_by, version
      ) VALUES (
        p_org_id, btrim(clean_payload->>'code'), btrim(clean_payload->>'name_ar'),
        NULLIF(btrim(clean_payload->>'name_en'), ''),
        COALESCE(NULLIF(clean_payload->>'type', ''), 'custom'),
        NULLIF(clean_payload->>'reference_id', '')::uuid,
        COALESCE((clean_payload->>'is_active')::boolean, true), p_actor_user_id, 1
      ) RETURNING * INTO cost_center_row;
      operation_value := 'insert';
      change_value := 'created';
    ELSE
      SELECT * INTO cost_center_row FROM public.accounting_cost_centers
      WHERE organization_id = p_org_id AND id = p_entity_id FOR UPDATE;
      IF cost_center_row.id IS NULL THEN
        RAISE EXCEPTION 'Accounting cost center was not found.' USING ERRCODE = 'P0002';
      END IF;
      IF cost_center_row.version <> COALESCE(p_expected_version, 0) THEN
        RAISE EXCEPTION 'Accounting cost-center version conflict.' USING ERRCODE = '40001';
      END IF;
      IF p_operation = 'deactivate' THEN
        cost_center_row.is_active := false;
        change_value := 'deactivated';
      ELSE
        cost_center_row := jsonb_populate_record(cost_center_row, clean_payload);
        change_value := 'updated';
      END IF;
      cost_center_row.id := p_entity_id;
      cost_center_row.organization_id := p_org_id;
      cost_center_row.version := COALESCE(p_expected_version, 0) + 1;
      UPDATE public.accounting_cost_centers SET
        code = cost_center_row.code, name_ar = cost_center_row.name_ar,
        name_en = cost_center_row.name_en, type = cost_center_row.type,
        reference_id = cost_center_row.reference_id, is_active = cost_center_row.is_active,
        version = cost_center_row.version
      WHERE id = cost_center_row.id RETURNING * INTO cost_center_row;
    END IF;
    IF NULLIF(btrim(cost_center_row.code), '') IS NULL OR NULLIF(btrim(cost_center_row.name_ar), '') IS NULL THEN
      RAISE EXCEPTION 'Cost-center code and Arabic name are required.' USING ERRCODE = '23514';
    END IF;
    target_id_value := cost_center_row.id;
    version_value := cost_center_row.version;
    record_type_value := cost_center_row.type;
    name_value := cost_center_row.name_ar;
    result_value := to_jsonb(cost_center_row);

  ELSIF p_entity_type = 'vendor' THEN
    table_name_value := 'accounting_vendors';
    IF p_operation = 'save' AND p_entity_id IS NULL THEN
      INSERT INTO public.accounting_vendors (
        organization_id, name_ar, name_en, vat_number, commercial_registration,
        phone, email, address, city, country, bank_name, iban, payment_terms,
        is_active, created_by, version
      ) VALUES (
        p_org_id, btrim(clean_payload->>'name_ar'), NULLIF(btrim(clean_payload->>'name_en'), ''),
        NULLIF(btrim(clean_payload->>'vat_number'), ''),
        NULLIF(btrim(clean_payload->>'commercial_registration'), ''),
        NULLIF(btrim(clean_payload->>'phone'), ''), NULLIF(btrim(clean_payload->>'email'), ''),
        NULLIF(btrim(clean_payload->>'address'), ''), NULLIF(btrim(clean_payload->>'city'), ''),
        COALESCE(NULLIF(btrim(clean_payload->>'country'), ''), 'Saudi Arabia'),
        NULLIF(btrim(clean_payload->>'bank_name'), ''), NULLIF(btrim(clean_payload->>'iban'), ''),
        NULLIF(btrim(clean_payload->>'payment_terms'), ''),
        COALESCE((clean_payload->>'is_active')::boolean, true), p_actor_user_id, 1
      ) RETURNING * INTO vendor_row;
      operation_value := 'insert';
      change_value := 'created';
    ELSE
      SELECT * INTO vendor_row FROM public.accounting_vendors
      WHERE organization_id = p_org_id AND id = p_entity_id FOR UPDATE;
      IF vendor_row.id IS NULL THEN
        RAISE EXCEPTION 'Accounting vendor was not found.' USING ERRCODE = 'P0002';
      END IF;
      IF vendor_row.version <> COALESCE(p_expected_version, 0) THEN
        RAISE EXCEPTION 'Accounting vendor version conflict.' USING ERRCODE = '40001';
      END IF;
      IF p_operation = 'deactivate' THEN
        vendor_row.is_active := false;
        change_value := 'deactivated';
      ELSE
        vendor_row := jsonb_populate_record(vendor_row, clean_payload);
        change_value := 'updated';
      END IF;
      vendor_row.id := p_entity_id;
      vendor_row.organization_id := p_org_id;
      vendor_row.version := COALESCE(p_expected_version, 0) + 1;
      UPDATE public.accounting_vendors SET
        name_ar = vendor_row.name_ar, name_en = vendor_row.name_en,
        vat_number = vendor_row.vat_number,
        commercial_registration = vendor_row.commercial_registration,
        phone = vendor_row.phone, email = vendor_row.email, address = vendor_row.address,
        city = vendor_row.city, country = vendor_row.country, bank_name = vendor_row.bank_name,
        iban = vendor_row.iban, payment_terms = vendor_row.payment_terms,
        is_active = vendor_row.is_active, version = vendor_row.version
      WHERE id = vendor_row.id RETURNING * INTO vendor_row;
    END IF;
    IF NULLIF(btrim(vendor_row.name_ar), '') IS NULL THEN
      RAISE EXCEPTION 'Vendor Arabic name is required.' USING ERRCODE = '23514';
    END IF;
    target_id_value := vendor_row.id;
    version_value := vendor_row.version;
    name_value := vendor_row.name_ar;
    result_value := to_jsonb(vendor_row);

  ELSIF p_entity_type = 'settings' THEN
    table_name_value := 'accounting_settings';
    INSERT INTO public.accounting_settings (organization_id, version)
    VALUES (p_org_id, 1)
    ON CONFLICT (organization_id) DO NOTHING;
    GET DIAGNOSTICS settings_inserted_count = ROW_COUNT;
    settings_created := settings_inserted_count = 1;
    SELECT * INTO settings_row FROM public.accounting_settings
    WHERE organization_id = p_org_id FOR UPDATE;
    IF NOT settings_created AND settings_row.version <> COALESCE(p_expected_version, 0) THEN
      RAISE EXCEPTION 'Accounting settings version conflict.' USING ERRCODE = '40001';
    END IF;
    settings_row := jsonb_populate_record(settings_row, clean_payload);
    settings_row.organization_id := p_org_id;
    settings_row.version := CASE WHEN settings_created THEN 2 ELSE COALESCE(p_expected_version, 0) + 1 END;
    IF settings_row.fiscal_year_start_month NOT BETWEEN 1 AND 12
       OR NULLIF(btrim(settings_row.invoice_prefix), '') IS NULL
       OR NULLIF(btrim(settings_row.expense_prefix), '') IS NULL
       OR NULLIF(btrim(settings_row.journal_prefix), '') IS NULL
       OR NULLIF(btrim(settings_row.payment_prefix), '') IS NULL THEN
      RAISE EXCEPTION 'Accounting settings prefixes and fiscal-year month are invalid.' USING ERRCODE = '23514';
    END IF;
    UPDATE public.accounting_settings SET
      default_cash_account_id = settings_row.default_cash_account_id,
      default_bank_account_id = settings_row.default_bank_account_id,
      default_accounts_receivable_id = settings_row.default_accounts_receivable_id,
      default_accounts_payable_id = settings_row.default_accounts_payable_id,
      default_sales_revenue_id = settings_row.default_sales_revenue_id,
      default_vat_payable_id = settings_row.default_vat_payable_id,
      default_vat_receivable_id = settings_row.default_vat_receivable_id,
      default_salary_expense_id = settings_row.default_salary_expense_id,
      default_salary_payable_id = settings_row.default_salary_payable_id,
      default_employee_advances_id = settings_row.default_employee_advances_id,
      default_asset_account_id = settings_row.default_asset_account_id,
      default_depreciation_expense_id = settings_row.default_depreciation_expense_id,
      default_accumulated_depreciation_id = settings_row.default_accumulated_depreciation_id,
      default_gosi_payable_id = settings_row.default_gosi_payable_id,
      default_gosi_expense_id = settings_row.default_gosi_expense_id,
      default_eosb_expense_id = settings_row.default_eosb_expense_id,
      default_eosb_provision_id = settings_row.default_eosb_provision_id,
      default_leave_encashment_id = settings_row.default_leave_encashment_id,
      default_allowances_expense_id = settings_row.default_allowances_expense_id,
      default_commission_expense_id = settings_row.default_commission_expense_id,
      default_commission_payable_id = settings_row.default_commission_payable_id,
      fiscal_year_start_month = settings_row.fiscal_year_start_month,
      invoice_prefix = settings_row.invoice_prefix,
      expense_prefix = settings_row.expense_prefix,
      journal_prefix = settings_row.journal_prefix,
      payment_prefix = settings_row.payment_prefix,
      version = settings_row.version
    WHERE organization_id = p_org_id RETURNING * INTO settings_row;
    target_id_value := settings_row.id;
    version_value := settings_row.version;
    operation_value := CASE WHEN settings_created THEN 'insert' ELSE 'update' END;
    change_value := CASE WHEN settings_created THEN 'created' ELSE 'updated' END;
    name_value := 'Accounting settings';
    result_value := to_jsonb(settings_row);

  ELSE
    table_name_value := 'accounting_journal_entries';
    SELECT * INTO journal_row FROM public.accounting_journal_entries
    WHERE organization_id = p_org_id AND id = p_entity_id FOR UPDATE;
    IF journal_row.id IS NULL THEN
      RAISE EXCEPTION 'Accounting journal was not found.' USING ERRCODE = 'P0002';
    END IF;
    IF journal_row.version <> COALESCE(p_expected_version, 0) THEN
      RAISE EXCEPTION 'Accounting journal version conflict.' USING ERRCODE = '40001';
    END IF;
    IF journal_row.status IN ('posted', 'reversed') THEN
      RAISE EXCEPTION 'Posted or reversed journals cannot be cancelled.' USING ERRCODE = '55000';
    END IF;
    IF journal_row.status <> 'cancelled' THEN
      UPDATE public.accounting_journal_entries SET
        status = 'cancelled', version = version + 1, updated_at = now()
      WHERE id = journal_row.id RETURNING * INTO journal_row;
    END IF;
    target_id_value := journal_row.id;
    version_value := journal_row.version;
    change_value := 'cancelled';
    record_type_value := journal_row.source_module;
    name_value := journal_row.entry_no;
    description_value := journal_row.description;
    result_value := to_jsonb(journal_row);
  END IF;

  event_payload := jsonb_strip_nulls(jsonb_build_object(
    'event_type', 'accounting.record_changed',
    'table_name', table_name_value,
    'record_id', target_id_value,
    'operation', operation_value,
    'change', change_value,
    'status', CASE WHEN p_entity_type = 'journal' THEN journal_row.status ELSE NULL END,
    'record_type', record_type_value,
    'name', name_value,
    'number', CASE WHEN p_entity_type = 'journal' THEN journal_row.entry_no ELSE NULL END,
    'description', description_value,
    'version', GREATEST(version_value, 1)
  ));
  INSERT INTO public.business_events (
    org_id, source_type, business_key, event_version, payload, payload_hash,
    status, request_id, actor_user_id, occurred_at, processed_at
  ) VALUES (
    p_org_id, 'accounting_master', p_command_id::text, GREATEST(version_value, 1),
    event_payload, encode(digest(event_payload::text, 'sha256'), 'hex'),
    'completed', p_request_id, p_actor_user_id, now(), now()
  ) RETURNING id INTO event_id;
  INSERT INTO public.event_outbox (
    org_id, business_event_id, topic, payload, payload_hash
  ) VALUES (
    p_org_id, event_id, 'accounting.record_changed', event_payload,
    encode(digest(event_payload::text, 'sha256'), 'hex')
  );
  INSERT INTO public.operational_audit_logs (
    org_id, request_id, actor_user_id, actor_role, action, target_type,
    target_id, outcome, status_code, metadata
  ) VALUES (
    p_org_id, p_request_id, p_actor_user_id, actor_role_value,
    'accounting.' || p_entity_type || '_' || change_value,
    table_name_value, target_id_value::text, 'success', 200,
    jsonb_build_object('version', version_value, 'command_id', p_command_id)
  );
  UPDATE public.accounting_commands SET
    entity_id = target_id_value, status = 'completed', result = result_value,
    completed_at = now()
  WHERE id = command_row.id;
  RETURN result_value;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_accounting_master_command(
  uuid, uuid, uuid, uuid, text, uuid, integer, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_accounting_master_command(
  uuid, uuid, uuid, uuid, text, uuid, integer, text, jsonb
) TO service_role;

COMMENT ON FUNCTION public.execute_accounting_master_command(uuid, uuid, uuid, uuid, text, uuid, integer, text, jsonb) IS
  'Atomically saves/deactivates accounting master data or cancels a journal with optimistic versioning, audit, and outbox evidence.';
