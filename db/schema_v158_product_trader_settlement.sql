-- Phase 5: trader balances, collections, commission ledgers, and accounting state.

CREATE SEQUENCE IF NOT EXISTS public.product_trader_collection_number_seq START 1;

ALTER TABLE public.product_trader_sales
  ADD COLUMN IF NOT EXISTS accounting_journal_entry_id uuid REFERENCES public.accounting_journal_entries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS accounting_error text,
  ADD COLUMN IF NOT EXISTS accounting_posted_at timestamptz;

CREATE TABLE IF NOT EXISTS public.product_trader_collections (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  collection_no text NOT NULL,
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE RESTRICT,
  source_agent_id uuid NOT NULL REFERENCES public.field_agents(id) ON DELETE RESTRICT,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  payment_method text NOT NULL CHECK (payment_method IN ('cash','bank_transfer','card','electronic')),
  collection_date date NOT NULL DEFAULT CURRENT_DATE,
  payment_reference text,
  proof_path text,
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','confirmed','rejected','cancelled')),
  submitted_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  confirmed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_at timestamptz,
  rejection_reason text,
  accounting_status text NOT NULL DEFAULT 'pending' CHECK (accounting_status IN ('pending','posted','failed','reversed')),
  accounting_journal_entry_id uuid REFERENCES public.accounting_journal_entries(id) ON DELETE SET NULL,
  accounting_error text,
  accounting_posted_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, collection_no)
);

CREATE TABLE IF NOT EXISTS public.product_trader_commissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sale_id uuid NOT NULL REFERENCES public.product_trader_sales(id) ON DELETE RESTRICT,
  beneficiary_type text NOT NULL CHECK (beneficiary_type IN ('merchant','field_agent')),
  merchant_id uuid REFERENCES public.merchants(id) ON DELETE RESTRICT,
  agent_id uuid REFERENCES public.field_agents(id) ON DELETE RESTRICT,
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  currency text NOT NULL DEFAULT 'SAR' CHECK (currency ~ '^[A-Z]{3}$'),
  status text NOT NULL DEFAULT 'accrued' CHECK (status IN ('accrued','payable','settled','reversed')),
  accrued_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  settlement_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((beneficiary_type='merchant' AND merchant_id IS NOT NULL AND agent_id IS NULL)
      OR (beneficiary_type='field_agent' AND agent_id IS NOT NULL AND merchant_id IS NULL)),
  UNIQUE (sale_id, beneficiary_type)
);

CREATE OR REPLACE FUNCTION public.accrue_product_trader_sale_commissions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.merchant_commission_amount>0 THEN
    INSERT INTO public.product_trader_commissions(organization_id,sale_id,beneficiary_type,merchant_id,amount)
    VALUES(NEW.organization_id,NEW.id,'merchant',NEW.merchant_id,NEW.merchant_commission_amount)
    ON CONFLICT(sale_id,beneficiary_type) DO NOTHING;
  END IF;
  IF NEW.agent_chain_commission_amount>0 THEN
    INSERT INTO public.product_trader_commissions(organization_id,sale_id,beneficiary_type,agent_id,amount)
    VALUES(NEW.organization_id,NEW.id,'field_agent',NEW.source_agent_id,NEW.agent_chain_commission_amount)
    ON CONFLICT(sale_id,beneficiary_type) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_accrue_product_trader_sale_commissions ON public.product_trader_sales;
CREATE TRIGGER trg_accrue_product_trader_sale_commissions AFTER INSERT ON public.product_trader_sales
FOR EACH ROW EXECUTE FUNCTION public.accrue_product_trader_sale_commissions();

INSERT INTO public.product_trader_commissions(organization_id,sale_id,beneficiary_type,merchant_id,amount)
SELECT organization_id,id,'merchant',merchant_id,merchant_commission_amount FROM public.product_trader_sales WHERE merchant_commission_amount>0
ON CONFLICT(sale_id,beneficiary_type) DO NOTHING;
INSERT INTO public.product_trader_commissions(organization_id,sale_id,beneficiary_type,agent_id,amount)
SELECT organization_id,id,'field_agent',source_agent_id,agent_chain_commission_amount FROM public.product_trader_sales WHERE agent_chain_commission_amount>0
ON CONFLICT(sale_id,beneficiary_type) DO NOTHING;

