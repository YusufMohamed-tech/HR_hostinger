ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS is_test_account boolean DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_employees_is_test_account ON public.employees(is_test_account);
