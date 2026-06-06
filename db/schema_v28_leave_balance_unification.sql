ALTER TABLE public.leave_balances
  ADD COLUMN IF NOT EXISTS accrual_start_date date,
  ADD COLUMN IF NOT EXISTS vacation_accrued_days numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS manual_adjustment numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_accrual_calculated_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY org_id, employee_id ORDER BY updated_at DESC NULLS LAST, id DESC) AS rn
  FROM public.leave_balances
)
DELETE FROM public.leave_balances lb
USING ranked
WHERE lb.id = ranked.id
  AND ranked.rn > 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'leave_balances_org_employee_unique'
  ) THEN
    ALTER TABLE public.leave_balances
      ADD CONSTRAINT leave_balances_org_employee_unique UNIQUE (org_id, employee_id);
  END IF;
END $$;

UPDATE public.leave_balances lb
SET
  accrual_start_date = COALESCE(lb.accrual_start_date, e.leave_accrual_start_date, e.hiring_date),
  manual_adjustment = COALESCE(lb.manual_adjustment, e.leave_balance_manual_adjustment, 0),
  vacation_accrued_days = COALESCE(lb.vacation_accrued_days, e.leave_balance_days, lb.vacation_remaining, 0),
  last_accrual_calculated_at = COALESCE(lb.last_accrual_calculated_at, now())
FROM public.employees e
WHERE e.id = lb.employee_id;

CREATE TABLE IF NOT EXISTS public.leave_balance_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  leave_balance_id uuid REFERENCES public.leave_balances(id) ON DELETE SET NULL,
  leave_request_id uuid REFERENCES public.leave_requests(id) ON DELETE SET NULL,
  leave_type text NOT NULL CHECK (leave_type IN ('sick', 'vacation', 'emergency')),
  transaction_type text NOT NULL CHECK (transaction_type IN ('initial', 'accrual', 'manual_adjustment', 'leave_deduction')),
  amount numeric NOT NULL,
  balance_before numeric NOT NULL DEFAULT 0,
  balance_after numeric NOT NULL DEFAULT 0,
  reason text,
  created_by uuid,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.leave_balance_transactions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'leave_balance_transactions'
      AND policyname = 'leave_balance_transactions_org_members_select'
  ) THEN
    CREATE POLICY leave_balance_transactions_org_members_select
      ON public.leave_balance_transactions
      FOR SELECT
      USING (public.is_org_member(org_id));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'leave_balance_transactions'
      AND policyname = 'leave_balance_transactions_admin_insert'
  ) THEN
    CREATE POLICY leave_balance_transactions_admin_insert
      ON public.leave_balance_transactions
      FOR INSERT
      WITH CHECK (public.is_admin() OR auth.role() = 'service_role');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_leave_balance_transactions_org_employee
  ON public.leave_balance_transactions(org_id, employee_id, created_at DESC);
