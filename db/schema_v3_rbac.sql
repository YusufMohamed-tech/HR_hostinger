ALTER TYPE public.org_role ADD VALUE IF NOT EXISTS 'hr_admin';
ALTER TYPE public.org_role ADD VALUE IF NOT EXISTS 'hr_recruitment';
ALTER TYPE public.org_role ADD VALUE IF NOT EXISTS 'training_manager';

-- Enable RLS logic for training managers so they only see employees in their location
-- Drop old employee select policy and replace
DROP POLICY IF EXISTS org_select_employees ON public.employees;
CREATE POLICY org_select_employees ON public.employees FOR SELECT USING (
  org_id = public.current_org_id() AND (
    public.is_admin() OR 
    (public.current_role() = 'hr_admin') OR 
    (public.current_role() = 'hr_recruitment') OR
    (public.current_role() = 'training_manager' AND location_id = (SELECT location_id FROM public.employees WHERE id = public.current_employee_id())) OR
    user_id = auth.uid()
  )
);
