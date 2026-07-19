-- Publish accounting document/configuration notifications from the transaction
-- that changes the source row. HTTP handlers no longer perform best-effort
-- notification inserts after a financial command has already committed.

CREATE OR REPLACE FUNCTION public.accounting_emit_record_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_data jsonb := to_jsonb(NEW);
  old_data jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  org_id_value uuid := (new_data->>'organization_id')::uuid;
  record_id_value uuid := (new_data->>'id')::uuid;
  version_value integer := GREATEST(COALESCE((new_data->>'version')::integer, 1), 1);
  actor_user_id_value uuid;
  request_id_value uuid;
  change_value text;
  business_key_value text;
  event_payload jsonb;
  payload_hash_value text;
  event_id_value uuid;
BEGIN
  IF TG_TABLE_NAME = 'accounting_expenses' THEN
    IF TG_OP = 'UPDATE'
       AND old_data->>'status' IS NOT DISTINCT FROM new_data->>'status'
       AND old_data->>'paid_status' IS NOT DISTINCT FROM new_data->>'paid_status' THEN
      RETURN NEW;
    END IF;
    change_value := CASE
      WHEN TG_OP = 'INSERT' THEN 'created'
      WHEN old_data->>'status' IS DISTINCT FROM new_data->>'status' THEN new_data->>'status'
      ELSE new_data->>'paid_status'
    END;
  ELSIF TG_TABLE_NAME = 'accounting_invoices' THEN
    IF TG_OP <> 'UPDATE' OR old_data->>'status' IS NOT DISTINCT FROM new_data->>'status' THEN
      RETURN NEW;
    END IF;
    change_value := new_data->>'status';
  ELSIF TG_TABLE_NAME = 'accounting_payments' THEN
    IF TG_OP <> 'UPDATE' OR new_data->>'status' <> 'posted'
       OR old_data->>'status' IS NOT DISTINCT FROM new_data->>'status' THEN
      RETURN NEW;
    END IF;
    change_value := 'posted';
  ELSIF TG_TABLE_NAME = 'accounting_periods' THEN
    IF TG_OP <> 'UPDATE' OR old_data->>'status' IS NOT DISTINCT FROM new_data->>'status' THEN
      RETURN NEW;
    END IF;
    change_value := new_data->>'status';
  ELSIF TG_TABLE_NAME = 'accounting_journal_entries' THEN
    IF TG_OP <> 'INSERT' OR new_data->>'status' <> 'draft'
       OR new_data->>'source_module' <> 'payroll' THEN
      RETURN NEW;
    END IF;
    change_value := 'payroll_draft_created';
  ELSE
    IF TG_OP <> 'UPDATE' THEN RETURN NEW; END IF;
    change_value := 'updated';
  END IF;

  SELECT command.request_id, command.actor_user_id
    INTO request_id_value, actor_user_id_value
  FROM public.accounting_commands command
  WHERE command.organization_id = org_id_value
    AND command.status = 'processing'
    AND (
      command.entity_id = record_id_value
      OR command.actor_user_id::text IN (
        new_data->>'created_by', new_data->>'updated_by', new_data->>'approved_by',
        new_data->>'issued_by', new_data->>'posted_by', new_data->>'closed_by'
      )
    )
  ORDER BY command.created_at DESC
  LIMIT 1;

  actor_user_id_value := COALESCE(
    actor_user_id_value,
    NULLIF(new_data->>'posted_by', '')::uuid,
    NULLIF(new_data->>'approved_by', '')::uuid,
    NULLIF(new_data->>'issued_by', '')::uuid,
    NULLIF(new_data->>'closed_by', '')::uuid,
    NULLIF(new_data->>'updated_by', '')::uuid,
    NULLIF(new_data->>'created_by', '')::uuid
  );
  event_payload := jsonb_strip_nulls(jsonb_build_object(
    'event_type', 'accounting.record_changed',
    'table_name', TG_TABLE_NAME,
    'record_id', record_id_value,
    'operation', lower(TG_OP),
    'change', change_value,
    'status', new_data->>'status',
    'prior_status', old_data->>'status',
    'paid_status', new_data->>'paid_status',
    'record_type', new_data->>'type',
    'number', COALESCE(
      new_data->>'expense_no', new_data->>'invoice_no', new_data->>'payment_no',
      new_data->>'entry_no'
    ),
    'name', COALESCE(new_data->>'name', new_data->>'name_ar'),
    'description', new_data->>'description',
    'invoice_id', new_data->>'invoice_id',
    'expense_id', new_data->>'expense_id',
    'payroll_id', new_data->>'payroll_id',
    'source_module', new_data->>'source_module',
    'version', version_value
  ));
  payload_hash_value := encode(digest(event_payload::text, 'sha256'), 'hex');
  business_key_value := TG_TABLE_NAME || ':' || record_id_value::text || ':'
    || change_value || ':' || version_value::text || ':' || gen_random_uuid()::text;

  INSERT INTO public.business_events (
    org_id, source_type, business_key, event_version, payload, payload_hash,
    status, request_id, actor_user_id, occurred_at, processed_at
  ) VALUES (
    org_id_value, 'accounting_record', business_key_value, version_value,
    event_payload, payload_hash_value, 'completed', request_id_value,
    actor_user_id_value, now(), now()
  ) RETURNING id INTO event_id_value;
  INSERT INTO public.event_outbox (
    org_id, business_event_id, topic, payload, payload_hash
  ) VALUES (
    org_id_value, event_id_value, 'accounting.record_changed',
    event_payload, payload_hash_value
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_accounting_expense_record_event ON public.accounting_expenses;
CREATE TRIGGER trg_accounting_expense_record_event
  AFTER INSERT OR UPDATE ON public.accounting_expenses
  FOR EACH ROW EXECUTE FUNCTION public.accounting_emit_record_event();

DROP TRIGGER IF EXISTS trg_accounting_invoice_record_event ON public.accounting_invoices;
CREATE TRIGGER trg_accounting_invoice_record_event
  AFTER UPDATE ON public.accounting_invoices
  FOR EACH ROW EXECUTE FUNCTION public.accounting_emit_record_event();

DROP TRIGGER IF EXISTS trg_accounting_payment_record_event ON public.accounting_payments;
CREATE TRIGGER trg_accounting_payment_record_event
  AFTER UPDATE ON public.accounting_payments
  FOR EACH ROW EXECUTE FUNCTION public.accounting_emit_record_event();

DROP TRIGGER IF EXISTS trg_accounting_period_record_event ON public.accounting_periods;
CREATE TRIGGER trg_accounting_period_record_event
  AFTER UPDATE ON public.accounting_periods
  FOR EACH ROW EXECUTE FUNCTION public.accounting_emit_record_event();

DROP TRIGGER IF EXISTS trg_accounting_settings_record_event ON public.accounting_settings;
CREATE TRIGGER trg_accounting_settings_record_event
  AFTER UPDATE ON public.accounting_settings
  FOR EACH ROW EXECUTE FUNCTION public.accounting_emit_record_event();

DROP TRIGGER IF EXISTS trg_accounting_account_record_event ON public.accounting_accounts;
CREATE TRIGGER trg_accounting_account_record_event
  AFTER UPDATE ON public.accounting_accounts
  FOR EACH ROW EXECUTE FUNCTION public.accounting_emit_record_event();

DROP TRIGGER IF EXISTS trg_accounting_cost_center_record_event ON public.accounting_cost_centers;
CREATE TRIGGER trg_accounting_cost_center_record_event
  AFTER UPDATE ON public.accounting_cost_centers
  FOR EACH ROW EXECUTE FUNCTION public.accounting_emit_record_event();

DROP TRIGGER IF EXISTS trg_accounting_vendor_record_event ON public.accounting_vendors;
CREATE TRIGGER trg_accounting_vendor_record_event
  AFTER UPDATE ON public.accounting_vendors
  FOR EACH ROW EXECUTE FUNCTION public.accounting_emit_record_event();

DROP TRIGGER IF EXISTS trg_accounting_payroll_draft_record_event ON public.accounting_journal_entries;
CREATE TRIGGER trg_accounting_payroll_draft_record_event
  AFTER INSERT ON public.accounting_journal_entries
  FOR EACH ROW EXECUTE FUNCTION public.accounting_emit_record_event();

REVOKE ALL ON FUNCTION public.accounting_emit_record_event()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.accounting_emit_record_event() IS
  'Appends an accounting.record_changed event/outbox row in the same transaction as a notification-worthy accounting transition.';
