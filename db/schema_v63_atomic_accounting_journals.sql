-- Atomic, idempotent accounting journal commands and race-free numbering.

ALTER TABLE public.accounting_journal_entries
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 0;

ALTER TABLE public.accounting_journal_entries
  DROP CONSTRAINT IF EXISTS accounting_journal_entries_version_check,
  ADD CONSTRAINT accounting_journal_entries_version_check CHECK (version >= 0);

-- Refuse to conceal duplicate source journals. Existing duplicates must be
-- reconciled before this migration can be applied.
CREATE UNIQUE INDEX IF NOT EXISTS uq_accounting_journal_active_source
  ON public.accounting_journal_entries(organization_id, source_module, source_id)
  WHERE source_id IS NOT NULL AND status <> 'cancelled';

CREATE TABLE IF NOT EXISTS public.accounting_document_counters (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  document_type text NOT NULL CHECK (document_type IN ('journal', 'invoice', 'expense', 'payment')),
  period_key text NOT NULL CHECK (period_key ~ '^[0-9]{6}$'),
  prefix text NOT NULL CHECK (prefix ~ '^[A-Z0-9-]+$'),
  last_value bigint NOT NULL CHECK (last_value > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, document_type, period_key, prefix)
);

CREATE TABLE IF NOT EXISTS public.accounting_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  idempotency_key uuid NOT NULL,
  action text NOT NULL CHECK (action IN (
    'journal_create', 'journal_update', 'journal_post', 'journal_reverse'
  )),
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

CREATE INDEX IF NOT EXISTS accounting_commands_org_created_idx
  ON public.accounting_commands(organization_id, created_at DESC);

ALTER TABLE public.accounting_document_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_commands ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS accounting_document_counters_select ON public.accounting_document_counters;
CREATE POLICY accounting_document_counters_select ON public.accounting_document_counters
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR (organization_id = public.current_org_id() AND public.can_view_accounting())
  );

DROP POLICY IF EXISTS accounting_commands_select ON public.accounting_commands;
CREATE POLICY accounting_commands_select ON public.accounting_commands
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR (organization_id = public.current_org_id() AND public.can_view_accounting())
  );

-- Journal mutations are server command-owned. Tenant browser sessions retain
-- read access through the existing SELECT policies.
DROP POLICY IF EXISTS accounting_journal_entries_insert ON public.accounting_journal_entries;
DROP POLICY IF EXISTS accounting_journal_entries_update ON public.accounting_journal_entries;
DROP POLICY IF EXISTS accounting_journal_entries_delete ON public.accounting_journal_entries;
DROP POLICY IF EXISTS accounting_journal_lines_insert ON public.accounting_journal_lines;
DROP POLICY IF EXISTS accounting_journal_lines_update ON public.accounting_journal_lines;
DROP POLICY IF EXISTS accounting_journal_lines_delete ON public.accounting_journal_lines;
DROP POLICY IF EXISTS accounting_source_postings_insert ON public.accounting_source_postings;
DROP POLICY IF EXISTS accounting_source_postings_update ON public.accounting_source_postings;
DROP POLICY IF EXISTS accounting_source_postings_delete ON public.accounting_source_postings;

