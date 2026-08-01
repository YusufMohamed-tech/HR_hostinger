-- Phase 6: trader returns, loss/recovery controls, and operational oversight.

CREATE TABLE IF NOT EXISTS public.product_trader_returns (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES public.product_inventory_units(id) ON DELETE RESTRICT,
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE RESTRICT,
  source_agent_id uuid NOT NULL REFERENCES public.field_agents(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK(length(btrim(reason))>=3),
  condition text NOT NULL CHECK(condition IN ('sealed','open_box','damaged')),
  evidence_path text NOT NULL CHECK(length(btrim(evidence_path))>0),
  status text NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','received','rejected','cancelled')),
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_note text,
  version integer NOT NULL DEFAULT 1 CHECK(version>=1),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.product_trader_losses (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES public.product_inventory_units(id) ON DELETE RESTRICT,
  merchant_id uuid REFERENCES public.merchants(id) ON DELETE SET NULL,
  source_agent_id uuid NOT NULL REFERENCES public.field_agents(id) ON DELETE RESTRICT,
  loss_type text NOT NULL CHECK(loss_type IN ('missing','stolen','damaged')),
  reason text NOT NULL CHECK(length(btrim(reason))>=5),
  evidence_path text NOT NULL CHECK(length(btrim(evidence_path))>0),
  status text NOT NULL DEFAULT 'reported' CHECK(status IN ('reported','under_review','recognized','recovered','cancelled')),
  unit_cost_snapshot numeric(14,2) NOT NULL CHECK(unit_cost_snapshot>0),
  reported_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  reported_at timestamptz NOT NULL DEFAULT now(),
  recovered_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  recovered_at timestamptz,
  recovery_condition text CHECK(recovery_condition IS NULL OR recovery_condition IN ('sellable','damaged')),
  recovery_note text,
  version integer NOT NULL DEFAULT 1 CHECK(version>=1),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(unit_id,status)
);

ALTER TABLE public.product_trader_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_trader_losses ENABLE ROW LEVEL SECURITY;
CREATE POLICY product_trader_returns_select ON public.product_trader_returns FOR SELECT USING(auth.role()='service_role' OR (organization_id=public.current_org_id() AND (public.can_view_product_inventory() OR merchant_id=public.current_merchant_id() OR source_agent_id=public.current_field_agent_id())));
CREATE POLICY product_trader_losses_select ON public.product_trader_losses FOR SELECT USING(auth.role()='service_role' OR (organization_id=public.current_org_id() AND (public.can_view_product_inventory() OR merchant_id=public.current_merchant_id() OR source_agent_id=public.current_field_agent_id())));
CREATE POLICY product_trader_returns_service_write ON public.product_trader_returns FOR ALL USING(auth.role()='service_role') WITH CHECK(auth.role()='service_role');
CREATE POLICY product_trader_losses_service_write ON public.product_trader_losses FOR ALL USING(auth.role()='service_role') WITH CHECK(auth.role()='service_role');

CREATE OR REPLACE FUNCTION public.execute_product_trader_exception_command(
 p_org_id uuid,p_actor_user_id uuid,p_request_id uuid,p_command_id uuid,p_action text,p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor_role text; actor_merchant uuid; actor_agent uuid; unit_row public.product_inventory_units%ROWTYPE;
 return_row public.product_trader_returns%ROWTYPE; loss_row public.product_trader_losses%ROWTYPE;
 result jsonb; event_payload jsonb; event_hash text; event_id uuid;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE='42501'; END IF;
 SELECT om.role::text,m.id,a.id INTO actor_role,actor_merchant,actor_agent FROM public.org_members om
 LEFT JOIN public.merchants m ON m.organization_id=om.org_id AND m.user_id=om.user_id AND m.status='active'
 LEFT JOIN public.field_agents a ON a.organization_id=om.org_id AND a.user_id=om.user_id AND a.status='active'
 WHERE om.org_id=p_org_id AND om.user_id=p_actor_user_id LIMIT 1;
 IF actor_role IS NULL THEN RAISE EXCEPTION 'Trader exception access is required.' USING ERRCODE='42501'; END IF;

 IF p_action IN ('return_request','loss_report') THEN
  SELECT * INTO unit_row FROM public.product_inventory_units WHERE organization_id=p_org_id AND id=(p_payload->>'unit_id')::uuid FOR UPDATE;
  IF unit_row.id IS NULL OR unit_row.status<>'with_merchant' THEN RAISE EXCEPTION 'Unit must be in trader custody.' USING ERRCODE='55000'; END IF;
  IF actor_role='merchant' AND unit_row.current_merchant_id<>actor_merchant THEN RAISE EXCEPTION 'Unit is outside trader custody.' USING ERRCODE='42501'; END IF;
  IF actor_role='field_agent' AND unit_row.current_agent_id<>actor_agent THEN RAISE EXCEPTION 'Unit is outside agent scope.' USING ERRCODE='42501'; END IF;
 END IF;
 IF p_action='return_request' THEN
  IF actor_role NOT IN ('merchant','field_agent') THEN RAISE EXCEPTION 'Return requester is not allowed.' USING ERRCODE='42501'; END IF;
  INSERT INTO public.product_trader_returns(id,organization_id,unit_id,merchant_id,source_agent_id,reason,condition,evidence_path,requested_by)
  VALUES((p_payload->>'return_id')::uuid,p_org_id,unit_row.id,unit_row.current_merchant_id,unit_row.current_agent_id,btrim(p_payload->>'reason'),p_payload->>'condition',btrim(p_payload->>'evidence_path'),p_actor_user_id) RETURNING * INTO return_row;
  UPDATE public.product_inventory_units SET status='return_pending',version=version+1,updated_at=now() WHERE id=unit_row.id;
  event_payload=jsonb_build_object('event_type','product_inventory.trader_return_requested','return_id',return_row.id,'unit_id',unit_row.id,'merchant_id',return_row.merchant_id,'agent_id',return_row.source_agent_id,'command_id',p_command_id); result=jsonb_build_object('return',to_jsonb(return_row));
 ELSIF p_action='return_review' THEN
  SELECT * INTO return_row FROM public.product_trader_returns WHERE organization_id=p_org_id AND id=(p_payload->>'return_id')::uuid FOR UPDATE;
  IF return_row.id IS NULL THEN RAISE EXCEPTION 'Return was not found.' USING ERRCODE='P0002'; END IF;
  IF return_row.status<>'requested' OR return_row.version<>(p_payload->>'expected_version')::integer THEN RAISE EXCEPTION 'Return changed.' USING ERRCODE='40001'; END IF;
  IF actor_role='field_agent' AND return_row.source_agent_id<>actor_agent THEN RAISE EXCEPTION 'Return is outside agent scope.' USING ERRCODE='42501'; END IF;
  IF actor_role NOT IN ('field_agent','admin','finance_manager','onground_agent_manager') THEN RAISE EXCEPTION 'Return review is not allowed.' USING ERRCODE='42501'; END IF;
  UPDATE public.product_trader_returns SET status=CASE WHEN p_payload->>'decision'='received' THEN 'received' ELSE 'rejected' END,reviewed_by=p_actor_user_id,reviewed_at=now(),review_note=NULLIF(btrim(p_payload->>'review_note'),''),version=version+1,updated_at=now() WHERE id=return_row.id RETURNING * INTO return_row;
  IF return_row.status='received' THEN UPDATE public.product_inventory_units SET status=CASE WHEN return_row.condition='damaged' THEN 'quarantine' ELSE 'with_agent' END,current_merchant_id=NULL,current_trader_handover_id=NULL,merchant_assigned_at=NULL,custody_version=custody_version+1,version=version+1,updated_at=now() WHERE id=return_row.unit_id;
  ELSE UPDATE public.product_inventory_units SET status='with_merchant',version=version+1,updated_at=now() WHERE id=return_row.unit_id; END IF;
  event_payload=jsonb_build_object('event_type',CASE WHEN return_row.status='received' THEN 'product_inventory.trader_return_received' ELSE 'product_inventory.trader_return_rejected' END,'return_id',return_row.id,'unit_id',return_row.unit_id,'merchant_id',return_row.merchant_id,'agent_id',return_row.source_agent_id,'command_id',p_command_id); result=jsonb_build_object('return',to_jsonb(return_row));
 ELSIF p_action='loss_report' THEN
  IF actor_role NOT IN ('merchant','field_agent') THEN RAISE EXCEPTION 'Loss reporter is not allowed.' USING ERRCODE='42501'; END IF;
  INSERT INTO public.product_trader_losses(id,organization_id,unit_id,merchant_id,source_agent_id,loss_type,reason,evidence_path,unit_cost_snapshot,reported_by)
  VALUES((p_payload->>'loss_id')::uuid,p_org_id,unit_row.id,unit_row.current_merchant_id,unit_row.current_agent_id,p_payload->>'loss_type',btrim(p_payload->>'reason'),btrim(p_payload->>'evidence_path'),unit_row.unit_cost_snapshot,p_actor_user_id) RETURNING * INTO loss_row;
  UPDATE public.product_inventory_units SET status=CASE WHEN loss_row.loss_type='damaged' THEN 'damaged' ELSE 'lost' END,current_merchant_id=NULL,current_trader_handover_id=NULL,merchant_assigned_at=NULL,custody_version=custody_version+1,version=version+1,updated_at=now() WHERE id=unit_row.id;
  event_payload=jsonb_build_object('event_type','product_inventory.trader_loss_reported','loss_id',loss_row.id,'unit_id',loss_row.unit_id,'merchant_id',loss_row.merchant_id,'agent_id',loss_row.source_agent_id,'loss_type',loss_row.loss_type,'command_id',p_command_id); result=jsonb_build_object('loss',to_jsonb(loss_row));
 ELSIF p_action='loss_recover' THEN
  SELECT * INTO loss_row FROM public.product_trader_losses WHERE organization_id=p_org_id AND id=(p_payload->>'loss_id')::uuid FOR UPDATE;
  IF loss_row.id IS NULL OR loss_row.status NOT IN ('reported','under_review','recognized') THEN RAISE EXCEPTION 'Open loss was not found.' USING ERRCODE='P0002'; END IF;
  IF actor_role='field_agent' AND loss_row.source_agent_id<>actor_agent THEN RAISE EXCEPTION 'Loss is outside agent scope.' USING ERRCODE='42501'; END IF;
  IF actor_role NOT IN ('field_agent','admin','finance_manager','onground_agent_manager') THEN RAISE EXCEPTION 'Recovery is not allowed.' USING ERRCODE='42501'; END IF;
  UPDATE public.product_trader_losses SET status='recovered',recovered_by=p_actor_user_id,recovered_at=now(),recovery_condition=p_payload->>'condition',recovery_note=NULLIF(btrim(p_payload->>'note'),''),version=version+1,updated_at=now() WHERE id=loss_row.id RETURNING * INTO loss_row;
  UPDATE public.product_inventory_units SET status=CASE WHEN loss_row.recovery_condition='damaged' THEN 'quarantine' ELSE 'with_agent' END,current_agent_id=loss_row.source_agent_id,current_merchant_id=NULL,current_trader_handover_id=NULL,custody_version=custody_version+1,version=version+1,updated_at=now() WHERE id=loss_row.unit_id;
  INSERT INTO public.product_inventory_movements(organization_id,unit_id,movement_type,to_agent_id,reason,performed_by,metadata) VALUES(p_org_id,loss_row.unit_id,'loss_recovered',loss_row.source_agent_id,loss_row.recovery_note,p_actor_user_id,jsonb_build_object('loss_id',loss_row.id));
  event_payload=jsonb_build_object('event_type','product_inventory.trader_loss_recovered','loss_id',loss_row.id,'unit_id',loss_row.unit_id,'agent_id',loss_row.source_agent_id,'command_id',p_command_id); result=jsonb_build_object('loss',to_jsonb(loss_row));
 ELSE RAISE EXCEPTION 'Unsupported trader exception action.' USING ERRCODE='22023'; END IF;
 event_hash=encode(digest(event_payload::text,'sha256'),'hex'); INSERT INTO public.business_events(org_id,source_type,business_key,event_version,payload,payload_hash,status,request_id,actor_user_id,occurred_at,processed_at) VALUES(p_org_id,'product_trader_exception',COALESCE(event_payload->>'return_id',event_payload->>'loss_id'),1,event_payload,event_hash,'completed',p_request_id,p_actor_user_id,now(),now()) RETURNING id INTO event_id;
 INSERT INTO public.event_outbox(org_id,business_event_id,topic,payload,payload_hash) VALUES(p_org_id,event_id,event_payload->>'event_type',event_payload,event_hash);
 INSERT INTO public.operational_audit_logs(org_id,request_id,actor_user_id,actor_role,action,target_type,target_id,outcome,status_code,metadata) VALUES(p_org_id,p_request_id,p_actor_user_id,actor_role,event_payload->>'event_type','product_trader_exception',COALESCE(event_payload->>'return_id',event_payload->>'loss_id'),'success',200,result);
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.execute_product_trader_exception_command(uuid,uuid,uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.execute_product_trader_exception_command(uuid,uuid,uuid,uuid,text,jsonb) TO service_role;
