-- Phase 4: serialized product sales by traders and Finance price controls.

ALTER TABLE public.product_trader_handovers DROP CONSTRAINT IF EXISTS product_trader_handovers_status_check;
ALTER TABLE public.product_trader_handovers ADD CONSTRAINT product_trader_handovers_status_check CHECK (status IN (
  'draft','issued','partially_accepted','accepted','rejected','cancelled','completed','expired'
));

CREATE SEQUENCE IF NOT EXISTS public.product_trader_sale_number_seq START 1;

CREATE OR REPLACE FUNCTION public.next_product_trader_sale_number(p_org_id uuid, p_date date)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE next_value bigint;
BEGIN
  next_value := nextval('public.product_trader_sale_number_seq');
  RETURN 'TPS-' || to_char(COALESCE(p_date, CURRENT_DATE), 'YYYYMMDD') || '-'
    || lpad(next_value::text, 7, '0');
END;
$$;

CREATE TABLE IF NOT EXISTS public.product_trader_sales (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sale_no text NOT NULL,
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE RESTRICT,
  source_agent_id uuid NOT NULL REFERENCES public.field_agents(id) ON DELETE RESTRICT,
  sale_date date NOT NULL DEFAULT CURRENT_DATE,
  customer_name text,
  customer_phone text,
  customer_reference text,
  payment_method text NOT NULL CHECK (payment_method IN ('cash','bank_transfer','card','electronic','credit')),
  subtotal numeric(14,2) NOT NULL CHECK (subtotal > 0),
  vat_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
  total_amount numeric(14,2) NOT NULL CHECK (total_amount > 0),
  merchant_commission_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (merchant_commission_amount >= 0),
  agent_chain_commission_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (agent_chain_commission_amount >= 0),
  organization_receivable_amount numeric(14,2) NOT NULL CHECK (organization_receivable_amount >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','voided')),
  accounting_status text NOT NULL DEFAULT 'pending' CHECK (accounting_status IN ('pending','posted','failed','reversed')),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, sale_no)
);

CREATE TABLE IF NOT EXISTS public.product_trader_price_overrides (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES public.product_inventory_units(id) ON DELETE RESTRICT,
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE RESTRICT,
  source_agent_id uuid NOT NULL REFERENCES public.field_agents(id) ON DELETE RESTRICT,
  requested_price numeric(14,2) NOT NULL CHECK (requested_price > 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 5),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','used','cancelled')),
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_note text,
  approved_price numeric(14,2),
  used_sale_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS product_trader_price_override_open_idx
  ON public.product_trader_price_overrides (organization_id, unit_id, merchant_id)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.product_trader_sale_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sale_id uuid NOT NULL REFERENCES public.product_trader_sales(id) ON DELETE RESTRICT,
  unit_id uuid NOT NULL REFERENCES public.product_inventory_units(id) ON DELETE RESTRICT,
  trader_handover_id uuid NOT NULL REFERENCES public.product_trader_handovers(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES public.sales_products(id) ON DELETE RESTRICT,
  serial_snapshot text NOT NULL,
  product_name_snapshot text NOT NULL,
  unit_cost_snapshot numeric(14,2) NOT NULL CHECK (unit_cost_snapshot > 0),
  planned_sale_price_snapshot numeric(14,2) NOT NULL CHECK (planned_sale_price_snapshot > 0),
  minimum_sale_price_snapshot numeric(14,2) NOT NULL CHECK (minimum_sale_price_snapshot > 0),
  maximum_sale_price_snapshot numeric(14,2) NOT NULL CHECK (maximum_sale_price_snapshot > 0),
  actual_sale_price numeric(14,2) NOT NULL CHECK (actual_sale_price > 0),
  net_amount numeric(14,2) NOT NULL CHECK (net_amount >= 0),
  vat_rate numeric(5,2) NOT NULL DEFAULT 0 CHECK (vat_rate >= 0),
  vat_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
  total_amount numeric(14,2) NOT NULL CHECK (total_amount > 0),
  merchant_commission_rule_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  merchant_commission_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (merchant_commission_amount >= 0),
  agent_chain_commission_rule_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  agent_chain_commission_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (agent_chain_commission_amount >= 0),
  price_override_id uuid REFERENCES public.product_trader_price_overrides(id) ON DELETE SET NULL,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sale_id, unit_id), UNIQUE (unit_id)
);

ALTER TABLE public.product_trader_price_overrides
  ADD CONSTRAINT product_trader_price_override_sale_fk FOREIGN KEY (used_sale_id)
  REFERENCES public.product_trader_sales(id) ON DELETE SET NULL;

ALTER TABLE public.product_inventory_units
  ADD COLUMN IF NOT EXISTS current_trader_sale_id uuid REFERENCES public.product_trader_sales(id) ON DELETE SET NULL;
