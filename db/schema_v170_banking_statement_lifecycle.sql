-- Versioned, audited lifecycle commands for canonical v165 bank statements.
-- Statements and imported evidence are never hard-deleted; cancellation is archival.

ALTER TABLE public.banking_statements
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recalled_at timestamptz,
  ADD COLUMN IF NOT EXISTS recalled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recall_reason text,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archive_reason text;

-- Repair legacy counters before making them authoritative command preconditions.
UPDATE public.banking_statements statement
SET transaction_count = counts.transaction_count,
    matched_count = counts.matched_count
FROM (
  SELECT statement_row.id,
         count(line.id)::integer AS transaction_count,
         count(line.id) FILTER (
           WHERE line.match_status IN ('matched', 'manually_matched')
         )::integer AS matched_count
  FROM public.banking_statements statement_row
  LEFT JOIN public.banking_statement_lines line ON line.statement_id = statement_row.id
  GROUP BY statement_row.id
) counts
WHERE counts.id = statement.id
  AND (statement.transaction_count IS DISTINCT FROM counts.transaction_count
    OR statement.matched_count IS DISTINCT FROM counts.matched_count);

ALTER TABLE public.banking_statements
  DROP CONSTRAINT IF EXISTS banking_statements_status_check,
  ADD CONSTRAINT banking_statements_status_check
    CHECK (status IN ('imported', 'in_progress', 'reconciled', 'cancelled')),
  DROP CONSTRAINT IF EXISTS banking_statements_version_check,
  ADD CONSTRAINT banking_statements_version_check CHECK (version >= 0),
  DROP CONSTRAINT IF EXISTS banking_statements_transaction_count_check,
  ADD CONSTRAINT banking_statements_transaction_count_check CHECK (transaction_count >= 0),
  DROP CONSTRAINT IF EXISTS banking_statements_matched_count_check,
  ADD CONSTRAINT banking_statements_matched_count_check
    CHECK (matched_count >= 0 AND matched_count <= transaction_count),
  DROP CONSTRAINT IF EXISTS banking_statements_recall_metadata_check,
  ADD CONSTRAINT banking_statements_recall_metadata_check CHECK (
    (recalled_at IS NULL AND recalled_by IS NULL AND recall_reason IS NULL)
    OR (recalled_at IS NOT NULL AND recalled_by IS NOT NULL
      AND length(btrim(recall_reason)) BETWEEN 1 AND 1000)
  ),
  DROP CONSTRAINT IF EXISTS banking_statements_archive_metadata_check,
  ADD CONSTRAINT banking_statements_archive_metadata_check CHECK (
    (status <> 'cancelled' AND archived_at IS NULL AND archived_by IS NULL AND archive_reason IS NULL)
    OR (status = 'cancelled' AND archived_at IS NOT NULL AND archived_by IS NOT NULL
      AND length(btrim(archive_reason)) BETWEEN 1 AND 1000)
  );

ALTER TABLE public.banking_statements
  DROP CONSTRAINT IF EXISTS banking_statements_organization_id_bank_account_id_statement_date_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_banking_statements_active_date
  ON public.banking_statements(organization_id, bank_account_id, statement_date)
  WHERE status <> 'cancelled';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.banking_statement_lines
    WHERE matched_journal_line_id IS NOT NULL
    GROUP BY organization_id, matched_journal_line_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate journal-line bank matches must be resolved before v170.'
      USING ERRCODE = '23505';
  END IF;
END;
$$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_banking_statement_lines_journal_match
  ON public.banking_statement_lines(organization_id, matched_journal_line_id)
  WHERE matched_journal_line_id IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.banking_accounts bank
    JOIN public.accounting_accounts ledger ON ledger.id = bank.linked_account_id
    WHERE bank.organization_id IS DISTINCT FROM ledger.organization_id
  ) THEN
    RAISE EXCEPTION 'Cross-organization bank ledger links must be resolved before v170.'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.banking_validate_linked_ledger_account()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  ledger_org_id uuid;
  ledger_is_active boolean;
BEGIN
  IF NEW.linked_account_id IS NULL THEN RETURN NEW; END IF;
  SELECT organization_id, is_active INTO ledger_org_id, ledger_is_active
  FROM public.accounting_accounts WHERE id = NEW.linked_account_id FOR SHARE;
  IF ledger_org_id IS DISTINCT FROM NEW.organization_id OR ledger_is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'A bank ledger account must be active and belong to the bank organization.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_banking_accounts_linked_ledger ON public.banking_accounts;
