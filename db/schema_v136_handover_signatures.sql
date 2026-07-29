-- Store electronic signatures captured when a field agent accepts a product handover.

CREATE TABLE IF NOT EXISTS public.product_handover_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  handover_id uuid NOT NULL REFERENCES public.product_handovers(id) ON DELETE CASCADE,
  agent_user_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  signature_data text NOT NULL,
  signed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_handover_signatures_handover
  ON public.product_handover_signatures(handover_id);

CREATE INDEX IF NOT EXISTS idx_handover_signatures_agent
  ON public.product_handover_signatures(agent_user_id);

ALTER TABLE public.product_handover_signatures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_access" ON public.product_handover_signatures
  FOR ALL USING (organization_id = current_setting('app.current_org_id', true)::uuid);