CREATE OR REPLACE VIEW public.product_trader_balances WITH (security_invoker=true) AS
SELECT m.organization_id,m.id AS merchant_id,m.agent_id AS source_agent_id,m.business_name,
  COALESCE(s.sales_total,0)::numeric(14,2) AS sales_total,
  COALESCE(s.organization_receivable,0)::numeric(14,2) AS organization_receivable,
  COALESCE(c.confirmed_collections,0)::numeric(14,2) AS confirmed_collections,
  GREATEST(COALESCE(s.organization_receivable,0)-COALESCE(c.confirmed_collections,0),0)::numeric(14,2) AS outstanding,
  COALESCE(cm.merchant_commission,0)::numeric(14,2) AS merchant_commission,
  COALESCE(ca.agent_commission,0)::numeric(14,2) AS agent_commission
FROM public.merchants m
LEFT JOIN (SELECT organization_id,merchant_id,sum(total_amount) sales_total,sum(organization_receivable_amount) organization_receivable FROM public.product_trader_sales WHERE status='active' GROUP BY organization_id,merchant_id) s ON s.organization_id=m.organization_id AND s.merchant_id=m.id
LEFT JOIN (SELECT organization_id,merchant_id,sum(amount) confirmed_collections FROM public.product_trader_collections WHERE status='confirmed' GROUP BY organization_id,merchant_id) c ON c.organization_id=m.organization_id AND c.merchant_id=m.id
LEFT JOIN (SELECT organization_id,merchant_id,sum(amount) merchant_commission FROM public.product_trader_commissions WHERE beneficiary_type='merchant' AND status IN ('accrued','payable') GROUP BY organization_id,merchant_id) cm ON cm.organization_id=m.organization_id AND cm.merchant_id=m.id
LEFT JOIN (SELECT organization_id,agent_id,sum(amount) agent_commission FROM public.product_trader_commissions WHERE beneficiary_type='field_agent' AND status IN ('accrued','payable') GROUP BY organization_id,agent_id) ca ON ca.organization_id=m.organization_id AND ca.agent_id=m.agent_id;

ALTER TABLE public.product_trader_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_trader_commissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY product_trader_collections_select ON public.product_trader_collections FOR SELECT USING (
  auth.role()='service_role' OR (organization_id=public.current_org_id() AND (public.can_view_product_inventory() OR merchant_id=public.current_merchant_id() OR source_agent_id=public.current_field_agent_id()))
);
CREATE POLICY product_trader_commissions_select ON public.product_trader_commissions FOR SELECT USING (
  auth.role()='service_role' OR (organization_id=public.current_org_id() AND (public.can_view_product_inventory() OR merchant_id=public.current_merchant_id() OR agent_id=public.current_field_agent_id()))
);
CREATE POLICY product_trader_collections_service_write ON public.product_trader_collections FOR ALL USING(auth.role()='service_role') WITH CHECK(auth.role()='service_role');
CREATE POLICY product_trader_commissions_service_write ON public.product_trader_commissions FOR ALL USING(auth.role()='service_role') WITH CHECK(auth.role()='service_role');

