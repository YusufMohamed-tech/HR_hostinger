-- v89: atomic sales cash collection lifecycle and durable accounting handoff.

ALTER TABLE public.agent_cash_collections
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN IF NOT EXISTS accounting_status text NOT NULL DEFAULT 'pending'
    CHECK (accounting_status IN ('pending', 'posted', 'failed')),
  ADD COLUMN IF NOT EXISTS accounting_journal_entry_id uuid
    REFERENCES public.accounting_journal_entries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS accounting_error text;

ALTER TABLE public.merchant_cash_collections
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN IF NOT EXISTS accounting_status text NOT NULL DEFAULT 'pending'
    CHECK (accounting_status IN ('pending', 'posted', 'failed')),
  ADD COLUMN IF NOT EXISTS accounting_journal_entry_id uuid
    REFERENCES public.accounting_journal_entries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS accounting_error text;

CREATE TABLE IF NOT EXISTS public.sales_cash_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  command_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('record_agent', 'record_merchant', 'confirm_merchant', 'reject_merchant')),
  collection_type text NOT NULL CHECK (collection_type IN ('agent', 'merchant')),
  collection_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  payload_hash text NOT NULL,
  result_snapshot jsonb,
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (org_id, command_id)
);

ALTER TABLE public.sales_cash_commands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sales_cash_commands_service_only ON public.sales_cash_commands;
CREATE POLICY sales_cash_commands_service_only ON public.sales_cash_commands
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.sales_cash_commands FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.sales_cash_commands TO service_role;

CREATE OR REPLACE FUNCTION public.guard_sales_cash_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.role() <> 'service_role' OR current_setting('app.sales_cash_command', true) <> 'trusted' THEN
    RAISE EXCEPTION 'Sales cash records must be changed through an approved command.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_agent_cash_write_trigger ON public.agent_cash_collections;
CREATE TRIGGER guard_agent_cash_write_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON public.agent_cash_collections
  FOR EACH ROW EXECUTE FUNCTION public.guard_sales_cash_write();
DROP TRIGGER IF EXISTS guard_merchant_cash_write_trigger ON public.merchant_cash_collections;
CREATE TRIGGER guard_merchant_cash_write_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON public.merchant_cash_collections
  FOR EACH ROW EXECUTE FUNCTION public.guard_sales_cash_write();

