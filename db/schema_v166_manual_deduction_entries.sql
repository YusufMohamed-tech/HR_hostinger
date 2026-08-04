-- v166: Manual deduction/absence entries for HR
-- Replaces automatic rule-based deductions with manual HR entries.

-- 1. New table: employee_manual_entries
CREATE TABLE IF NOT EXISTS public.employee_manual_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  entry_type text NOT NULL CHECK (entry_type IN ('deduction', 'absence')),
  amount numeric(14,2),
  days integer,
  reason text NOT NULL,
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  month text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'cancelled')),
  applied_to_payslip_id uuid REFERENCES public.payslips(id) ON DELETE SET NULL,
  accounting_journal_entry_id uuid,
  accounting_status text DEFAULT 'pending' CHECK (accounting_status IN ('pending', 'posted', 'reversed', 'failed', 'skipped')),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_manual_entries_employee
  ON public.employee_manual_entries(org_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_manual_entries_month
  ON public.employee_manual_entries(org_id, month);
CREATE INDEX IF NOT EXISTS idx_manual_entries_status
  ON public.employee_manual_entries(org_id, status);

ALTER TABLE public.employee_manual_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY manual_entries_select ON public.employee_manual_entries
  FOR SELECT USING (org_id = public.current_org_id());

CREATE POLICY manual_entries_service_write ON public.employee_manual_entries
  FOR ALL TO service_role USING(true) WITH CHECK(true);

REVOKE ALL ON public.employee_manual_entries FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.employee_manual_entries TO authenticated;
GRANT ALL ON public.employee_manual_entries TO service_role;

-- 2. Add penalty account settings to accounting_settings
ALTER TABLE public.accounting_settings
  ADD COLUMN IF NOT EXISTS default_penalties_expense_id uuid,
  ADD COLUMN IF NOT EXISTS default_penalties_payable_id uuid,
  ADD COLUMN IF NOT EXISTS auto_post_hr_penalties boolean NOT NULL DEFAULT false;
