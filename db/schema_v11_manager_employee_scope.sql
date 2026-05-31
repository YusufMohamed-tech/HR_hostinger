-- Allow managers to see and approve workflows for employees explicitly assigned to them by HR.

CREATE OR REPLACE FUNCTION public.can_manage_employee_scope(target_employee_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    public.is_admin()
    OR target_employee_id = public.current_employee_id()
    OR (
      public.current_role() = 'training_manager'
      AND EXISTS (
        SELECT 1
        FROM public.employees target
        JOIN public.employees me ON me.id = public.current_employee_id()
        WHERE target.id = target_employee_id
          AND target.org_id = public.current_org_id()
          AND (
            target.manager_id = me.id
            OR (
              me.location_id IS NOT NULL
              AND target.location_id = me.location_id
            )
          )
      )
    ),
    false
  );
$$;

DROP POLICY IF EXISTS org_select_employees ON public.employees;
CREATE POLICY org_select_employees ON public.employees FOR SELECT USING (
  org_id = public.current_org_id() AND (
    public.is_admin()
    OR public.current_role() IN ('hr_admin', 'hr_recruitment')
    OR user_id = auth.uid()
    OR (
      public.current_role() = 'training_manager'
      AND (
        manager_id = public.current_employee_id()
        OR location_id = (SELECT location_id FROM public.employees WHERE id = public.current_employee_id())
      )
    )
  )
);
