-- Allow department managers to see and approve leave requests for employees in their departments.
-- Non-destructive: updates the scope helper used by employees and leave request RLS policies.

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
        LEFT JOIN public.departments dept ON dept.id = target.department_id
        LEFT JOIN public.locations loc ON loc.id = target.location_id
        WHERE target.id = target_employee_id
          AND target.org_id = public.current_org_id()
          AND (
            target.manager_id = me.id
            OR dept.manager_employee_id = me.id
            OR loc.manager_employee_id = me.id
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
