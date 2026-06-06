CREATE TABLE IF NOT EXISTS public.employee_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES public.employees(id) ON DELETE CASCADE,
  location_id uuid REFERENCES public.locations(id) ON DELETE CASCADE,
  is_primary boolean DEFAULT false,
  assigned_from date,
  assigned_to date,
  created_at timestamptz DEFAULT now(),
  UNIQUE(employee_id, location_id)
);

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS province text;

CREATE INDEX IF NOT EXISTS idx_employee_locations_employee ON public.employee_locations(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_locations_location ON public.employee_locations(location_id);

ALTER TABLE public.employee_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS employee_locations_select ON public.employee_locations;
CREATE POLICY employee_locations_select ON public.employee_locations
FOR SELECT USING (
  EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE e.id = employee_locations.employee_id
      AND e.org_id = public.current_org_id()
  )
);

DROP POLICY IF EXISTS employee_locations_insert ON public.employee_locations;
CREATE POLICY employee_locations_insert ON public.employee_locations
FOR INSERT WITH CHECK (
  public.is_admin()
  AND EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE e.id = employee_locations.employee_id
      AND e.org_id = public.current_org_id()
  )
);

DROP POLICY IF EXISTS employee_locations_update ON public.employee_locations;
CREATE POLICY employee_locations_update ON public.employee_locations
FOR UPDATE USING (public.is_admin())
WITH CHECK (
  public.is_admin()
  AND EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE e.id = employee_locations.employee_id
      AND e.org_id = public.current_org_id()
  )
);

DROP POLICY IF EXISTS employee_locations_delete ON public.employee_locations;
CREATE POLICY employee_locations_delete ON public.employee_locations
FOR DELETE USING (public.is_admin());
