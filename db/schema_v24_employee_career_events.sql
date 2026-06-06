CREATE TABLE IF NOT EXISTS public.employee_career_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES public.employees(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  previous_value jsonb,
  new_value jsonb,
  effective_date date NOT NULL,
  notes text,
  created_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employee_career_events_employee ON public.employee_career_events(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_career_events_date ON public.employee_career_events(effective_date);

ALTER TABLE public.employee_career_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS employee_career_events_select ON public.employee_career_events;
CREATE POLICY employee_career_events_select ON public.employee_career_events
FOR SELECT USING (
  EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE e.id = employee_career_events.employee_id
      AND e.org_id = public.current_org_id()
  )
);

DROP POLICY IF EXISTS employee_career_events_insert ON public.employee_career_events;
CREATE POLICY employee_career_events_insert ON public.employee_career_events
FOR INSERT WITH CHECK (
  public.is_admin()
  AND EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE e.id = employee_career_events.employee_id
      AND e.org_id = public.current_org_id()
  )
);