CREATE OR REPLACE FUNCTION public.execute_product_trader_settlement_command(
  p_org_id uuid,p_actor_user_id uuid,p_request_id uuid,p_command_id uuid,p_action text,p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor_role text; actor_merchant uuid; actor_agent uuid; merchant_row public.merchants%ROWTYPE;
  collection_row public.product_trader_collections%ROWTYPE; balance_value numeric(14,2); result jsonb;
  event_payload jsonb; event_hash text; event_id uuid;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE='42501'; END IF;
  SELECT om.role::text,m.id,a.id INTO actor_role,actor_merchant,actor_agent FROM public.org_members om
  LEFT JOIN public.merchants m ON m.organization_id=om.org_id AND m.user_id=om.user_id AND m.status='active'
  LEFT JOIN public.field_agents a ON a.organization_id=om.org_id AND a.user_id=om.user_id AND a.status='active'
  WHERE om.org_id=p_org_id AND om.user_id=p_actor_user_id LIMIT 1;
  IF actor_role IS NULL THEN RAISE EXCEPTION 'Settlement access is required.' USING ERRCODE='42501'; END IF;
  IF p_action='collection_submit' THEN
    SELECT * INTO merchant_row FROM public.merchants WHERE organization_id=p_org_id AND id=COALESCE(NULLIF(p_payload->>'merchant_id','')::uuid,actor_merchant) AND status='active';
    IF merchant_row.id IS NULL OR (actor_role='merchant' AND merchant_row.id<>actor_merchant) OR (actor_role='field_agent' AND merchant_row.agent_id<>actor_agent) THEN RAISE EXCEPTION 'Trader is outside your scope.' USING ERRCODE='42501'; END IF;
    SELECT outstanding INTO balance_value FROM public.product_trader_balances WHERE organization_id=p_org_id AND merchant_id=merchant_row.id;
    IF (p_payload->>'amount')::numeric>COALESCE(balance_value,0)+0.01 THEN RAISE EXCEPTION 'Collection exceeds trader outstanding balance.' USING ERRCODE='23514'; END IF;
    INSERT INTO public.product_trader_collections(id,organization_id,collection_no,merchant_id,source_agent_id,amount,payment_method,collection_date,payment_reference,proof_path,submitted_by)
    VALUES((p_payload->>'collection_id')::uuid,p_org_id,'TPC-'||to_char(CURRENT_DATE,'YYYYMMDD')||'-'||lpad(nextval('public.product_trader_collection_number_seq')::text,7,'0'),merchant_row.id,merchant_row.agent_id,(p_payload->>'amount')::numeric,p_payload->>'payment_method',COALESCE(NULLIF(p_payload->>'collection_date','')::date,CURRENT_DATE),NULLIF(btrim(p_payload->>'payment_reference'),''),NULLIF(btrim(p_payload->>'proof_path'),''),p_actor_user_id) RETURNING * INTO collection_row;
    event_payload=jsonb_build_object('event_type','product_inventory.trader_collection_submitted','collection_id',collection_row.id,'collection_no',collection_row.collection_no,'merchant_id',collection_row.merchant_id,'agent_id',collection_row.source_agent_id,'amount',collection_row.amount,'command_id',p_command_id);
  ELSIF p_action='collection_review' THEN
    SELECT * INTO collection_row FROM public.product_trader_collections WHERE organization_id=p_org_id AND id=(p_payload->>'collection_id')::uuid FOR UPDATE;
    IF collection_row.id IS NULL THEN RAISE EXCEPTION 'Collection was not found.' USING ERRCODE='P0002'; END IF;
    IF collection_row.status<>'submitted' OR collection_row.version<>(p_payload->>'expected_version')::integer THEN RAISE EXCEPTION 'Collection changed.' USING ERRCODE='40001'; END IF;
    IF actor_role='field_agent' AND collection_row.source_agent_id<>actor_agent THEN RAISE EXCEPTION 'Collection is outside your scope.' USING ERRCODE='42501'; END IF;
    IF actor_role NOT IN ('field_agent','admin','finance_manager') THEN RAISE EXCEPTION 'Collection confirmation is not allowed.' USING ERRCODE='42501'; END IF;
    UPDATE public.product_trader_collections SET status=CASE WHEN p_payload->>'decision'='confirmed' THEN 'confirmed' ELSE 'rejected' END,confirmed_by=CASE WHEN p_payload->>'decision'='confirmed' THEN p_actor_user_id END,confirmed_at=CASE WHEN p_payload->>'decision'='confirmed' THEN now() END,rejection_reason=CASE WHEN p_payload->>'decision'='rejected' THEN NULLIF(btrim(p_payload->>'reason'),'') END,version=version+1,updated_at=now() WHERE id=collection_row.id RETURNING * INTO collection_row;
    event_payload=jsonb_build_object('event_type',CASE WHEN collection_row.status='confirmed' THEN 'product_inventory.trader_collection_confirmed' ELSE 'product_inventory.trader_collection_rejected' END,'collection_id',collection_row.id,'collection_no',collection_row.collection_no,'merchant_id',collection_row.merchant_id,'agent_id',collection_row.source_agent_id,'amount',collection_row.amount,'command_id',p_command_id);
  ELSE RAISE EXCEPTION 'Unsupported settlement action.' USING ERRCODE='22023'; END IF;
  result=jsonb_build_object('collection',to_jsonb(collection_row)); event_hash=encode(digest(event_payload::text,'sha256'),'hex');
  INSERT INTO public.business_events(org_id,source_type,business_key,event_version,payload,payload_hash,status,request_id,actor_user_id,occurred_at,processed_at) VALUES(p_org_id,'product_trader_collection',collection_row.id::text,collection_row.version,event_payload,event_hash,'completed',p_request_id,p_actor_user_id,now(),now()) RETURNING id INTO event_id;
  INSERT INTO public.event_outbox(org_id,business_event_id,topic,payload,payload_hash) VALUES(p_org_id,event_id,event_payload->>'event_type',event_payload,event_hash);
  INSERT INTO public.operational_audit_logs(org_id,request_id,actor_user_id,actor_role,action,target_type,target_id,outcome,status_code,metadata) VALUES(p_org_id,p_request_id,p_actor_user_id,actor_role,event_payload->>'event_type','product_trader_collection',collection_row.id::text,'success',200,result);
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_product_trader_settlement_command(uuid,uuid,uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.execute_product_trader_settlement_command(uuid,uuid,uuid,uuid,text,jsonb) TO service_role;