CREATE TRIGGER trg_banking_accounts_linked_ledger
  BEFORE INSERT OR UPDATE OF linked_account_id, organization_id ON public.banking_accounts
  FOR EACH ROW EXECUTE FUNCTION public.banking_validate_linked_ledger_account();

CREATE TABLE IF NOT EXISTS public.banking_statement_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  idempotency_key uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('statement_edit', 'statement_recall', 'statement_cancel')),
  statement_id uuid NOT NULL REFERENCES public.banking_statements(id) ON DELETE RESTRICT,
  expected_version integer NOT NULL CHECK (expected_version >= 0),
  payload_hash text NOT NULL CHECK (length(payload_hash) = 64),
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed')),
  result jsonb,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_role text NOT NULL,
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (organization_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_banking_statement_commands_statement
  ON public.banking_statement_commands(organization_id, statement_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.banking_statement_line_action_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  command_id uuid NOT NULL REFERENCES public.banking_statement_commands(id) ON DELETE RESTRICT,
  statement_id uuid NOT NULL REFERENCES public.banking_statements(id) ON DELETE RESTRICT,
  statement_line_id uuid NOT NULL REFERENCES public.banking_statement_lines(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action = 'statement_recall'),
  previous_match_status text NOT NULL,
  previous_matched_journal_line_id uuid,
  previous_matched_at timestamptz,
  previous_matched_by uuid,
  previous_match_confidence numeric(3,2),
  previous_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (command_id, statement_line_id)
);

CREATE INDEX IF NOT EXISTS idx_banking_statement_line_history_statement
  ON public.banking_statement_line_action_history(organization_id, statement_id, created_at DESC);

ALTER TABLE public.banking_statement_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.banking_statement_line_action_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.banking_statement_commands FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.banking_statement_line_action_history FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.banking_statement_commands TO service_role;
GRANT SELECT, INSERT ON TABLE public.banking_statement_line_action_history TO service_role;

-- Browser sessions retain read access. All application mutations use service APIs;
-- table triggers below remain the final lifecycle authority for trusted SQL too.
DROP POLICY IF EXISTS org_isolation_banking_statements ON public.banking_statements;
DROP POLICY IF EXISTS banking_statements_org_select ON public.banking_statements;
CREATE POLICY banking_statements_org_select ON public.banking_statements
  FOR SELECT USING (
    organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid
  );
DROP POLICY IF EXISTS org_isolation_banking_statement_lines ON public.banking_statement_lines;
DROP POLICY IF EXISTS banking_statement_lines_org_select ON public.banking_statement_lines;
CREATE POLICY banking_statement_lines_org_select ON public.banking_statement_lines
  FOR SELECT USING (
    organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid
  );

CREATE OR REPLACE FUNCTION public.banking_guard_statement_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  command_mode boolean := current_setting('app.banking_statement_command', true) = 'on';
  line_sync_mode boolean := current_setting('app.banking_statement_line_sync', true) = 'on';
  actual_transaction_count integer;
  actual_matched_count integer;
  actual_activity_count integer;
  bank_org_id uuid;
  bank_is_active boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT organization_id, is_active INTO bank_org_id, bank_is_active
    FROM public.banking_accounts WHERE id = NEW.bank_account_id FOR SHARE;
    IF NEW.status <> 'imported' OR NEW.version <> 0 OR NEW.matched_count <> 0
       OR NEW.recalled_at IS NOT NULL OR NEW.recalled_by IS NOT NULL OR NEW.recall_reason IS NOT NULL
       OR NEW.archived_at IS NOT NULL OR NEW.archived_by IS NOT NULL OR NEW.archive_reason IS NOT NULL
       OR bank_org_id IS DISTINCT FROM NEW.organization_id OR bank_is_active IS NOT TRUE
       OR NEW.period_start > NEW.period_end
       OR NEW.statement_date NOT BETWEEN NEW.period_start AND NEW.period_end
       OR NEW.opening_balance::text IN ('NaN', 'Infinity', '-Infinity')
       OR NEW.closing_balance::text IN ('NaN', 'Infinity', '-Infinity') THEN
      RAISE EXCEPTION 'A bank statement must start as a valid imported statement for an active organization bank.'
        USING ERRCODE = '23514';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Bank statements and their imported evidence cannot be hard-deleted.'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.status IN ('reconciled', 'cancelled') AND NOT command_mode THEN
    RAISE EXCEPTION 'Reconciled or cancelled bank statements are immutable.'
      USING ERRCODE = '55000';
  END IF;

  IF NOT command_mode THEN
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.bank_account_id IS DISTINCT FROM OLD.bank_account_id
       OR NEW.statement_date IS DISTINCT FROM OLD.statement_date
       OR NEW.period_start IS DISTINCT FROM OLD.period_start
       OR NEW.period_end IS DISTINCT FROM OLD.period_end
       OR NEW.opening_balance IS DISTINCT FROM OLD.opening_balance
       OR NEW.closing_balance IS DISTINCT FROM OLD.closing_balance
       OR NEW.file_path IS DISTINCT FROM OLD.file_path
       OR NEW.file_name IS DISTINCT FROM OLD.file_name
       OR NEW.import_format IS DISTINCT FROM OLD.import_format
       OR NEW.imported_at IS DISTINCT FROM OLD.imported_at
       OR NEW.imported_by IS DISTINCT FROM OLD.imported_by
       OR (NOT line_sync_mode AND NEW.transaction_count IS DISTINCT FROM OLD.transaction_count)
       OR NEW.recalled_at IS DISTINCT FROM OLD.recalled_at
       OR NEW.recalled_by IS DISTINCT FROM OLD.recalled_by
       OR NEW.recall_reason IS DISTINCT FROM OLD.recall_reason
       OR NEW.archived_at IS DISTINCT FROM OLD.archived_at
       OR NEW.archived_by IS DISTINCT FROM OLD.archived_by
       OR NEW.archive_reason IS DISTINCT FROM OLD.archive_reason
       OR NEW.status NOT IN ('imported', 'in_progress') THEN
      RAISE EXCEPTION 'Bank statement metadata and lifecycle changes require the command workflow.'
        USING ERRCODE = '55000';
    END IF;

    IF NOT line_sync_mode THEN
      RAISE EXCEPTION 'Bank statement counters and lifecycle are derived from statement lines.'
        USING ERRCODE = '55000';
    END IF;

    SELECT count(*)::integer,
           count(*) FILTER (WHERE match_status IN ('matched', 'manually_matched'))::integer,
           count(*) FILTER (WHERE match_status <> 'unmatched')::integer
      INTO actual_transaction_count, actual_matched_count, actual_activity_count
    FROM public.banking_statement_lines
    WHERE statement_id = OLD.id AND organization_id = OLD.organization_id;

    IF NEW.transaction_count IS DISTINCT FROM actual_transaction_count
       OR NEW.matched_count IS DISTINCT FROM actual_matched_count
       OR NEW.status IS DISTINCT FROM CASE
         WHEN actual_activity_count > 0 THEN 'in_progress' ELSE 'imported' END THEN
      RAISE EXCEPTION 'Bank statement counters or lifecycle do not match its lines.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF command_mode THEN
    IF NEW.version <> OLD.version + 1 THEN
      RAISE EXCEPTION 'A banking command must advance the statement version exactly once.'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.version IS DISTINCT FROM OLD.version THEN
      RAISE EXCEPTION 'Bank statement versions are managed by the database.'
        USING ERRCODE = '55000';
    END IF;
    NEW.version := OLD.version + 1;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_banking_statements_lifecycle_guard ON public.banking_statements;
CREATE TRIGGER trg_banking_statements_lifecycle_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.banking_statements
  FOR EACH ROW EXECUTE FUNCTION public.banking_guard_statement_mutation();

CREATE OR REPLACE FUNCTION public.banking_guard_statement_line_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  parent_row public.banking_statements%ROWTYPE;
  statement_id_value uuid;
  organization_id_value uuid;
  existing_line_count integer;
  journal_org_id uuid;
  journal_status text;
  journal_account_id uuid;
  bank_linked_account_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Imported bank statement lines cannot be deleted.' USING ERRCODE = '55000';
  END IF;
  statement_id_value := NEW.statement_id;
  organization_id_value := NEW.organization_id;
  SELECT * INTO parent_row FROM public.banking_statements
  WHERE id = statement_id_value
  FOR UPDATE;
  IF parent_row.id IS NULL
     OR parent_row.organization_id IS DISTINCT FROM organization_id_value
     OR (TG_OP = 'UPDATE' AND (
       NEW.statement_id IS DISTINCT FROM OLD.statement_id
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     )) THEN
    RAISE EXCEPTION 'The bank statement line must belong to its statement organization.'
      USING ERRCODE = '23514';
  END IF;
  IF parent_row.status IN ('reconciled', 'cancelled') THEN
    RAISE EXCEPTION 'Lines of reconciled or cancelled statements are immutable.'
      USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT count(*)::integer INTO existing_line_count
    FROM public.banking_statement_lines
    WHERE statement_id = parent_row.id;
    IF parent_row.status <> 'imported' OR existing_line_count >= parent_row.transaction_count THEN
      RAISE EXCEPTION 'Statement lines may only be inserted during the declared import.'
        USING ERRCODE = '55000';
    END IF;
    IF NEW.match_status <> 'unmatched' OR NEW.matched_journal_line_id IS NOT NULL
       OR NEW.matched_at IS NOT NULL OR NEW.matched_by IS NOT NULL
       OR NEW.match_confidence IS NOT NULL THEN
      RAISE EXCEPTION 'Imported statement lines must start unmatched.' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.transaction_date IS DISTINCT FROM OLD.transaction_date
       OR NEW.value_date IS DISTINCT FROM OLD.value_date
       OR NEW.description IS DISTINCT FROM OLD.description
       OR NEW.reference IS DISTINCT FROM OLD.reference
       OR NEW.amount IS DISTINCT FROM OLD.amount
       OR NEW.running_balance IS DISTINCT FROM OLD.running_balance
       OR NEW.transaction_type IS DISTINCT FROM OLD.transaction_type
       OR NEW.payee IS DISTINCT FROM OLD.payee
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Imported bank statement evidence is immutable.' USING ERRCODE = '55000';
    END IF;
  END IF;
  IF NEW.match_status IN ('matched', 'manually_matched') THEN
    IF NEW.matched_journal_line_id IS NULL OR NEW.matched_at IS NULL OR NEW.matched_by IS NULL
       OR NEW.match_confidence IS NULL OR NEW.match_confidence < 0 OR NEW.match_confidence > 1 THEN
      RAISE EXCEPTION 'A bank match requires complete match evidence.' USING ERRCODE = '23514';
    END IF;
    SELECT journal_line.organization_id, journal.status, journal_line.account_id,
           bank.linked_account_id
      INTO journal_org_id, journal_status, journal_account_id, bank_linked_account_id
    FROM public.accounting_journal_lines journal_line
    JOIN public.accounting_journal_entries journal ON journal.id = journal_line.journal_entry_id
    JOIN public.banking_accounts bank ON bank.id = parent_row.bank_account_id
    WHERE journal_line.id = NEW.matched_journal_line_id;
    IF journal_org_id IS DISTINCT FROM NEW.organization_id OR journal_status IS DISTINCT FROM 'posted'
       OR bank_linked_account_id IS NULL OR journal_account_id IS DISTINCT FROM bank_linked_account_id THEN
      RAISE EXCEPTION 'A bank line may only match a posted journal line for its linked bank ledger account.'
        USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.banking_statement_lines other_line
      WHERE other_line.organization_id = NEW.organization_id
        AND other_line.matched_journal_line_id = NEW.matched_journal_line_id
        AND other_line.id <> NEW.id
    ) THEN
      RAISE EXCEPTION 'The journal line is already matched to another bank transaction.'
        USING ERRCODE = '23505';
    END IF;
  ELSIF NEW.matched_journal_line_id IS NOT NULL OR NEW.matched_at IS NOT NULL
     OR NEW.matched_by IS NOT NULL OR NEW.match_confidence IS NOT NULL THEN
    RAISE EXCEPTION 'Unmatched or excluded bank lines cannot retain match references.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_banking_statement_lines_lifecycle_guard
  ON public.banking_statement_lines;