ALTER TABLE public.product_inventory_movements
  ADD COLUMN IF NOT EXISTS trader_sale_id uuid REFERENCES public.product_trader_sales(id) ON DELETE SET NULL;
ALTER TABLE public.product_inventory_movements DROP CONSTRAINT IF EXISTS product_inventory_movements_movement_type_check;
ALTER TABLE public.product_inventory_movements ADD CONSTRAINT product_inventory_movements_movement_type_check CHECK (movement_type IN (
  'receipt','reserve','handover_issued','handover_accepted','employee_handover_issued','employee_handover_accepted',
  'trader_handover_issued','trader_handover_accepted','trader_handover_rejected','trader_handover_cancelled',
  'trader_return','agent_return','sale','trader_sale','sale_void','customer_return','return_reserved',
  'return_rejected','return_approved','return_received','quarantine','damage','loss','loss_recovered','adjustment','transfer'
));

CREATE INDEX IF NOT EXISTS product_trader_sales_org_merchant_idx
  ON public.product_trader_sales (organization_id, merchant_id, sale_date DESC);

ALTER TABLE public.product_trader_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_trader_sale_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_trader_price_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY product_trader_sales_select ON public.product_trader_sales FOR SELECT USING (
  auth.role()='service_role' OR (organization_id=public.current_org_id() AND (
    public.can_view_product_inventory() OR merchant_id=public.current_merchant_id() OR source_agent_id=public.current_field_agent_id()
  ))
);
CREATE POLICY product_trader_sale_lines_select ON public.product_trader_sale_lines FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.product_trader_sales s WHERE s.id = sale_id AND s.organization_id = organization_id)
);
CREATE POLICY product_trader_price_overrides_select ON public.product_trader_price_overrides FOR SELECT USING (
  auth.role()='service_role' OR (organization_id=public.current_org_id() AND (
    public.can_view_product_inventory() OR merchant_id=public.current_merchant_id() OR source_agent_id=public.current_field_agent_id()
  ))
);
CREATE POLICY product_trader_sales_service_write ON public.product_trader_sales FOR ALL USING (auth.role()='service_role') WITH CHECK (auth.role()='service_role');
CREATE POLICY product_trader_sale_lines_service_write ON public.product_trader_sale_lines FOR ALL USING (auth.role()='service_role') WITH CHECK (auth.role()='service_role');
CREATE POLICY product_trader_price_overrides_service_write ON public.product_trader_price_overrides FOR ALL USING (auth.role()='service_role') WITH CHECK (auth.role()='service_role');

