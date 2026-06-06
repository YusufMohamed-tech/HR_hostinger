ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS can_multi_checkin boolean DEFAULT false;
