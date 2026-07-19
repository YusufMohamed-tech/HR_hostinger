-- Publish accounting journal status changes from the same transaction that
-- changes the ledger. Notification delivery is handled by the retryable outbox
-- instead of the originating HTTP request.

CREATE OR REPLACE FUNCTION public.accounting_emit_journal_status_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  topic_value text;
  business_key_value text;
  payload_value jsonb;
  payload_hash_value text;
  event_id_value uuid;
  existing_hash text;
  request_id_value uuid;
  actor_user_id_value uuid;
  reversal_entry_id_value uuid;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status
     OR NEW.status NOT IN ('pending_approval', 'posted', 'reversed') THEN
    RETURN NEW;
  END IF;

  topic_value := CASE NEW.status
    WHEN 'pending_approval' THEN 'accounting.journal_pending_approval'
    WHEN 'posted' THEN 'accounting.journal_posted'
    ELSE 'accounting.journal_reversed'
  END;

  -- A command row is still in processing state while this trigger runs. This
  -- attaches request correlation when the transition came through a command,
  -- while legacy service-role transitions still publish a durable event.
  SELECT command.request_id, command.actor_user_id
    INTO request_id_value, actor_user_id_value
  FROM public.accounting_commands command
  WHERE command.organization_id = NEW.organization_id
    AND command.status = 'processing'
    AND (
      command.entity_id = NEW.id
      OR (
        command.entity_id IS NULL
        AND command.action = 'journal_create'
        AND command.actor_user_id = NEW.created_by
      )
    )
  ORDER BY command.created_at DESC
  LIMIT 1;

  actor_user_id_value := COALESCE(
    actor_user_id_value,
    CASE NEW.status
      WHEN 'posted' THEN NEW.posted_by
      WHEN 'reversed' THEN NEW.reversed_by
      ELSE NEW.created_by
    END
  );

  IF NEW.status = 'reversed' THEN
    SELECT reversal.id INTO reversal_entry_id_value
    FROM public.accounting_journal_entries reversal
    WHERE reversal.organization_id = NEW.organization_id
      AND reversal.reversal_of = NEW.id
    ORDER BY reversal.created_at DESC
    LIMIT 1;
  END IF;

  payload_value := jsonb_strip_nulls(jsonb_build_object(
    'event_type', topic_value,
    'journal_entry_id', NEW.id,
    'entry_no', NEW.entry_no,
    'description', NEW.description,
    'status', NEW.status,
    'source_module', NEW.source_module,
    'source_id', NEW.source_id,
    'total_debit', NEW.total_debit,
    'total_credit', NEW.total_credit,
    'version', NEW.version,
    'reversal_entry_id', reversal_entry_id_value
  ));
  payload_hash_value := encode(digest(payload_value::text, 'sha256'), 'hex');
  business_key_value := NEW.id::text || ':' || NEW.status || ':' || NEW.version::text;

  INSERT INTO public.business_events (
    org_id, source_type, business_key, event_version, payload, payload_hash,
    status, request_id, actor_user_id, occurred_at, processed_at
  ) VALUES (
    NEW.organization_id, 'accounting_journal', business_key_value,
    GREATEST(NEW.version, 1), payload_value, payload_hash_value,
    'completed', request_id_value, actor_user_id_value, now(), now()
  )
  ON CONFLICT (org_id, source_type, business_key) DO NOTHING
  RETURNING id INTO event_id_value;

  IF event_id_value IS NULL THEN
    SELECT event.id, event.payload_hash
      INTO event_id_value, existing_hash
    FROM public.business_events event
    WHERE event.org_id = NEW.organization_id
      AND event.source_type = 'accounting_journal'
      AND event.business_key = business_key_value;
    IF existing_hash IS DISTINCT FROM payload_hash_value THEN
      RAISE EXCEPTION 'Accounting journal event key conflicts with a different payload.'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  INSERT INTO public.event_outbox (
    org_id, business_event_id, topic, payload, payload_hash
  ) VALUES (
    NEW.organization_id, event_id_value, topic_value, payload_value, payload_hash_value
  )
  ON CONFLICT (business_event_id, topic) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_accounting_journal_status_event
  ON public.accounting_journal_entries;
CREATE TRIGGER trg_accounting_journal_status_event
  AFTER UPDATE OF status ON public.accounting_journal_entries
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.accounting_emit_journal_status_event();

REVOKE ALL ON FUNCTION public.accounting_emit_journal_status_event()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.accounting_emit_journal_status_event() IS
  'Atomically appends a deduplicated business event and outbox row for journal approval, posting, and reversal transitions.';