CREATE OR REPLACE FUNCTION public.emit_sales_cash_event(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_collection_type text,
  p_collection_id uuid,
  p_subject_id uuid,
  p_status text,
  p_amount numeric,
  p_payment_method text,
  p_collection_date date,
  p_version integer
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE event_id_value uuid; event_payload jsonb; topic_value text;
BEGIN
  topic_value := CASE p_status WHEN 'confirmed' THEN 'sales.cash_confirmed'
    WHEN 'rejected' THEN 'sales.cash_rejected' ELSE 'sales.cash_submitted' END;
  event_payload := jsonb_build_object(
    'collection_type', p_collection_type, 'collection_id', p_collection_id,
    'subject_id', p_subject_id, 'status', p_status, 'amount', p_amount,
    'payment_method', p_payment_method, 'collection_date', p_collection_date,
    'version', p_version, 'actor_user_id', p_actor_user_id
  );
  INSERT INTO public.business_events(
    org_id, source_type, business_key, event_version, payload, payload_hash, status,
    request_id, actor_user_id, occurred_at, processed_at
  ) VALUES (
    p_org_id, 'sales.cash_collection', p_collection_type || ':' || p_collection_id::text || ':' || p_status,
    p_version, event_payload, encode(digest(event_payload::text, 'sha256'), 'hex'), 'completed',
    p_request_id, p_actor_user_id, clock_timestamp(), clock_timestamp()
  ) ON CONFLICT (org_id, source_type, business_key) DO UPDATE
    SET processed_at = public.business_events.processed_at
  RETURNING id INTO event_id_value;
  INSERT INTO public.event_outbox(org_id,business_event_id,topic,payload,payload_hash)
  VALUES(p_org_id,event_id_value,topic_value,event_payload,encode(digest(event_payload::text,'sha256'),'hex'))
  ON CONFLICT (business_event_id,topic) DO NOTHING;
  RETURN event_id_value;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_sales_cash_collection(
  p_org_id uuid, p_actor_user_id uuid, p_request_id uuid, p_command_id uuid,
  p_collection_id uuid, p_collection_type text, p_subject_id uuid,
  p_amount numeric, p_payment_method text, p_collection_date date,
  p_notes text DEFAULT NULL, p_payment_proof_path text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE command_record public.sales_cash_commands%ROWTYPE; actor_role text; action_value text;
  input_value jsonb; hash_value text; result_value jsonb; status_value text;
  agent_record public.field_agents%ROWTYPE; merchant_record public.merchants%ROWTYPE;
  agent_collection public.agent_cash_collections%ROWTYPE;
  merchant_collection public.merchant_cash_collections%ROWTYPE;
  business_date_value date; collection_date_value date;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE='42501'; END IF;
  IF p_collection_type NOT IN('agent','merchant') OR p_collection_id IS NULL OR p_command_id IS NULL
     OR p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Valid collection identity, amount, and date are required.' USING ERRCODE='23514'; END IF;
  IF p_payment_method NOT IN('cash','bank_transfer','visa','electronic')
     OR (p_collection_type='agent' AND p_payment_method NOT IN('cash','bank_transfer')) THEN
    RAISE EXCEPTION 'Payment method is invalid for this collection.' USING ERRCODE='23514'; END IF;
  business_date_value := public.organization_business_date(p_org_id, now());
  collection_date_value := COALESCE(p_collection_date,business_date_value);
  IF collection_date_value > business_date_value THEN
    RAISE EXCEPTION 'Collection date cannot be in the future.' USING ERRCODE='23514'; END IF;
  SELECT role::text INTO actor_role FROM public.org_members WHERE org_id=p_org_id AND user_id=p_actor_user_id;
  action_value := CASE p_collection_type WHEN 'agent' THEN 'record_agent' ELSE 'record_merchant' END;
  input_value := jsonb_build_object('collection_id',p_collection_id,'collection_type',p_collection_type,
    'subject_id',p_subject_id,'amount',p_amount,'payment_method',p_payment_method,
    'collection_date',collection_date_value,'notes',NULLIF(btrim(COALESCE(p_notes,'')),''),
    'payment_proof_path',NULLIF(btrim(COALESCE(p_payment_proof_path,'')),''));
  hash_value := encode(digest(input_value::text,'sha256'),'hex');
  SELECT * INTO command_record FROM public.sales_cash_commands
  WHERE org_id=p_org_id AND command_id=p_command_id FOR UPDATE;
  IF command_record.id IS NOT NULL THEN
    IF command_record.action<>action_value OR command_record.collection_id<>p_collection_id
       OR command_record.actor_user_id<>p_actor_user_id OR command_record.payload_hash<>hash_value THEN
      RAISE EXCEPTION 'Command id was already used with different cash input.' USING ERRCODE='23505'; END IF;
    IF command_record.status='completed' AND command_record.result_snapshot IS NOT NULL THEN
      RETURN command_record.result_snapshot; END IF;
    RAISE EXCEPTION 'Cash command is already processing.' USING ERRCODE='40001';
  END IF;
  INSERT INTO public.sales_cash_commands(org_id,command_id,action,collection_type,collection_id,actor_user_id,payload_hash)
  VALUES(p_org_id,p_command_id,action_value,p_collection_type,p_collection_id,p_actor_user_id,hash_value);
  PERFORM set_config('app.sales_cash_command','trusted',true);
  IF p_collection_type='agent' THEN
    IF actor_role NOT IN('admin','sales_manager','onground_agent_manager') THEN
      RAISE EXCEPTION 'Only a sales manager can record an agent collection.' USING ERRCODE='42501'; END IF;
    SELECT * INTO agent_record FROM public.field_agents
    WHERE organization_id=p_org_id AND id=p_subject_id AND status='active' FOR UPDATE;
    IF agent_record.id IS NULL THEN RAISE EXCEPTION 'Active field agent was not found.' USING ERRCODE='23503'; END IF;
    INSERT INTO public.agent_cash_collections(
      id,organization_id,agent_id,amount,payment_method,collected_by,collection_date,notes
    ) VALUES(p_collection_id,p_org_id,p_subject_id,p_amount,p_payment_method,p_actor_user_id,collection_date_value,
      NULLIF(btrim(COALESCE(p_notes,'')),'')) RETURNING * INTO agent_collection;
    result_value:=to_jsonb(agent_collection); status_value:='confirmed';
  ELSE
    SELECT * INTO merchant_record FROM public.merchants
    WHERE organization_id=p_org_id AND id=p_subject_id AND status='active' FOR UPDATE;
    IF merchant_record.id IS NULL THEN RAISE EXCEPTION 'Active merchant was not found.' USING ERRCODE='23503'; END IF;
    SELECT * INTO agent_record FROM public.field_agents
    WHERE organization_id=p_org_id AND id=merchant_record.agent_id AND status='active';
    IF NOT(actor_role IN('admin','sales_manager','onground_agent_manager')
      OR (actor_role='field_agent' AND agent_record.user_id=p_actor_user_id)
      OR (actor_role='merchant' AND merchant_record.user_id=p_actor_user_id)) THEN
      RAISE EXCEPTION 'Actor cannot submit this merchant payment.' USING ERRCODE='42501'; END IF;
    status_value := CASE
      WHEN actor_role='merchant' THEN 'pending'
      WHEN p_payment_method<>'cash' AND actor_role NOT IN('admin','sales_manager','onground_agent_manager') THEN 'pending'
      ELSE 'confirmed' END;
    INSERT INTO public.merchant_cash_collections(
      id,organization_id,merchant_id,agent_id,amount,payment_method,collected_by,collection_date,notes,
      status,payment_proof_url,submitted_by,submitted_at,confirmed_by,confirmed_at
    ) VALUES(
      p_collection_id,p_org_id,merchant_record.id,merchant_record.agent_id,p_amount,p_payment_method,
      p_actor_user_id,collection_date_value,NULLIF(btrim(COALESCE(p_notes,'')),''),status_value,
      NULLIF(btrim(COALESCE(p_payment_proof_path,'')),''),p_actor_user_id,clock_timestamp(),
      CASE WHEN status_value='confirmed' THEN p_actor_user_id END,
      CASE WHEN status_value='confirmed' THEN clock_timestamp() END
    ) RETURNING * INTO merchant_collection;
    result_value:=to_jsonb(merchant_collection);
  END IF;
  PERFORM public.emit_sales_cash_event(p_org_id,p_actor_user_id,p_request_id,p_collection_type,
    p_collection_id,p_subject_id,status_value,p_amount,p_payment_method,collection_date_value,1);
  INSERT INTO public.operational_audit_logs(org_id,request_id,actor_user_id,actor_role,action,target_type,target_id,
    outcome,status_code,metadata) VALUES(p_org_id,p_request_id,p_actor_user_id,actor_role,
    'sales.cash_'||status_value,p_collection_type||'_cash_collection',p_collection_id::text,'success',201,input_value);
  UPDATE public.sales_cash_commands SET status='completed',result_snapshot=result_value,completed_at=clock_timestamp()
  WHERE org_id=p_org_id AND command_id=p_command_id;
  RETURN result_value;
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_merchant_cash_collection(
  p_org_id uuid,p_actor_user_id uuid,p_request_id uuid,p_command_id uuid,
  p_collection_id uuid,p_expected_version integer,p_decision text,p_rejection_reason text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE command_record public.sales_cash_commands%ROWTYPE; collection_record public.merchant_cash_collections%ROWTYPE;
  merchant_record public.merchants%ROWTYPE; agent_record public.field_agents%ROWTYPE; actor_role text;
  action_value text; input_value jsonb; hash_value text; result_value jsonb;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE='42501'; END IF;
  IF p_decision NOT IN('confirmed','rejected') OR p_expected_version IS NULL OR p_expected_version<1 THEN
    RAISE EXCEPTION 'Valid decision and expected version are required.' USING ERRCODE='23514'; END IF;
  IF p_decision='rejected' AND length(btrim(COALESCE(p_rejection_reason,'')))=0 THEN
    RAISE EXCEPTION 'Rejection reason is required.' USING ERRCODE='23514'; END IF;
  action_value:=CASE p_decision WHEN 'confirmed' THEN 'confirm_merchant' ELSE 'reject_merchant' END;
  input_value:=jsonb_build_object('collection_id',p_collection_id,'expected_version',p_expected_version,
    'decision',p_decision,'rejection_reason',NULLIF(btrim(COALESCE(p_rejection_reason,'')),''));
  hash_value:=encode(digest(input_value::text,'sha256'),'hex');
  SELECT * INTO command_record FROM public.sales_cash_commands WHERE org_id=p_org_id AND command_id=p_command_id FOR UPDATE;
  IF command_record.id IS NOT NULL THEN
    IF command_record.action<>action_value OR command_record.collection_id<>p_collection_id
       OR command_record.actor_user_id<>p_actor_user_id OR command_record.payload_hash<>hash_value THEN
      RAISE EXCEPTION 'Command id was already used with different payment input.' USING ERRCODE='23505'; END IF;
    IF command_record.status='completed' AND command_record.result_snapshot IS NOT NULL THEN RETURN command_record.result_snapshot; END IF;
    RAISE EXCEPTION 'Payment command is already processing.' USING ERRCODE='40001';
  END IF;
  INSERT INTO public.sales_cash_commands(org_id,command_id,action,collection_type,collection_id,actor_user_id,payload_hash)
  VALUES(p_org_id,p_command_id,action_value,'merchant',p_collection_id,p_actor_user_id,hash_value);
  SELECT * INTO collection_record FROM public.merchant_cash_collections
  WHERE organization_id=p_org_id AND id=p_collection_id FOR UPDATE;
  IF collection_record.id IS NULL THEN RAISE EXCEPTION 'Merchant payment was not found.' USING ERRCODE='P0002'; END IF;
  IF collection_record.version<>p_expected_version THEN RAISE EXCEPTION 'Merchant payment changed; reload and retry.' USING ERRCODE='40001'; END IF;
  IF collection_record.status<>'pending' THEN RAISE EXCEPTION 'Only pending merchant payments can be reviewed.' USING ERRCODE='55000'; END IF;
  SELECT role::text INTO actor_role FROM public.org_members WHERE org_id=p_org_id AND user_id=p_actor_user_id;
  SELECT * INTO merchant_record FROM public.merchants WHERE organization_id=p_org_id AND id=collection_record.merchant_id;
  SELECT * INTO agent_record FROM public.field_agents WHERE organization_id=p_org_id AND id=collection_record.agent_id;
  IF NOT(actor_role IN('admin','sales_manager','onground_agent_manager')
    OR (actor_role='field_agent' AND agent_record.user_id=p_actor_user_id)) THEN
    RAISE EXCEPTION 'Actor cannot review this merchant payment.' USING ERRCODE='42501'; END IF;
  IF p_decision='confirmed' AND collection_record.payment_method<>'cash'
     AND actor_role NOT IN('admin','sales_manager','onground_agent_manager') THEN
    RAISE EXCEPTION 'Electronic payments require manager confirmation.' USING ERRCODE='42501'; END IF;
  PERFORM set_config('app.sales_cash_command','trusted',true);
  UPDATE public.merchant_cash_collections SET status=p_decision,version=version+1,
    confirmed_by=CASE WHEN p_decision='confirmed' THEN p_actor_user_id END,
    confirmed_at=CASE WHEN p_decision='confirmed' THEN clock_timestamp() END,
    rejected_by=CASE WHEN p_decision='rejected' THEN p_actor_user_id END,
    rejected_at=CASE WHEN p_decision='rejected' THEN clock_timestamp() END,
    rejection_reason=CASE WHEN p_decision='rejected' THEN btrim(p_rejection_reason) END
  WHERE id=p_collection_id RETURNING * INTO collection_record;
  result_value:=to_jsonb(collection_record);
  PERFORM public.emit_sales_cash_event(p_org_id,p_actor_user_id,p_request_id,'merchant',p_collection_id,
    collection_record.merchant_id,p_decision,collection_record.amount,collection_record.payment_method,
    collection_record.collection_date,collection_record.version);
  INSERT INTO public.operational_audit_logs(org_id,request_id,actor_user_id,actor_role,action,target_type,target_id,
    outcome,status_code,metadata) VALUES(p_org_id,p_request_id,p_actor_user_id,actor_role,
    'sales.cash_'||p_decision,'merchant_cash_collection',p_collection_id::text,'success',200,input_value);
  UPDATE public.sales_cash_commands SET status='completed',result_snapshot=result_value,completed_at=clock_timestamp()
  WHERE org_id=p_org_id AND command_id=p_command_id;
  RETURN result_value;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_sales_cash_accounting(
  p_org_id uuid,p_collection_type text,p_collection_id uuid,p_status text,
  p_journal_entry_id uuid DEFAULT NULL,p_error text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE='42501'; END IF;
  IF p_collection_type NOT IN('agent','merchant') OR p_status NOT IN('posted','failed') THEN
    RAISE EXCEPTION 'Invalid accounting result.' USING ERRCODE='22023'; END IF;
  IF p_status='posted' AND p_journal_entry_id IS NULL THEN
    RAISE EXCEPTION 'Posted cash accounting requires a journal entry.' USING ERRCODE='22023'; END IF;
  PERFORM set_config('app.sales_cash_command','trusted',true);
  IF p_collection_type='agent' THEN
    UPDATE public.agent_cash_collections SET accounting_status=p_status,
      accounting_journal_entry_id=CASE WHEN p_status='posted' THEN p_journal_entry_id ELSE accounting_journal_entry_id END,
      accounting_error=CASE WHEN p_status='failed' THEN left(COALESCE(p_error,'Unknown accounting error'),2000) END
    WHERE organization_id=p_org_id AND id=p_collection_id;
  ELSE
    UPDATE public.merchant_cash_collections SET accounting_status=p_status,
      accounting_journal_entry_id=CASE WHEN p_status='posted' THEN p_journal_entry_id ELSE accounting_journal_entry_id END,
      accounting_error=CASE WHEN p_status='failed' THEN left(COALESCE(p_error,'Unknown accounting error'),2000) END
    WHERE organization_id=p_org_id AND id=p_collection_id AND status='confirmed';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.emit_sales_cash_event(uuid,uuid,uuid,text,uuid,uuid,text,numeric,text,date,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.record_sales_cash_collection(uuid,uuid,uuid,uuid,uuid,text,uuid,numeric,text,date,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.transition_merchant_cash_collection(uuid,uuid,uuid,uuid,uuid,integer,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.mark_sales_cash_accounting(uuid,text,uuid,text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_sales_cash_collection(uuid,uuid,uuid,uuid,uuid,text,uuid,numeric,text,date,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.transition_merchant_cash_collection(uuid,uuid,uuid,uuid,uuid,integer,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_sales_cash_accounting(uuid,text,uuid,text,uuid,text) TO service_role;

COMMENT ON TABLE public.sales_cash_commands IS 'Idempotency ledger for agent and merchant cash collection lifecycle commands.';