CREATE OR REPLACE FUNCTION public.execute_product_trader_sale_command(
  p_org_id uuid, p_actor_user_id uuid, p_request_id uuid, p_command_id uuid,
  p_action text, p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  actor_role text; actor_merchant_id uuid; actor_agent_id uuid;
  unit_row public.product_inventory_units%ROWTYPE; product_row public.sales_products%ROWTYPE;
  sale_row public.product_trader_sales%ROWTYPE; override_row public.product_trader_price_overrides%ROWTYPE;
  price numeric(14,2); net numeric(14,2); vat numeric(14,2); total numeric(14,2); vat_rate numeric(5,2);
  merchant_comm numeric(14,2); agent_comm numeric(14,2); sale_id uuid;
  result jsonb; event_payload jsonb; event_hash text; event_id uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE='42501'; END IF;
  SELECT om.role::text, m.id, a.id INTO actor_role, actor_merchant_id, actor_agent_id
  FROM public.org_members om
  LEFT JOIN public.merchants m ON m.organization_id=om.org_id AND m.user_id=om.user_id AND m.status='active'
  LEFT JOIN public.field_agents a ON a.organization_id=om.org_id AND a.user_id=om.user_id AND a.status='active'
  WHERE om.org_id=p_org_id AND om.user_id=p_actor_user_id LIMIT 1;
  IF actor_role IS NULL THEN RAISE EXCEPTION 'Trader sale access is required.' USING ERRCODE='42501'; END IF;

  IF p_action='price_override_review' THEN
    IF actor_role NOT IN ('admin','finance_manager') THEN RAISE EXCEPTION 'Finance approval is required.' USING ERRCODE='42501'; END IF;
    SELECT * INTO override_row FROM public.product_trader_price_overrides WHERE organization_id=p_org_id AND id=(p_payload->>'override_id')::uuid FOR UPDATE;
    IF override_row.id IS NULL THEN RAISE EXCEPTION 'Price request was not found.' USING ERRCODE='P0002'; END IF;
    IF override_row.status<>'pending' OR override_row.version<>(p_payload->>'expected_version')::integer THEN RAISE EXCEPTION 'Price request changed.' USING ERRCODE='40001'; END IF;
    UPDATE public.product_trader_price_overrides SET status=CASE WHEN (p_payload->>'decision')='approved' THEN 'approved' ELSE 'rejected' END,
      approved_price=CASE WHEN (p_payload->>'decision')='approved' THEN requested_price END,
      reviewed_by=p_actor_user_id, reviewed_at=now(), review_note=NULLIF(btrim(p_payload->>'review_note'),''), version=version+1, updated_at=now()
      WHERE id=override_row.id RETURNING * INTO override_row;
    result=jsonb_build_object('override',to_jsonb(override_row));
    event_payload=jsonb_build_object('event_type','product_inventory.trader_price_override_reviewed','override_id',override_row.id,'merchant_id',override_row.merchant_id,'status',override_row.status,'command_id',p_command_id);
  ELSE
    IF actor_role<>'merchant' OR actor_merchant_id IS NULL THEN RAISE EXCEPTION 'Only an active trader can sell or request a price.' USING ERRCODE='42501'; END IF;
    SELECT * INTO unit_row FROM public.product_inventory_units WHERE organization_id=p_org_id AND id=(p_payload->>'unit_id')::uuid FOR UPDATE;
    IF unit_row.id IS NULL OR unit_row.status<>'with_merchant' OR unit_row.current_merchant_id<>actor_merchant_id THEN RAISE EXCEPTION 'The serialized unit is not in this trader custody.' USING ERRCODE='55000'; END IF;
    SELECT * INTO product_row FROM public.sales_products WHERE organization_id=p_org_id AND id=unit_row.product_id AND is_active FOR UPDATE;
    IF NOT COALESCE(product_row.merchant_sales_enabled,false) THEN RAISE EXCEPTION 'Trader sale is disabled for this product.' USING ERRCODE='55000'; END IF;
    price=(p_payload->>'sale_price')::numeric;
    IF price IS NULL OR price<=0 THEN RAISE EXCEPTION 'Sale price is invalid.' USING ERRCODE='23514'; END IF;

    IF p_action='price_override_request' THEN
      IF price>=unit_row.minimum_sale_price_snapshot AND price<=unit_row.maximum_sale_price_snapshot THEN RAISE EXCEPTION 'Price is already within the approved range.' USING ERRCODE='23514'; END IF;
      INSERT INTO public.product_trader_price_overrides(id,organization_id,unit_id,merchant_id,source_agent_id,requested_price,currency,reason,requested_by)
      VALUES((p_payload->>'override_id')::uuid,p_org_id,unit_row.id,actor_merchant_id,unit_row.current_agent_id,price,unit_row.currency,btrim(p_payload->>'reason'),p_actor_user_id)
      RETURNING * INTO override_row;
      result=jsonb_build_object('override',to_jsonb(override_row));
      event_payload=jsonb_build_object('event_type','product_inventory.trader_price_override_requested','override_id',override_row.id,'merchant_id',override_row.merchant_id,'unit_id',unit_row.id,'command_id',p_command_id);
    ELSIF p_action='sale_create' THEN
      IF price<unit_row.minimum_sale_price_snapshot OR price>unit_row.maximum_sale_price_snapshot THEN
        SELECT * INTO override_row FROM public.product_trader_price_overrides WHERE organization_id=p_org_id AND id=NULLIF(p_payload->>'price_override_id','')::uuid AND unit_id=unit_row.id AND merchant_id=actor_merchant_id AND status='approved' AND approved_price=price FOR UPDATE;
        IF override_row.id IS NULL THEN RAISE EXCEPTION 'The sale price needs Finance approval.' USING ERRCODE='23514'; END IF;
      END IF;
      SELECT COALESCE(t.rate,0) INTO vat_rate FROM public.accounting_tax_rates t WHERE t.organization_id=p_org_id AND t.id=product_row.tax_rate_id AND t.is_active;
      vat_rate=COALESCE(vat_rate,0);
      IF vat_rate>0 THEN net=round(price/(1+vat_rate/100),2); vat=price-net; total=price; ELSE net=price; vat=0; total=price; END IF;
      merchant_comm=CASE product_row.trader_commission_type WHEN 'flat' THEN product_row.trader_commission_value WHEN 'percentage' THEN round(net*product_row.trader_commission_value/100,2) ELSE 0 END;
      agent_comm=CASE product_row.agent_chain_commission_type WHEN 'flat' THEN product_row.agent_chain_commission_value WHEN 'percentage' THEN round(net*product_row.agent_chain_commission_value/100,2) ELSE 0 END;
      sale_id=(p_payload->>'sale_id')::uuid;
      INSERT INTO public.product_trader_sales(id,organization_id,sale_no,merchant_id,source_agent_id,sale_date,customer_name,customer_phone,customer_reference,payment_method,subtotal,vat_amount,total_amount,merchant_commission_amount,agent_chain_commission_amount,organization_receivable_amount,created_by)
      VALUES(sale_id,p_org_id,public.next_product_trader_sale_number(p_org_id,COALESCE(NULLIF(p_payload->>'sale_date','')::date,CURRENT_DATE)),actor_merchant_id,unit_row.current_agent_id,COALESCE(NULLIF(p_payload->>'sale_date','')::date,CURRENT_DATE),NULLIF(btrim(p_payload->>'customer_name'),''),NULLIF(btrim(p_payload->>'customer_phone'),''),NULLIF(btrim(p_payload->>'customer_reference'),''),p_payload->>'payment_method',net,vat,total,merchant_comm,agent_comm,GREATEST(total-merchant_comm,0),p_actor_user_id) RETURNING * INTO sale_row;
      INSERT INTO public.product_trader_sale_lines(organization_id,sale_id,unit_id,trader_handover_id,product_id,serial_snapshot,product_name_snapshot,unit_cost_snapshot,planned_sale_price_snapshot,minimum_sale_price_snapshot,maximum_sale_price_snapshot,actual_sale_price,net_amount,vat_rate,vat_amount,total_amount,merchant_commission_rule_snapshot,merchant_commission_amount,agent_chain_commission_rule_snapshot,agent_chain_commission_amount,price_override_id,currency)
      VALUES(p_org_id,sale_id,unit_row.id,unit_row.current_trader_handover_id,unit_row.product_id,unit_row.raw_serial_number,product_row.name,unit_row.unit_cost_snapshot,unit_row.planned_sale_price_snapshot,unit_row.minimum_sale_price_snapshot,unit_row.maximum_sale_price_snapshot,price,net,vat_rate,vat,total,unit_row.trader_commission_rule_snapshot,merchant_comm,unit_row.agent_chain_commission_rule_snapshot,agent_comm,override_row.id,unit_row.currency);
      UPDATE public.product_trader_handover_lines SET line_status='sold',closed_at=now(),updated_at=now() WHERE handover_id=unit_row.current_trader_handover_id AND unit_id=unit_row.id AND line_status='accepted';
      UPDATE public.product_inventory_units SET status='sold',sold_at=now(),sold_by_merchant_id=actor_merchant_id,current_trader_sale_id=sale_id,current_merchant_id=NULL,current_agent_id=NULL,custody_version=custody_version+1,version=version+1,updated_at=now() WHERE id=unit_row.id;
      UPDATE public.product_trader_price_overrides SET status='used',used_sale_id=sale_id,version=version+1,updated_at=now() WHERE id=override_row.id;
      INSERT INTO public.product_inventory_movements(organization_id,unit_id,movement_type,from_merchant_id,trader_handover_id,trader_sale_id,reason,performed_by,metadata) VALUES(p_org_id,unit_row.id,'trader_sale',actor_merchant_id,unit_row.current_trader_handover_id,sale_id,'Serialized product sold by trader',p_actor_user_id,jsonb_build_object('sale_no',sale_row.sale_no));
      result=jsonb_build_object('sale',to_jsonb(sale_row));
      event_payload=jsonb_build_object('event_type','product_inventory.trader_sale_created','sale_id',sale_id,'sale_no',sale_row.sale_no,'merchant_id',actor_merchant_id,'agent_id',sale_row.source_agent_id,'total_amount',total,'command_id',p_command_id);
    ELSE RAISE EXCEPTION 'Unsupported trader sale action.' USING ERRCODE='22023'; END IF;
  END IF;
  event_hash=encode(digest(event_payload::text,'sha256'),'hex');
  INSERT INTO public.business_events(org_id,source_type,business_key,event_version,payload,payload_hash,status,request_id,actor_user_id,occurred_at,processed_at)
  VALUES(p_org_id,'product_trader_sale',COALESCE(event_payload->>'sale_id',event_payload->>'override_id'),1,event_payload,event_hash,'completed',p_request_id,p_actor_user_id,now(),now()) RETURNING id INTO event_id;
  INSERT INTO public.event_outbox(org_id,business_event_id,topic,payload,payload_hash) VALUES(p_org_id,event_id,event_payload->>'event_type',event_payload,event_hash);
  INSERT INTO public.operational_audit_logs(org_id,request_id,actor_user_id,actor_role,action,target_type,target_id,outcome,status_code,metadata)
  VALUES(p_org_id,p_request_id,p_actor_user_id,actor_role,event_payload->>'event_type','product_trader_sale',COALESCE(event_payload->>'sale_id',event_payload->>'override_id'),'success',200,result);
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.next_product_trader_sale_number(uuid,date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.execute_product_trader_sale_command(uuid,uuid,uuid,uuid,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_product_trader_sale_number(uuid,date) TO service_role;
GRANT EXECUTE ON FUNCTION public.execute_product_trader_sale_command(uuid,uuid,uuid,uuid,text,jsonb) TO service_role;