CREATE OR REPLACE FUNCTION public.next_accounting_document_number(
  p_org_id uuid,
  p_document_type text,
  p_prefix text,
  p_document_date date
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  clean_prefix text := upper(regexp_replace(COALESCE(NULLIF(btrim(p_prefix), ''), 'DOC'), '[^A-Za-z0-9-]', '', 'g'));
  period_value text := to_char(p_document_date, 'YYYYMM');
  number_base text;
  legacy_max bigint := 0;
  allocated bigint;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_document_type NOT IN ('journal', 'invoice', 'expense', 'payment') THEN
    RAISE EXCEPTION 'Unsupported accounting document type.' USING ERRCODE = '22023';
  END IF;
  IF clean_prefix = '' THEN clean_prefix := 'DOC'; END IF;
  number_base := clean_prefix || '-' || period_value;

  IF p_document_type = 'journal' THEN
    SELECT COALESCE(max((substring(entry_no FROM '([0-9]+)$'))::bigint), 0)
      INTO legacy_max
    FROM public.accounting_journal_entries
    WHERE organization_id = p_org_id AND entry_no LIKE number_base || '-%'
      AND entry_no ~ '[0-9]+$';
  ELSIF p_document_type = 'invoice' THEN
    SELECT COALESCE(max((substring(invoice_no FROM '([0-9]+)$'))::bigint), 0)
      INTO legacy_max
    FROM public.accounting_invoices
    WHERE organization_id = p_org_id AND invoice_no LIKE number_base || '-%'
      AND invoice_no ~ '[0-9]+$';
  ELSIF p_document_type = 'expense' THEN
    SELECT COALESCE(max((substring(expense_no FROM '([0-9]+)$'))::bigint), 0)
      INTO legacy_max
    FROM public.accounting_expenses
    WHERE organization_id = p_org_id AND expense_no LIKE number_base || '-%'
      AND expense_no ~ '[0-9]+$';
  ELSE
    SELECT COALESCE(max((substring(payment_no FROM '([0-9]+)$'))::bigint), 0)
      INTO legacy_max
    FROM public.accounting_payments
    WHERE organization_id = p_org_id AND payment_no LIKE number_base || '-%'
      AND payment_no ~ '[0-9]+$';
  END IF;

  INSERT INTO public.accounting_document_counters (
    organization_id, document_type, period_key, prefix, last_value
  ) VALUES (
    p_org_id, p_document_type, period_value, clean_prefix, legacy_max + 1
  )
  ON CONFLICT (organization_id, document_type, period_key, prefix)
  DO UPDATE SET last_value = public.accounting_document_counters.last_value + 1,
                updated_at = now()
  RETURNING last_value INTO allocated;

  RETURN number_base || '-' || lpad(allocated::text, 4, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.accounting_save_journal(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_request_id uuid,
  p_entry_id uuid,
  p_expected_version integer,
  p_payload jsonb
)
RETURNS SETOF public.accounting_journal_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  command_row public.accounting_commands%ROWTYPE;
  entry_row public.accounting_journal_entries%ROWTYPE;
  settings_row public.accounting_settings%ROWTYPE;
  command_action text := CASE WHEN p_entry_id IS NULL THEN 'journal_create' ELSE 'journal_update' END;
  payload_hash_value text := encode(digest(jsonb_build_object('entry_id', p_entry_id, 'expected_version', p_expected_version, 'payload', p_payload)::text, 'sha256'), 'hex');
  actor_role_value text;
  entry_date_value date;
  target_status text;
  source_module_value text;
  source_id_value uuid;
  line_count integer;
  valid_account_count integer;
  debit_total numeric(14,2);
  credit_total numeric(14,2);
  now_value timestamptz := now();
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  SELECT role::text INTO actor_role_value FROM public.org_members
  WHERE org_id = p_org_id AND user_id = p_actor_user_id
    AND role::text IN ('finance_manager', 'accountant');
  IF actor_role_value IS NULL THEN RAISE EXCEPTION 'Accounting management access is required.' USING ERRCODE = '42501'; END IF;

  entry_date_value := (p_payload->>'entryDate')::date;
  target_status := COALESCE(NULLIF(p_payload->>'status', ''), 'draft');
  source_module_value := COALESCE(NULLIF(btrim(p_payload->>'sourceModule'), ''), 'manual');
  source_id_value := NULLIF(p_payload->>'sourceId', '')::uuid;
  IF target_status NOT IN ('draft', 'pending_approval', 'posted') THEN
    RAISE EXCEPTION 'Unsupported journal target status.' USING ERRCODE = '22023';
  END IF;
  IF target_status = 'posted' AND actor_role_value <> 'finance_manager' THEN
    RAISE EXCEPTION 'Finance Manager access is required to post journals.' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(p_payload->>'description'), '') IS NULL THEN
    RAISE EXCEPTION 'Journal description is required.' USING ERRCODE = '23514';
  END IF;
  IF jsonb_typeof(p_payload->'lines') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Journal lines must be an array.' USING ERRCODE = '22023';
  END IF;

  SELECT count(*)::integer,
         COALESCE(sum(round(COALESCE((line->>'debit')::numeric, 0), 2)), 0)::numeric(14,2),
         COALESCE(sum(round(COALESCE((line->>'credit')::numeric, 0), 2)), 0)::numeric(14,2)
    INTO line_count, debit_total, credit_total
  FROM jsonb_array_elements(p_payload->'lines') line
  WHERE NULLIF(line->>'account_id', '') IS NOT NULL
    AND round(COALESCE((line->>'debit')::numeric, 0), 2) >= 0
    AND round(COALESCE((line->>'credit')::numeric, 0), 2) >= 0
    AND ((round(COALESCE((line->>'debit')::numeric, 0), 2) > 0 AND round(COALESCE((line->>'credit')::numeric, 0), 2) = 0)
      OR (round(COALESCE((line->>'credit')::numeric, 0), 2) > 0 AND round(COALESCE((line->>'debit')::numeric, 0), 2) = 0));
  IF line_count <> jsonb_array_length(p_payload->'lines') OR line_count < 2 THEN
    RAISE EXCEPTION 'Every journal line must contain exactly one positive debit or credit amount.' USING ERRCODE = '23514';
  END IF;
  IF debit_total <> credit_total OR debit_total <= 0 THEN
    RAISE EXCEPTION 'Journal lines must contain equal positive debit and credit totals.' USING ERRCODE = '23514';
  END IF;

  SELECT count(DISTINCT a.id)::integer INTO valid_account_count
  FROM public.accounting_accounts a
  WHERE a.organization_id = p_org_id AND a.is_active = true
    AND a.id IN (SELECT (line->>'account_id')::uuid FROM jsonb_array_elements(p_payload->'lines') line);
  IF valid_account_count <> (
    SELECT count(DISTINCT (line->>'account_id')::uuid)::integer FROM jsonb_array_elements(p_payload->'lines') line
  ) THEN RAISE EXCEPTION 'Every journal account must be active and belong to the organization.' USING ERRCODE = '23514'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.accounting_periods
    WHERE organization_id = p_org_id AND start_date <= entry_date_value AND end_date >= entry_date_value
      AND status IN ('closed', 'locked')
  ) THEN RAISE EXCEPTION 'Cannot use a closed or locked accounting period.' USING ERRCODE = '55000'; END IF;

  INSERT INTO public.accounting_commands (
    organization_id, idempotency_key, action, entity_id, payload_hash,
    actor_user_id, request_id
  ) VALUES (
    p_org_id, p_command_id, command_action, p_entry_id, payload_hash_value,
    p_actor_user_id, p_request_id
  ) ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
  SELECT * INTO command_row FROM public.accounting_commands
  WHERE organization_id = p_org_id AND idempotency_key = p_command_id FOR UPDATE;
  IF command_row.action <> command_action OR command_row.payload_hash <> payload_hash_value THEN
    RAISE EXCEPTION 'Idempotency key was used for a different accounting command.' USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN
    RETURN QUERY SELECT * FROM public.accounting_journal_entries
      WHERE organization_id = p_org_id AND id = command_row.entity_id;
    RETURN;
  END IF;

  IF p_entry_id IS NULL THEN
    SELECT * INTO settings_row FROM public.accounting_settings WHERE organization_id = p_org_id;
    INSERT INTO public.accounting_journal_entries (
      organization_id, entry_no, entry_date, description, source_module, source_id,
      status, currency, total_debit, total_credit, created_by, notes, version
    ) VALUES (
      p_org_id,
      public.next_accounting_document_number(p_org_id, 'journal', COALESCE(settings_row.journal_prefix, 'JE'), entry_date_value),
      entry_date_value, btrim(p_payload->>'description'), source_module_value, source_id_value,
      'draft', 'SAR', debit_total, credit_total, p_actor_user_id,
      NULLIF(btrim(p_payload->>'notes'), ''), 0
    ) RETURNING * INTO entry_row;
  ELSE
    SELECT * INTO entry_row FROM public.accounting_journal_entries
    WHERE organization_id = p_org_id AND id = p_entry_id FOR UPDATE;
    IF entry_row.id IS NULL THEN RAISE EXCEPTION 'Journal entry was not found.' USING ERRCODE = 'P0002'; END IF;
    IF entry_row.status <> 'draft' THEN RAISE EXCEPTION 'Only a draft journal can be edited.' USING ERRCODE = '55000'; END IF;
    IF entry_row.version <> p_expected_version THEN RAISE EXCEPTION 'Journal version conflict.' USING ERRCODE = '40001'; END IF;
    IF source_module_value <> entry_row.source_module OR source_id_value IS DISTINCT FROM entry_row.source_id THEN
      RAISE EXCEPTION 'Journal source cannot be changed.' USING ERRCODE = '23514';
    END IF;
    UPDATE public.accounting_journal_entries SET
      entry_date = entry_date_value, description = btrim(p_payload->>'description'),
      notes = NULLIF(btrim(p_payload->>'notes'), ''), total_debit = debit_total,
      total_credit = credit_total, version = version + 1, updated_at = now_value
    WHERE id = entry_row.id RETURNING * INTO entry_row;
    DELETE FROM public.accounting_journal_lines WHERE journal_entry_id = entry_row.id AND organization_id = p_org_id;
  END IF;

  INSERT INTO public.accounting_journal_lines (
    organization_id, journal_entry_id, account_id, debit, credit, description,
    cost_center_id, employee_id, department_id, location_id
  )
  SELECT p_org_id, entry_row.id, (line->>'account_id')::uuid,
    round(COALESCE((line->>'debit')::numeric, 0), 2), round(COALESCE((line->>'credit')::numeric, 0), 2),
    NULLIF(btrim(line->>'description'), ''), NULLIF(line->>'cost_center_id', '')::uuid,
    NULLIF(line->>'employee_id', '')::uuid, NULLIF(line->>'department_id', '')::uuid,
    NULLIF(line->>'location_id', '')::uuid
  FROM jsonb_array_elements(p_payload->'lines') line;

  IF target_status <> 'draft' THEN
    UPDATE public.accounting_journal_entries SET
      status = target_status,
      approved_by = CASE WHEN target_status = 'posted' THEN p_actor_user_id ELSE approved_by END,
      posted_by = CASE WHEN target_status = 'posted' THEN p_actor_user_id ELSE posted_by END,
      approved_at = CASE WHEN target_status = 'posted' THEN now_value ELSE approved_at END,
      posted_at = CASE WHEN target_status = 'posted' THEN now_value ELSE posted_at END,
      version = version + 1, updated_at = now_value
    WHERE id = entry_row.id RETURNING * INTO entry_row;
  END IF;
  IF target_status = 'posted' AND source_id_value IS NOT NULL THEN
    INSERT INTO public.accounting_source_postings (
      organization_id, source_module, source_id, journal_entry_id, status
    ) VALUES (p_org_id, source_module_value, source_id_value, entry_row.id, 'posted');
  END IF;

  INSERT INTO public.operational_audit_logs (
    org_id, request_id, actor_user_id, actor_role, action, target_type,
    target_id, outcome, status_code, metadata
  ) VALUES (
    p_org_id, p_request_id, p_actor_user_id, actor_role_value,
    CASE WHEN target_status = 'posted' THEN 'accounting.journal_posted'
         WHEN p_entry_id IS NULL THEN 'accounting.journal_created'
         ELSE 'accounting.journal_updated' END,
    'accounting_journal_entries', entry_row.id::text, 'success',
    CASE WHEN p_entry_id IS NULL THEN 201 ELSE 200 END,
    jsonb_build_object('entry_no', entry_row.entry_no, 'status', entry_row.status,
      'total_debit', entry_row.total_debit, 'total_credit', entry_row.total_credit,
      'version', entry_row.version)
  );
  UPDATE public.accounting_commands SET entity_id = entry_row.id, status = 'completed',
    completed_at = now_value,
    result = jsonb_build_object('journal_entry_id', entry_row.id, 'entry_no', entry_row.entry_no,
      'status', entry_row.status, 'version', entry_row.version)
  WHERE id = command_row.id;
  RETURN NEXT entry_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.accounting_post_journal(
  p_org_id uuid,
  p_entry_id uuid,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_request_id uuid,
  p_expected_version integer
)
RETURNS SETOF public.accounting_journal_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  command_row public.accounting_commands%ROWTYPE;
  entry_row public.accounting_journal_entries%ROWTYPE;
  actor_role_value text;
  payload_hash_value text := encode(digest(jsonb_build_object('entry_id', p_entry_id, 'expected_version', p_expected_version)::text, 'sha256'), 'hex');
  line_count integer;
  debit_total numeric(14,2);
  credit_total numeric(14,2);
  now_value timestamptz := now();
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  SELECT role::text INTO actor_role_value FROM public.org_members
  WHERE org_id = p_org_id AND user_id = p_actor_user_id AND role::text = 'finance_manager';
  IF actor_role_value IS NULL THEN RAISE EXCEPTION 'Finance Manager access is required.' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.accounting_commands (organization_id, idempotency_key, action, entity_id, payload_hash, actor_user_id, request_id)
  VALUES (p_org_id, p_command_id, 'journal_post', p_entry_id, payload_hash_value, p_actor_user_id, p_request_id)
  ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
  SELECT * INTO command_row FROM public.accounting_commands
  WHERE organization_id = p_org_id AND idempotency_key = p_command_id FOR UPDATE;
  IF command_row.action <> 'journal_post' OR command_row.payload_hash <> payload_hash_value THEN
    RAISE EXCEPTION 'Idempotency key was used for a different accounting command.' USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN
    RETURN QUERY SELECT * FROM public.accounting_journal_entries WHERE organization_id = p_org_id AND id = p_entry_id;
    RETURN;
  END IF;
  SELECT * INTO entry_row FROM public.accounting_journal_entries
  WHERE organization_id = p_org_id AND id = p_entry_id FOR UPDATE;
  IF entry_row.id IS NULL THEN RAISE EXCEPTION 'Journal entry was not found.' USING ERRCODE = 'P0002'; END IF;
  IF entry_row.status NOT IN ('draft', 'pending_approval') THEN RAISE EXCEPTION 'Only draft or pending journals can be posted.' USING ERRCODE = '55000'; END IF;
  IF entry_row.version <> p_expected_version THEN RAISE EXCEPTION 'Journal version conflict.' USING ERRCODE = '40001'; END IF;
  SELECT count(*)::integer, COALESCE(sum(debit), 0)::numeric(14,2), COALESCE(sum(credit), 0)::numeric(14,2)
    INTO line_count, debit_total, credit_total
  FROM public.accounting_journal_lines WHERE organization_id = p_org_id AND journal_entry_id = p_entry_id;
  IF line_count < 2 OR debit_total <> credit_total OR debit_total <> entry_row.total_debit OR credit_total <> entry_row.total_credit THEN
    RAISE EXCEPTION 'Journal entry is not balanced.' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.accounting_periods WHERE organization_id = p_org_id
      AND start_date <= entry_row.entry_date AND end_date >= entry_row.entry_date AND status IN ('closed', 'locked')) THEN
    RAISE EXCEPTION 'Cannot post into a closed or locked accounting period.' USING ERRCODE = '55000';
  END IF;
  IF entry_row.source_id IS NOT NULL THEN
    INSERT INTO public.accounting_source_postings (organization_id, source_module, source_id, journal_entry_id, status)
    VALUES (p_org_id, entry_row.source_module, entry_row.source_id, entry_row.id, 'posted');
  END IF;
  UPDATE public.accounting_journal_entries SET status = 'posted', approved_by = p_actor_user_id,
    posted_by = p_actor_user_id, approved_at = now_value, posted_at = now_value,
    version = version + 1, updated_at = now_value
  WHERE id = p_entry_id RETURNING * INTO entry_row;
  INSERT INTO public.operational_audit_logs (org_id, request_id, actor_user_id, actor_role, action,
    target_type, target_id, outcome, status_code, metadata)
  VALUES (p_org_id, p_request_id, p_actor_user_id, actor_role_value, 'accounting.journal_posted',
    'accounting_journal_entries', entry_row.id::text, 'success', 200,
    jsonb_build_object('entry_no', entry_row.entry_no, 'version', entry_row.version));
  UPDATE public.accounting_commands SET status = 'completed', completed_at = now_value,
    result = jsonb_build_object('journal_entry_id', entry_row.id, 'status', entry_row.status, 'version', entry_row.version)
  WHERE id = command_row.id;
  RETURN NEXT entry_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.accounting_reverse_journal(
  p_org_id uuid,
  p_entry_id uuid,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_request_id uuid,
  p_expected_version integer,
  p_reason text
)
RETURNS SETOF public.accounting_journal_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  command_row public.accounting_commands%ROWTYPE;
  original_row public.accounting_journal_entries%ROWTYPE;
  reversal_row public.accounting_journal_entries%ROWTYPE;
  settings_row public.accounting_settings%ROWTYPE;
  actor_role_value text;
  reversal_date date := current_date;
  now_value timestamptz := now();
  payload_hash_value text := encode(digest(jsonb_build_object('entry_id', p_entry_id, 'expected_version', p_expected_version, 'reason', COALESCE(p_reason, ''))::text, 'sha256'), 'hex');
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  SELECT role::text INTO actor_role_value FROM public.org_members
  WHERE org_id = p_org_id AND user_id = p_actor_user_id AND role::text = 'finance_manager';
  IF actor_role_value IS NULL THEN RAISE EXCEPTION 'Finance Manager access is required.' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.accounting_commands (organization_id, idempotency_key, action, entity_id, payload_hash, actor_user_id, request_id)
  VALUES (p_org_id, p_command_id, 'journal_reverse', p_entry_id, payload_hash_value, p_actor_user_id, p_request_id)
  ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
  SELECT * INTO command_row FROM public.accounting_commands
  WHERE organization_id = p_org_id AND idempotency_key = p_command_id FOR UPDATE;
  IF command_row.action <> 'journal_reverse' OR command_row.payload_hash <> payload_hash_value THEN
    RAISE EXCEPTION 'Idempotency key was used for a different accounting command.' USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN
    RETURN QUERY SELECT * FROM public.accounting_journal_entries
      WHERE organization_id = p_org_id AND id = (command_row.result->>'reversal_entry_id')::uuid;
    RETURN;
  END IF;
  SELECT * INTO original_row FROM public.accounting_journal_entries
  WHERE organization_id = p_org_id AND id = p_entry_id FOR UPDATE;
  IF original_row.id IS NULL THEN RAISE EXCEPTION 'Journal entry was not found.' USING ERRCODE = 'P0002'; END IF;
  IF original_row.status <> 'posted' THEN RAISE EXCEPTION 'Only a posted journal can be reversed.' USING ERRCODE = '55000'; END IF;
  IF original_row.version <> p_expected_version THEN RAISE EXCEPTION 'Journal version conflict.' USING ERRCODE = '40001'; END IF;
  IF EXISTS (SELECT 1 FROM public.accounting_periods WHERE organization_id = p_org_id
      AND start_date <= reversal_date AND end_date >= reversal_date AND status IN ('closed', 'locked')) THEN
    RAISE EXCEPTION 'Cannot reverse into a closed or locked accounting period.' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO settings_row FROM public.accounting_settings WHERE organization_id = p_org_id;
  INSERT INTO public.accounting_journal_entries (
    organization_id, entry_no, entry_date, description, source_module, source_id,
    status, currency, total_debit, total_credit, created_by, approved_by, posted_by,
    approved_at, posted_at, reversal_of, notes, version
  ) VALUES (
    p_org_id, public.next_accounting_document_number(p_org_id, 'journal', COALESCE(settings_row.journal_prefix, 'JE'), reversal_date),
    reversal_date, 'Reversal of ' || original_row.entry_no || ': ' || COALESCE(NULLIF(btrim(p_reason), ''), original_row.description),
    'reversal', original_row.id, 'draft', original_row.currency,
    original_row.total_credit, original_row.total_debit, p_actor_user_id,
    NULL, NULL, NULL, NULL, original_row.id, NULLIF(btrim(p_reason), ''), 0
  ) RETURNING * INTO reversal_row;
  INSERT INTO public.accounting_journal_lines (
    organization_id, journal_entry_id, account_id, debit, credit, description,
    cost_center_id, employee_id, department_id, location_id
  ) SELECT organization_id, reversal_row.id, account_id, credit, debit,
      COALESCE(description, 'Reversal of ' || original_row.entry_no), cost_center_id,
      employee_id, department_id, location_id
    FROM public.accounting_journal_lines
    WHERE organization_id = p_org_id AND journal_entry_id = original_row.id;
  UPDATE public.accounting_journal_entries SET status = 'posted', approved_by = p_actor_user_id,
    posted_by = p_actor_user_id, approved_at = now_value, posted_at = now_value,
    version = 1, updated_at = now_value
  WHERE id = reversal_row.id RETURNING * INTO reversal_row;
  INSERT INTO public.accounting_source_postings (organization_id, source_module, source_id, journal_entry_id, status)
  VALUES (p_org_id, 'reversal', original_row.id, reversal_row.id, 'posted');
  UPDATE public.accounting_journal_entries SET status = 'reversed', reversed_by = p_actor_user_id,
    reversed_at = now_value, updated_at = now_value
  WHERE id = original_row.id;
  INSERT INTO public.operational_audit_logs (org_id, request_id, actor_user_id, actor_role, action,
    target_type, target_id, outcome, status_code, metadata)
  VALUES (p_org_id, p_request_id, p_actor_user_id, actor_role_value, 'accounting.journal_reversed',
    'accounting_journal_entries', original_row.id::text, 'success', 200,
    jsonb_build_object('entry_no', original_row.entry_no, 'reversal_entry_id', reversal_row.id,
      'reversal_entry_no', reversal_row.entry_no, 'reason', NULLIF(btrim(p_reason), '')));
  UPDATE public.accounting_commands SET status = 'completed', completed_at = now_value,
    result = jsonb_build_object('journal_entry_id', original_row.id, 'reversal_entry_id', reversal_row.id,
      'status', reversal_row.status)
  WHERE id = command_row.id;
  RETURN NEXT reversal_row;
END;
$$;

REVOKE ALL ON FUNCTION public.next_accounting_document_number(uuid, text, text, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.accounting_save_journal(uuid, uuid, uuid, uuid, uuid, integer, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.accounting_post_journal(uuid, uuid, uuid, uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.accounting_reverse_journal(uuid, uuid, uuid, uuid, uuid, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_accounting_document_number(uuid, text, text, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.accounting_save_journal(uuid, uuid, uuid, uuid, uuid, integer, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.accounting_post_journal(uuid, uuid, uuid, uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.accounting_reverse_journal(uuid, uuid, uuid, uuid, uuid, integer, text) TO service_role;

COMMENT ON TABLE public.accounting_commands IS
  'Idempotency ledger for server-owned accounting commands; one key may only represent one exact payload.';
COMMENT ON FUNCTION public.next_accounting_document_number(uuid, text, text, date) IS
  'Allocates an organization-scoped accounting number with an atomic row-locked counter.';
