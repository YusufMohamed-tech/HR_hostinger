-- Compatibility bridge required by schema_v45_auto_flow_fixes.sql.
-- Historical assets used assigned_date; accounting depreciation uses the
-- distinct purchase date. Backfill it deterministically before v45 runs.

ALTER TABLE public.employee_assets
  ADD COLUMN IF NOT EXISTS purchase_date date DEFAULT CURRENT_DATE;

UPDATE public.employee_assets
SET purchase_date = assigned_date
WHERE purchase_date IS NULL;

ALTER TABLE public.employee_assets
  ALTER COLUMN purchase_date SET NOT NULL;
