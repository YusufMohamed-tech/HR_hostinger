-- SIM Box OCR Import for on-ground SIM stock automation.
-- Additive only. This does not alter sale flows; it records import batches and
-- generated kit codes before SIMs enter stock or are directly assigned to agents.

CREATE TABLE IF NOT EXISTS public.sim_import_batches (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider           text NOT NULL,
  order_number       text,
  batch_number       text,
  barcode_text       text,
  dealer_box_number  integer,
  dealer_box_total   integer,
  first_kitcode      text NOT NULL,
  last_kitcode       text NOT NULL,
  quantity           integer NOT NULL CHECK (quantity > 0),
  step               integer,
  image_path         text,
  extracted_json     jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(extracted_json) = 'object'),
  generated_preview  jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(generated_preview) = 'array'),
  status             text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'cancelled', 'failed')),
  imported_count     integer NOT NULL DEFAULT 0 CHECK (imported_count >= 0),
  duplicate_count    integer NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
  assigned_agent_id  uuid REFERENCES public.field_agents(id) ON DELETE SET NULL,
  created_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sim_units
  ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES public.sim_import_batches(id) ON DELETE SET NULL;
ALTER TABLE public.sim_units
  ADD COLUMN IF NOT EXISTS kit_code text;
ALTER TABLE public.sim_units
  ADD COLUMN IF NOT EXISTS dealer_box_number integer;
ALTER TABLE public.sim_units
  ADD COLUMN IF NOT EXISTS box_sequence integer;
ALTER TABLE public.sim_units
  ADD COLUMN IF NOT EXISTS import_source text NOT NULL DEFAULT 'manual';

CREATE INDEX IF NOT EXISTS idx_sim_import_batches_org_created
  ON public.sim_import_batches (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sim_import_batches_org_provider_batch
  ON public.sim_import_batches (organization_id, provider, batch_number);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sim_units_org_provider_kit_code
  ON public.sim_units (organization_id, provider, kit_code)
  WHERE kit_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sim_units_import_batch
  ON public.sim_units (organization_id, import_batch_id);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'sim-box-imports',
  'sim-box-imports',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

ALTER TABLE public.sim_import_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sim_import_batches_select ON public.sim_import_batches;
CREATE POLICY sim_import_batches_select ON public.sim_import_batches
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR (
      organization_id = public.current_org_id()
      AND (
        public.can_manage_field_agents()
        OR assigned_agent_id = public.current_field_agent_id()
      )
    )
  );

DROP POLICY IF EXISTS sim_import_batches_write ON public.sim_import_batches;
CREATE POLICY sim_import_batches_write ON public.sim_import_batches
  FOR ALL USING (
    auth.role() = 'service_role'
    OR (organization_id = public.current_org_id() AND public.can_manage_field_agents())
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR (organization_id = public.current_org_id() AND public.can_manage_field_agents())
  );

DROP TRIGGER IF EXISTS trg_sim_import_batches_updated_at ON public.sim_import_batches;
CREATE TRIGGER trg_sim_import_batches_updated_at
  BEFORE UPDATE ON public.sim_import_batches
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
