ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS leave_balance_days numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS leave_accrual_start_date date,
  ADD COLUMN IF NOT EXISTS leave_balance_manual_adjustment numeric DEFAULT 0;
