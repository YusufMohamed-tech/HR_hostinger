-- HR operations refinements: location classification, employee master data,
-- richer leave types/attachments, and asset inventory serial selection.
-- Additive and production-safe: no data deletion.

ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.sales_companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS project_name text,
  ADD COLUMN IF NOT EXISTS address_details text;

CREATE INDEX IF NOT EXISTS idx_locations_org_city_project
  ON public.locations(org_id, city, project_id, name);

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS full_name_ar text,
  ADD COLUMN IF NOT EXISTS full_name_en text,
  ADD COLUMN IF NOT EXISTS date_of_birth_hijri text,
  ADD COLUMN IF NOT EXISTS work_city text,
  ADD COLUMN IF NOT EXISTS national_address_code text,
  ADD COLUMN IF NOT EXISTS bank_account_name text,
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS iban text,
  ADD COLUMN IF NOT EXISTS education_level text,
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.sales_companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.sales_companies(id) ON DELETE SET NULL;

UPDATE public.employees
SET
  full_name_ar = COALESCE(full_name_ar, full_name),
  work_city = COALESCE(work_city, city, province)
WHERE full_name_ar IS NULL
   OR work_city IS NULL;

CREATE INDEX IF NOT EXISTS idx_employees_org_city_project
  ON public.employees(org_id, work_city, project_id, department_id);

CREATE OR REPLACE FUNCTION public.generate_employee_code(p_org_id uuid)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  next_number integer;
  candidate text;
BEGIN
  SELECT COALESCE(
    MAX(NULLIF(regexp_replace(employee_code, '\D', '', 'g'), '')::integer),
    0
  ) + 1
  INTO next_number
  FROM public.employees
  WHERE org_id = p_org_id
    AND employee_code ~ '\d';

  LOOP
    candidate := 'EMP-' || lpad(next_number::text, 5, '0');
    EXIT WHEN NOT EXISTS (
      SELECT 1
      FROM public.employees
      WHERE org_id = p_org_id
        AND employee_code = candidate
    );
    next_number := next_number + 1;
  END LOOP;

  RETURN candidate;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_employee_code_before_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.employee_code IS NULL OR btrim(NEW.employee_code) = '' THEN
    NEW.employee_code := public.generate_employee_code(NEW.org_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_employee_code_before_insert ON public.employees;
CREATE TRIGGER trg_set_employee_code_before_insert
  BEFORE INSERT ON public.employees
  FOR EACH ROW
  EXECUTE FUNCTION public.set_employee_code_before_insert();

DO $$
BEGIN
  ALTER TYPE public.leave_type ADD VALUE IF NOT EXISTS 'unpaid';
  ALTER TYPE public.leave_type ADD VALUE IF NOT EXISTS 'weekly';
  ALTER TYPE public.leave_type ADD VALUE IF NOT EXISTS 'marriage';
  ALTER TYPE public.leave_type ADD VALUE IF NOT EXISTS 'bereavement';
END $$;

ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS days_count integer,
  ADD COLUMN IF NOT EXISTS attachment_url text,
  ADD COLUMN IF NOT EXISTS attachment_name text,
  ADD COLUMN IF NOT EXISTS attachment_required boolean NOT NULL DEFAULT false;

UPDATE public.leave_requests
SET days_count = GREATEST(1, (end_date - start_date) + 1)
WHERE days_count IS NULL
  AND start_date IS NOT NULL
  AND end_date IS NOT NULL;

ALTER TABLE public.leave_balance_transactions
  DROP CONSTRAINT IF EXISTS leave_balance_transactions_leave_type_check;

ALTER TABLE public.leave_balance_transactions
  ADD CONSTRAINT leave_balance_transactions_leave_type_check
  CHECK (leave_type IN ('sick', 'vacation', 'emergency', 'unpaid', 'weekly', 'marriage', 'bereavement'));

CREATE TABLE IF NOT EXISTS public.asset_inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  asset_name text NOT NULL,
  asset_type text NOT NULL,
  serial_number text NOT NULL,
  office_location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'assigned', 'returned', 'damaged', 'lost', 'retired')),
  current_employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  current_assignment_id uuid,
  received_date date DEFAULT CURRENT_DATE,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, serial_number)
);

ALTER TABLE public.asset_inventory
  DROP CONSTRAINT IF EXISTS asset_inventory_status_check;

ALTER TABLE public.asset_inventory
  ADD CONSTRAINT asset_inventory_status_check
  CHECK (status IN ('available', 'assigned', 'returned', 'damaged', 'lost', 'retired', 'transferred'));

ALTER TABLE public.employee_assets
  ADD COLUMN IF NOT EXISTS inventory_id uuid REFERENCES public.asset_inventory(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'asset_inventory_current_assignment_fkey'
  ) THEN
    ALTER TABLE public.asset_inventory
      ADD CONSTRAINT asset_inventory_current_assignment_fkey
      FOREIGN KEY (current_assignment_id)
      REFERENCES public.employee_assets(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_asset_inventory_org_status
  ON public.asset_inventory(org_id, status, asset_type, office_location_id);

CREATE INDEX IF NOT EXISTS idx_employee_assets_inventory
  ON public.employee_assets(inventory_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_asset_inventory_updated_at'
  ) THEN
    CREATE TRIGGER trg_asset_inventory_updated_at
      BEFORE UPDATE ON public.asset_inventory
      FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
END $$;

ALTER TABLE public.asset_inventory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS asset_inventory_select ON public.asset_inventory;
CREATE POLICY asset_inventory_select ON public.asset_inventory
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR org_id = public.current_org_id()
  );

DROP POLICY IF EXISTS asset_inventory_manage ON public.asset_inventory;
CREATE POLICY asset_inventory_manage ON public.asset_inventory
  FOR ALL USING (
    auth.role() = 'service_role'
    OR (
      org_id = public.current_org_id()
      AND public.current_role() IN ('admin', 'hr_admin')
    )
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR (
      org_id = public.current_org_id()
      AND public.current_role() IN ('admin', 'hr_admin')
    )
  );
