-- Persist automatic workbook-recognition evidence on every inventory receipt source.

ALTER TABLE public.product_receipt_sources
  ADD COLUMN IF NOT EXISTS recognition_version text,
  ADD COLUMN IF NOT EXISTS layout_fingerprint text,
  ADD COLUMN IF NOT EXISTS detected_sheet_name text,
  ADD COLUMN IF NOT EXISTS detected_header_row integer,
  ADD COLUMN IF NOT EXISTS workbook_shape text,
  ADD COLUMN IF NOT EXISTS recognition_confidence numeric(5,4),
  ADD COLUMN IF NOT EXISTS profile_match_mode text,
  ADD COLUMN IF NOT EXISTS compatible_sheet_names jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS mapping_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.product_receipt_sources
  DROP CONSTRAINT IF EXISTS product_receipt_sources_layout_fingerprint_check;
ALTER TABLE public.product_receipt_sources
  ADD CONSTRAINT product_receipt_sources_layout_fingerprint_check CHECK (
    layout_fingerprint IS NULL OR length(layout_fingerprint) = 64
  );

ALTER TABLE public.product_receipt_sources
  DROP CONSTRAINT IF EXISTS product_receipt_sources_detected_header_row_check;
ALTER TABLE public.product_receipt_sources
  ADD CONSTRAINT product_receipt_sources_detected_header_row_check CHECK (
    detected_header_row IS NULL OR detected_header_row BETWEEN 1 AND 100
  );

ALTER TABLE public.product_receipt_sources
  DROP CONSTRAINT IF EXISTS product_receipt_sources_workbook_shape_check;
ALTER TABLE public.product_receipt_sources
  ADD CONSTRAINT product_receipt_sources_workbook_shape_check CHECK (
    workbook_shape IS NULL
    OR workbook_shape IN ('row_per_device', 'continuation_rows', 'serial_columns')
  );

ALTER TABLE public.product_receipt_sources
  DROP CONSTRAINT IF EXISTS product_receipt_sources_recognition_confidence_check;
ALTER TABLE public.product_receipt_sources
  ADD CONSTRAINT product_receipt_sources_recognition_confidence_check CHECK (
    recognition_confidence IS NULL OR recognition_confidence BETWEEN 0 AND 1
  );

ALTER TABLE public.product_receipt_sources
  DROP CONSTRAINT IF EXISTS product_receipt_sources_profile_match_mode_check;
ALTER TABLE public.product_receipt_sources
  ADD CONSTRAINT product_receipt_sources_profile_match_mode_check CHECK (
    profile_match_mode IS NULL OR profile_match_mode IN ('automatic', 'exact_profile', 'mixed')
  );

ALTER TABLE public.product_receipt_sources
  DROP CONSTRAINT IF EXISTS product_receipt_sources_recognition_json_check;
ALTER TABLE public.product_receipt_sources
  ADD CONSTRAINT product_receipt_sources_recognition_json_check CHECK (
    jsonb_typeof(compatible_sheet_names) = 'array'
    AND jsonb_typeof(mapping_snapshot) = 'object'
  );

CREATE INDEX IF NOT EXISTS product_receipt_sources_layout_fingerprint_idx
  ON public.product_receipt_sources (organization_id, layout_fingerprint, created_at DESC)
  WHERE layout_fingerprint IS NOT NULL;

COMMENT ON COLUMN public.product_receipt_sources.layout_fingerprint IS
  'SHA-256 fingerprint of detected headers, mapping, and workbook shape.';
COMMENT ON COLUMN public.product_receipt_sources.mapping_snapshot IS
  'Immutable workbook header mapping used to create the receipt preview.';
