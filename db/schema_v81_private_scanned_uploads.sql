-- Storage writes are server-only; confidential payment and import evidence stays private.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('merchant-place-photos', 'merchant-place-photos', true, 10485760,
    ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]),
  ('merchant-payment-proofs', 'merchant-payment-proofs', false, 10485760,
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']::text[]),
  ('sim-box-imports', 'sim-box-imports', false, 10485760,
    ARRAY['image/jpeg', 'image/png', 'image/webp']::text[])
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS merchant_place_photos_select ON storage.objects;
DROP POLICY IF EXISTS merchant_place_photos_insert ON storage.objects;
DROP POLICY IF EXISTS merchant_place_photos_update ON storage.objects;
DROP POLICY IF EXISTS merchant_place_photos_delete ON storage.objects;
CREATE POLICY merchant_place_photos_insert ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'merchant-place-photos' AND auth.role() = 'service_role');
CREATE POLICY merchant_place_photos_update ON storage.objects FOR UPDATE
  USING (bucket_id = 'merchant-place-photos' AND auth.role() = 'service_role')
  WITH CHECK (bucket_id = 'merchant-place-photos' AND auth.role() = 'service_role');
CREATE POLICY merchant_place_photos_delete ON storage.objects FOR DELETE
  USING (bucket_id = 'merchant-place-photos' AND auth.role() = 'service_role');

DROP POLICY IF EXISTS merchant_payment_proofs_select ON storage.objects;
DROP POLICY IF EXISTS merchant_payment_proofs_insert ON storage.objects;
DROP POLICY IF EXISTS merchant_payment_proofs_update ON storage.objects;
DROP POLICY IF EXISTS merchant_payment_proofs_delete ON storage.objects;
CREATE POLICY merchant_payment_proofs_select ON storage.objects FOR SELECT
  USING (bucket_id = 'merchant-payment-proofs' AND auth.role() = 'service_role');
CREATE POLICY merchant_payment_proofs_insert ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'merchant-payment-proofs' AND auth.role() = 'service_role');
CREATE POLICY merchant_payment_proofs_update ON storage.objects FOR UPDATE
  USING (bucket_id = 'merchant-payment-proofs' AND auth.role() = 'service_role')
  WITH CHECK (bucket_id = 'merchant-payment-proofs' AND auth.role() = 'service_role');
CREATE POLICY merchant_payment_proofs_delete ON storage.objects FOR DELETE
  USING (bucket_id = 'merchant-payment-proofs' AND auth.role() = 'service_role');

DROP POLICY IF EXISTS sim_box_imports_select ON storage.objects;
DROP POLICY IF EXISTS sim_box_imports_insert ON storage.objects;
DROP POLICY IF EXISTS sim_box_imports_update ON storage.objects;
DROP POLICY IF EXISTS sim_box_imports_delete ON storage.objects;
CREATE POLICY sim_box_imports_select ON storage.objects FOR SELECT
  USING (bucket_id = 'sim-box-imports' AND auth.role() = 'service_role');
CREATE POLICY sim_box_imports_insert ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'sim-box-imports' AND auth.role() = 'service_role');
CREATE POLICY sim_box_imports_update ON storage.objects FOR UPDATE
  USING (bucket_id = 'sim-box-imports' AND auth.role() = 'service_role')
  WITH CHECK (bucket_id = 'sim-box-imports' AND auth.role() = 'service_role');
CREATE POLICY sim_box_imports_delete ON storage.objects FOR DELETE
  USING (bucket_id = 'sim-box-imports' AND auth.role() = 'service_role');