CREATE TRIGGER trg_banking_statement_lines_lifecycle_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.banking_statement_lines
  FOR EACH ROW EXECUTE FUNCTION public.banking_guard_statement_line_mutation();

CREATE OR REPLACE FUNCTION public.banking_sync_statement_from_lines()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  transaction_count_value integer;
  matched_count_value integer;
  activity_count_value integer;
BEGIN
  IF current_setting('app.banking_statement_command', true) = 'on' THEN
    RETURN NEW;
  END IF;
  SELECT count(*)::integer,
         count(*) FILTER (WHERE match_status IN ('matched', 'manually_matched'))::integer,
         count(*) FILTER (WHERE match_status <> 'unmatched')::integer
    INTO transaction_count_value, matched_count_value, activity_count_value
  FROM public.banking_statement_lines
  WHERE statement_id = NEW.statement_id AND organization_id = NEW.organization_id;

  PERFORM set_config('app.banking_statement_line_sync', 'on', true);
  UPDATE public.banking_statements SET
    transaction_count = transaction_count_value,
    matched_count = matched_count_value,
    status = CASE WHEN activity_count_value > 0 THEN 'in_progress' ELSE 'imported' END,
    updated_by = NEW.matched_by
  WHERE id = NEW.statement_id AND organization_id = NEW.organization_id;
  PERFORM set_config('app.banking_statement_line_sync', 'off', true);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_banking_statement_lines_sync_parent
  ON public.banking_statement_lines;
