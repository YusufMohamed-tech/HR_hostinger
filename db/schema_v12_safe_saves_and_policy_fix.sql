-- Production-safe fixes for save failures.
-- This migration is non-destructive: it does not drop or truncate data tables.

ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS city text;

DROP POLICY IF EXISTS org_select_employees ON public.employees;
CREATE POLICY org_select_employees ON public.employees
  FOR SELECT USING (
    org_id = public.current_org_id()
    AND (
      public.is_admin()
      OR public.current_role() IN ('hr_admin', 'hr_recruitment')
      OR user_id = auth.uid()
      OR (
        public.current_role() = 'training_manager'
        AND public.can_manage_employee_scope(id)
      )
    )
  );

DROP POLICY IF EXISTS tasks_employee_select ON public.tasks;
CREATE POLICY tasks_employee_select ON public.tasks
  FOR SELECT USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1
      FROM public.task_assignments ta
      WHERE ta.task_id = tasks.id
        AND ta.employee_id = public.current_employee_id()
    )
  );
