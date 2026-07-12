-- ============================================================
-- v54: Payroll Deduction Rules Groups
-- ============================================================
-- Introduces configurable payroll policy groups that define
-- late and absence deduction rules. Each employee is assigned
-- a group; rules are snapshotted into the payslip at
-- calculation time so historical records are never corrupted
-- by future policy changes.
-- ============================================================

-- ------------------------------------------------------------
-- 1. New table: deduction_rule_groups
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.deduction_rule_groups (
  id                                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                            uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name                              text NOT NULL,
  late_grace_minutes                integer NOT NULL DEFAULT 0,
  deduction_per_late_hour           numeric(14,2) NOT NULL DEFAULT 0,
  allowed_absent_days               integer NOT NULL DEFAULT 0,
  deduction_per_absent_day          numeric(14,2) NOT NULL DEFAULT 0,
  deduction_per_excess_approved_day numeric(14,2) NOT NULL DEFAULT 0,
  created_at                        timestamptz DEFAULT now(),
  updated_at                        timestamptz DEFAULT now(),
  UNIQUE (org_id, name)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_deduction_rule_groups_org
  ON public.deduction_rule_groups(org_id);

-- RLS
ALTER TABLE public.deduction_rule_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY drg_select ON public.deduction_rule_groups
  FOR SELECT USING (org_id = public.current_org_id());

CREATE POLICY drg_insert ON public.deduction_rule_groups
  FOR INSERT WITH CHECK (org_id = public.current_org_id() AND public.is_admin());

CREATE POLICY drg_update ON public.deduction_rule_groups
  FOR UPDATE USING (org_id = public.current_org_id() AND public.is_admin())
  WITH CHECK (org_id = public.current_org_id() AND public.is_admin());

CREATE POLICY drg_delete ON public.deduction_rule_groups
  FOR DELETE USING (org_id = public.current_org_id() AND public.is_admin());

-- ------------------------------------------------------------
-- 2. Link employees to a deduction rules group
-- ------------------------------------------------------------
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS deduction_rule_group_id uuid
    REFERENCES public.deduction_rule_groups(id) ON DELETE SET NULL;

-- ------------------------------------------------------------
-- 3. Extend payslips with snapshot + breakdown + manual adj.
-- ------------------------------------------------------------

-- Policy snapshot (captured at calculation time, never changes)
ALTER TABLE public.payslips
  ADD COLUMN IF NOT EXISTS snapshot_group_name                    text,
  ADD COLUMN IF NOT EXISTS snapshot_late_grace_minutes            integer,
  ADD COLUMN IF NOT EXISTS snapshot_deduction_per_late_hour       numeric(14,2),
  ADD COLUMN IF NOT EXISTS snapshot_allowed_absent_days           integer,
  ADD COLUMN IF NOT EXISTS snapshot_deduction_per_absent_day      numeric(14,2),
  ADD COLUMN IF NOT EXISTS snapshot_deduction_per_excess_approved_day numeric(14,2);

-- Attendance breakdown (computed values stored for transparency)
ALTER TABLE public.payslips
  ADD COLUMN IF NOT EXISTS approved_absent_days   integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unapproved_absent_days integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS late_minutes           integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS late_deduction         numeric(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS absence_deduction      numeric(14,2) DEFAULT 0;

-- Manual adjustments
-- Each entry shape: { id, type: "bonus"|"deduction", amount, reason, created_by, created_at }
ALTER TABLE public.payslips
  ADD COLUMN IF NOT EXISTS manual_adjustments       jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS manual_adjustments_total numeric(14,2) DEFAULT 0;