CREATE TRIGGER trg_banking_statement_lines_sync_parent
  AFTER UPDATE OF match_status, matched_journal_line_id, matched_at, matched_by,
    match_confidence, notes ON public.banking_statement_lines
  FOR EACH ROW
  WHEN (
    OLD.match_status IS DISTINCT FROM NEW.match_status
    OR OLD.matched_journal_line_id IS DISTINCT FROM NEW.matched_journal_line_id
    OR OLD.matched_at IS DISTINCT FROM NEW.matched_at
    OR OLD.matched_by IS DISTINCT FROM NEW.matched_by
    OR OLD.match_confidence IS DISTINCT FROM NEW.match_confidence
    OR OLD.notes IS DISTINCT FROM NEW.notes
  )
  EXECUTE FUNCTION public.banking_sync_statement_from_lines();

CREATE OR REPLACE FUNCTION public.execute_banking_statement_command(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_command_id uuid,
  p_statement_id uuid,
  p_expected_version integer,
  p_action text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  statement_row public.banking_statements%ROWTYPE;
  command_row public.banking_statement_commands%ROWTYPE;
  bank_row public.banking_accounts%ROWTYPE;
  actor_role_value text;
  action_value text;
  clean_payload jsonb := COALESCE(p_payload, '{}'::jsonb);
  hash_value text;
  result_value jsonb;
  event_payload jsonb;
  event_id uuid;
  next_bank_account_id uuid;
  next_statement_date date;
  next_period_start date;
  next_period_end date;
  next_opening_balance numeric(18,2);
  next_closing_balance numeric(18,2);
  next_file_name text;
  reason_value text;
  actual_transaction_count integer;
  actual_matched_count integer;
  actual_activity_count integer;
  reset_matched_count integer := 0;
  reset_manual_count integer := 0;
  reset_excluded_count integer := 0;
  before_statement_value jsonb;
  previous_command_mode text := current_setting('app.banking_statement_command', true);
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_org_id IS NULL OR p_actor_user_id IS NULL OR p_request_id IS NULL
     OR p_command_id IS NULL OR p_statement_id IS NULL OR p_expected_version IS NULL THEN
    RAISE EXCEPTION 'Organization, actor, request, command, statement, and expected version are required.'
      USING ERRCODE = '22023';
  END IF;
  action_value := CASE p_action
    WHEN 'edit' THEN 'statement_edit'
    WHEN 'recall' THEN 'statement_recall'
    WHEN 'cancel' THEN 'statement_cancel'
    ELSE NULL
  END;
  IF action_value IS NULL OR jsonb_typeof(clean_payload) <> 'object' THEN
    RAISE EXCEPTION 'Unsupported banking statement command or payload.' USING ERRCODE = '22023';
  END IF;

  SELECT member.role::text INTO actor_role_value
  FROM public.org_members member
  JOIN public.organizations organization ON organization.id = member.org_id
  JOIN public.profiles profile ON profile.user_id = member.user_id
    AND profile.org_id = member.org_id
  WHERE member.org_id = p_org_id
    AND member.user_id = p_actor_user_id
    AND member.role::text IN ('finance_manager', 'accountant')
    AND lower(btrim(COALESCE(organization.status, ''))) = 'active'
    AND lower(btrim(COALESCE(profile.account_status, ''))) = 'active'
  LIMIT 1;
  IF actor_role_value IS NULL OR (p_action = 'recall' AND actor_role_value <> 'finance_manager') THEN
    RAISE EXCEPTION 'The required banking statement permission is missing.' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(clean_payload) payload_key
    WHERE (p_action = 'edit' AND payload_key NOT IN (
      'bank_account_id', 'statement_date', 'period_start', 'period_end',
      'opening_balance', 'closing_balance', 'file_name'
    )) OR (p_action IN ('recall', 'cancel') AND payload_key <> 'reason')
  ) THEN
    RAISE EXCEPTION 'The banking statement payload contains unsupported fields.' USING ERRCODE = '22023';
  END IF;

  hash_value := encode(digest(jsonb_build_object(
    'statement_id', p_statement_id,
    'expected_version', p_expected_version,
    'action', p_action,
    'payload', clean_payload
  )::text, 'sha256'), 'hex');

  INSERT INTO public.banking_statement_commands (
    organization_id, idempotency_key, action, statement_id, expected_version,
    payload_hash, actor_user_id, actor_role, request_id
  ) VALUES (
    p_org_id, p_command_id, action_value, p_statement_id, p_expected_version,
    hash_value, p_actor_user_id, actor_role_value, p_request_id
  ) ON CONFLICT (organization_id, idempotency_key) DO NOTHING;

  SELECT * INTO command_row FROM public.banking_statement_commands
  WHERE organization_id = p_org_id AND idempotency_key = p_command_id
  FOR UPDATE;
  IF command_row.action <> action_value
     OR command_row.statement_id <> p_statement_id
     OR command_row.expected_version <> p_expected_version
     OR command_row.payload_hash <> hash_value
     OR command_row.actor_user_id IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION 'Idempotency key was reused for a different banking command.'
      USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN
    RETURN command_row.result;
  END IF;

  SELECT * INTO statement_row FROM public.banking_statements
  WHERE id = p_statement_id AND organization_id = p_org_id
  FOR UPDATE;
  IF statement_row.id IS NULL THEN
    RAISE EXCEPTION 'Bank statement was not found.' USING ERRCODE = 'P0002';
  END IF;
  IF statement_row.version <> p_expected_version THEN
    RAISE EXCEPTION 'Bank statement version conflict.' USING ERRCODE = '40001';
  END IF;
  before_statement_value := jsonb_build_object(
    'bank_account_id', statement_row.bank_account_id,
    'statement_date', statement_row.statement_date,
    'period_start', statement_row.period_start,
    'period_end', statement_row.period_end,
    'opening_balance', statement_row.opening_balance,
    'closing_balance', statement_row.closing_balance,
    'file_name', statement_row.file_name,
    'status', statement_row.status,
    'transaction_count', statement_row.transaction_count,
    'matched_count', statement_row.matched_count,
    'version', statement_row.version
  );

  SELECT count(*)::integer,
         count(*) FILTER (WHERE match_status IN ('matched', 'manually_matched'))::integer,
         count(*) FILTER (WHERE match_status <> 'unmatched')::integer,
         count(*) FILTER (WHERE match_status = 'matched')::integer,
         count(*) FILTER (WHERE match_status = 'manually_matched')::integer,
         count(*) FILTER (WHERE match_status = 'excluded')::integer
    INTO actual_transaction_count, actual_matched_count, actual_activity_count,
         reset_matched_count, reset_manual_count, reset_excluded_count
  FROM public.banking_statement_lines
  WHERE statement_id = statement_row.id AND organization_id = p_org_id;

  PERFORM set_config('app.banking_statement_command', 'on', true);

  IF p_action = 'edit' THEN
    IF statement_row.status <> 'imported' OR actual_activity_count <> 0
       OR EXISTS (SELECT 1 FROM public.banking_reconciliations
                  WHERE organization_id = p_org_id AND statement_id = statement_row.id) THEN
      RAISE EXCEPTION 'Only untouched imported bank statements can be edited.' USING ERRCODE = '55000';
    END IF;

    next_bank_account_id := CASE WHEN clean_payload ? 'bank_account_id'
      THEN NULLIF(btrim(clean_payload->>'bank_account_id'), '')::uuid ELSE statement_row.bank_account_id END;
    next_statement_date := CASE WHEN clean_payload ? 'statement_date'
      THEN (clean_payload->>'statement_date')::date ELSE statement_row.statement_date END;
    next_period_start := CASE WHEN clean_payload ? 'period_start'
      THEN (clean_payload->>'period_start')::date ELSE statement_row.period_start END;
    next_period_end := CASE WHEN clean_payload ? 'period_end'
      THEN (clean_payload->>'period_end')::date ELSE statement_row.period_end END;
    next_opening_balance := CASE WHEN clean_payload ? 'opening_balance'
      THEN (clean_payload->>'opening_balance')::numeric(18,2) ELSE statement_row.opening_balance END;
    next_closing_balance := CASE WHEN clean_payload ? 'closing_balance'
      THEN (clean_payload->>'closing_balance')::numeric(18,2) ELSE statement_row.closing_balance END;
    next_file_name := CASE WHEN clean_payload ? 'file_name'
      THEN NULLIF(btrim(clean_payload->>'file_name'), '') ELSE statement_row.file_name END;

    IF next_bank_account_id IS NULL OR next_statement_date IS NULL
       OR next_period_start IS NULL OR next_period_end IS NULL
       OR next_opening_balance::text IN ('NaN', 'Infinity', '-Infinity')
       OR next_closing_balance::text IN ('NaN', 'Infinity', '-Infinity')
       OR next_period_start > next_period_end
       OR next_statement_date NOT BETWEEN next_period_start AND next_period_end THEN
      RAISE EXCEPTION 'Bank statement dates, period, account, and balances are invalid.' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO bank_row FROM public.banking_accounts
    WHERE id = next_bank_account_id AND organization_id = p_org_id FOR SHARE;
    IF bank_row.id IS NULL OR bank_row.is_active IS NOT TRUE THEN
      RAISE EXCEPTION 'The bank account must be active and belong to the organization.' USING ERRCODE = '23514';
    END IF;

    UPDATE public.banking_statements SET
      bank_account_id = next_bank_account_id,
      statement_date = next_statement_date,
      period_start = next_period_start,
      period_end = next_period_end,
      opening_balance = next_opening_balance,
      closing_balance = next_closing_balance,
      file_name = next_file_name,
      transaction_count = actual_transaction_count,
      matched_count = actual_matched_count,
      updated_by = p_actor_user_id,
      version = statement_row.version + 1
    WHERE id = statement_row.id
    RETURNING * INTO statement_row;
  ELSIF p_action = 'recall' THEN
    reason_value := NULLIF(btrim(clean_payload->>'reason'), '');
    IF reason_value IS NULL THEN
      RAISE EXCEPTION 'A recall reason is required.' USING ERRCODE = '22023';
    END IF;
    IF statement_row.status <> 'in_progress' THEN
      RAISE EXCEPTION 'Only an in-progress bank statement can be recalled.' USING ERRCODE = '55000';
    END IF;
    IF EXISTS (SELECT 1 FROM public.banking_reconciliations
               WHERE organization_id = p_org_id AND statement_id = statement_row.id) THEN
      RAISE EXCEPTION 'A statement with reconciliation evidence cannot be recalled.' USING ERRCODE = '55000';
    END IF;

    INSERT INTO public.banking_statement_line_action_history (
      organization_id, command_id, statement_id, statement_line_id, action,
      previous_match_status, previous_matched_journal_line_id, previous_matched_at,
      previous_matched_by, previous_match_confidence, previous_notes
    )
    SELECT p_org_id, command_row.id, statement_row.id, line.id, 'statement_recall',
      line.match_status, line.matched_journal_line_id, line.matched_at,
      line.matched_by, line.match_confidence, line.notes
    FROM public.banking_statement_lines line
    WHERE line.organization_id = p_org_id AND line.statement_id = statement_row.id
      AND line.match_status <> 'unmatched';

    UPDATE public.banking_statement_lines SET
      match_status = 'unmatched',
      matched_journal_line_id = NULL,
      matched_at = NULL,
      matched_by = NULL,
      match_confidence = NULL
    WHERE organization_id = p_org_id AND statement_id = statement_row.id
      AND match_status <> 'unmatched';
    UPDATE public.banking_statements SET
      status = 'imported',
      transaction_count = actual_transaction_count,
      matched_count = 0,
      recalled_at = now(),
      recalled_by = p_actor_user_id,
      recall_reason = reason_value,
      updated_by = p_actor_user_id,
      version = statement_row.version + 1
    WHERE id = statement_row.id
    RETURNING * INTO statement_row;
  ELSE
    reason_value := NULLIF(btrim(clean_payload->>'reason'), '');
    IF reason_value IS NULL THEN
      RAISE EXCEPTION 'A cancellation reason is required.' USING ERRCODE = '22023';
    END IF;
    IF statement_row.status <> 'imported' OR actual_activity_count <> 0
       OR statement_row.recalled_at IS NOT NULL
       OR EXISTS (SELECT 1 FROM public.banking_reconciliations
                  WHERE organization_id = p_org_id AND statement_id = statement_row.id) THEN
      RAISE EXCEPTION 'Only untouched imported bank statements can be cancelled.' USING ERRCODE = '55000';
    END IF;
    UPDATE public.banking_statements SET
      status = 'cancelled',
      transaction_count = actual_transaction_count,
      matched_count = 0,
      archived_at = now(),
      archived_by = p_actor_user_id,
      archive_reason = reason_value,
      updated_by = p_actor_user_id,
      version = statement_row.version + 1
    WHERE id = statement_row.id
    RETURNING * INTO statement_row;
  END IF;

  PERFORM set_config(
    'app.banking_statement_command',
    COALESCE(NULLIF(previous_command_mode, ''), 'off'),
    true
  );

  result_value := to_jsonb(statement_row) || jsonb_build_object(
    'has_line_activity', CASE WHEN p_action = 'recall' THEN false ELSE actual_activity_count > 0 END,
    'action', action_value
  );
  event_payload := jsonb_build_object(
    'statement_id', statement_row.id,
    'bank_account_id', statement_row.bank_account_id,
    'status', statement_row.status,
    'action', action_value,
    'version', statement_row.version,
    'reason', reason_value,
    'before', before_statement_value,
    'after', jsonb_build_object(
      'bank_account_id', statement_row.bank_account_id,
      'statement_date', statement_row.statement_date,
      'period_start', statement_row.period_start,
      'period_end', statement_row.period_end,
      'opening_balance', statement_row.opening_balance,
      'closing_balance', statement_row.closing_balance,
      'file_name', statement_row.file_name,
      'status', statement_row.status,
      'transaction_count', statement_row.transaction_count,
      'matched_count', statement_row.matched_count,
      'version', statement_row.version
    ),
    'reset_counts', jsonb_build_object(
      'matched', CASE WHEN p_action = 'recall' THEN reset_matched_count ELSE 0 END,
      'manually_matched', CASE WHEN p_action = 'recall' THEN reset_manual_count ELSE 0 END,
      'excluded', CASE WHEN p_action = 'recall' THEN reset_excluded_count ELSE 0 END
    )
  );
  event_id := gen_random_uuid();
  INSERT INTO public.business_events (
    id, org_id, source_type, business_key, event_version, payload, payload_hash,
    request_id, actor_user_id
  ) VALUES (
    event_id, p_org_id, 'banking_statement', p_command_id::text, statement_row.version,
    event_payload, encode(digest(event_payload::text, 'sha256'), 'hex'),
    p_request_id, p_actor_user_id
  );
  INSERT INTO public.event_outbox (org_id, business_event_id, topic, payload, payload_hash)
  VALUES (
    p_org_id, event_id, 'banking.statement.' || CASE p_action
      WHEN 'edit' THEN 'edited' WHEN 'recall' THEN 'recalled' ELSE 'cancelled' END,
    event_payload, encode(digest(event_payload::text, 'sha256'), 'hex')
  );
  INSERT INTO public.operational_audit_logs (
    org_id, request_id, actor_user_id, actor_role, action, target_type,
    target_id, outcome, status_code, metadata
  ) VALUES (
    p_org_id, p_request_id, p_actor_user_id, actor_role_value,
    'banking.statement_' || CASE p_action
      WHEN 'edit' THEN 'edited' WHEN 'recall' THEN 'recalled' ELSE 'cancelled' END,
    'banking_statements', statement_row.id::text, 'success', 200,
    event_payload || jsonb_build_object('command_id', p_command_id)
  );
  UPDATE public.banking_statement_commands SET
    status = 'completed', result = result_value, completed_at = now()
  WHERE id = command_row.id;
  RETURN result_value;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_banking_statement_command(
  uuid, uuid, uuid, uuid, uuid, integer, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_banking_statement_command(
  uuid, uuid, uuid, uuid, uuid, integer, text, jsonb
) TO service_role;

REVOKE ALL ON FUNCTION public.banking_guard_statement_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.banking_guard_statement_line_mutation() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.execute_banking_statement_command(
  uuid, uuid, uuid, uuid, uuid, integer, text, jsonb
) IS 'Versioned and idempotent edit, recall, and soft-cancel workflow for v165 bank statements.';
