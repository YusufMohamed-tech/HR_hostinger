-- Trader sale activation details captured before a merchant sale is completed.
-- Additive only: existing sales remain valid, new merchant UI requires these fields.

ALTER TABLE public.sim_sales
  ADD COLUMN IF NOT EXISTS customer_national_id text;
ALTER TABLE public.sim_sales
  ADD COLUMN IF NOT EXISTS customer_absher_mobile text;
ALTER TABLE public.sim_sales
  ADD COLUMN IF NOT EXISTS customer_birth_date_hijri text;
ALTER TABLE public.sim_sales
  ADD COLUMN IF NOT EXISTS customer_id_expiry_hijri text;
ALTER TABLE public.sim_sales
  ADD COLUMN IF NOT EXISTS customer_email text;
ALTER TABLE public.sim_sales
  ADD COLUMN IF NOT EXISTS customer_nationality text;
ALTER TABLE public.sim_sales
  ADD COLUMN IF NOT EXISTS package_reference text;
ALTER TABLE public.sim_sales
  ADD COLUMN IF NOT EXISTS device_serial text;
ALTER TABLE public.sim_sales
  ADD COLUMN IF NOT EXISTS city_district text;
ALTER TABLE public.sim_sales
  ADD COLUMN IF NOT EXISTS marketer_name text;
ALTER TABLE public.sim_sales
  ADD COLUMN IF NOT EXISTS national_address text;
ALTER TABLE public.sim_sales
  ADD COLUMN IF NOT EXISTS supervisor_name text;

CREATE INDEX IF NOT EXISTS idx_sim_sales_customer_national_id
  ON public.sim_sales (organization_id, customer_national_id);

CREATE INDEX IF NOT EXISTS idx_sim_sales_device_serial
  ON public.sim_sales (organization_id, device_serial);
