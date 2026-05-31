-- Production hardening for recruitment, approvals, payroll components, device lock, and acknowledgments.

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT role::text IN ('admin', 'hr_admin')
      FROM public.org_members
      WHERE user_id = auth.uid()
      LIMIT 1
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_hr()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin();
$$;

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

ALTER TABLE public.job_applications
  ADD COLUMN IF NOT EXISTS extracted_skills jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS highlights jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS red_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS match_score integer DEFAULT 0 CHECK (match_score BETWEEN 0 AND 100);

ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS approval_history jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.payslips
  ADD COLUMN IF NOT EXISTS allowances_details jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS deductions_details jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS payroll_notes text;

ALTER TABLE public.employee_assets
  ADD COLUMN IF NOT EXISTS assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS returned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS acknowledgment_signature_url text,
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz;

ALTER TABLE public.attendance_records
  ADD COLUMN IF NOT EXISTS check_out_within_geofence boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS check_out_distance_meters integer DEFAULT 0;

DROP POLICY IF EXISTS job_applications_insert ON public.job_applications;
CREATE POLICY job_applications_insert ON public.job_applications
  FOR INSERT WITH CHECK (
    candidate_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.job_postings jp
      WHERE jp.id = job_posting_id
        AND jp.org_id = job_applications.org_id
        AND jp.status IN ('open','published')
        AND (jp.application_deadline IS NULL OR jp.application_deadline >= CURRENT_DATE)
    )
  );

CREATE INDEX IF NOT EXISTS idx_job_applications_score
  ON public.job_applications(org_id, match_score DESC);

CREATE INDEX IF NOT EXISTS idx_leave_requests_status
  ON public.leave_requests(org_id, status, current_step);

DROP POLICY IF EXISTS org_select_attendance_records ON public.attendance_records;
DROP POLICY IF EXISTS org_insert_attendance_records ON public.attendance_records;
DROP POLICY IF EXISTS org_update_attendance_records ON public.attendance_records;
DROP POLICY IF EXISTS org_delete_attendance_records ON public.attendance_records;
DROP POLICY IF EXISTS attendance_self_insert ON public.attendance_records;
DROP POLICY IF EXISTS attendance_self_update ON public.attendance_records;
DROP POLICY IF EXISTS attendance_records_select ON public.attendance_records;
DROP POLICY IF EXISTS attendance_records_insert ON public.attendance_records;
DROP POLICY IF EXISTS attendance_records_update ON public.attendance_records;
DROP POLICY IF EXISTS attendance_records_delete ON public.attendance_records;

CREATE POLICY attendance_records_select ON public.attendance_records
  FOR SELECT USING (
    org_id = public.current_org_id()
    AND public.can_manage_employee_scope(employee_id)
  );

CREATE POLICY attendance_records_insert ON public.attendance_records
  FOR INSERT WITH CHECK (
    org_id = public.current_org_id()
    AND employee_id = public.current_employee_id()
  );

CREATE POLICY attendance_records_update ON public.attendance_records
  FOR UPDATE USING (
    org_id = public.current_org_id()
    AND (employee_id = public.current_employee_id() OR public.is_admin())
  )
  WITH CHECK (
    org_id = public.current_org_id()
    AND (employee_id = public.current_employee_id() OR public.is_admin())
  );

CREATE POLICY attendance_records_delete ON public.attendance_records
  FOR DELETE USING (org_id = public.current_org_id() AND public.is_admin());

DROP POLICY IF EXISTS org_select_leave_requests ON public.leave_requests;
DROP POLICY IF EXISTS org_insert_leave_requests ON public.leave_requests;
DROP POLICY IF EXISTS org_update_leave_requests ON public.leave_requests;
DROP POLICY IF EXISTS org_delete_leave_requests ON public.leave_requests;
DROP POLICY IF EXISTS leave_requests_self_select ON public.leave_requests;
DROP POLICY IF EXISTS leave_requests_self_insert ON public.leave_requests;
DROP POLICY IF EXISTS leave_requests_select ON public.leave_requests;
DROP POLICY IF EXISTS leave_requests_insert ON public.leave_requests;
DROP POLICY IF EXISTS leave_requests_update ON public.leave_requests;
DROP POLICY IF EXISTS leave_requests_delete ON public.leave_requests;

CREATE POLICY leave_requests_select ON public.leave_requests
  FOR SELECT USING (
    org_id = public.current_org_id()
    AND public.can_manage_employee_scope(employee_id)
  );

CREATE POLICY leave_requests_insert ON public.leave_requests
  FOR INSERT WITH CHECK (
    org_id = public.current_org_id()
    AND employee_id = public.current_employee_id()
  );

CREATE POLICY leave_requests_update ON public.leave_requests
  FOR UPDATE USING (
    org_id = public.current_org_id()
    AND (
      public.is_admin()
      OR (
        public.current_role() = 'training_manager'
        AND public.can_manage_employee_scope(employee_id)
      )
    )
  )
  WITH CHECK (
    org_id = public.current_org_id()
    AND (
      public.is_admin()
      OR (
        public.current_role() = 'training_manager'
        AND public.can_manage_employee_scope(employee_id)
      )
    )
  );

CREATE POLICY leave_requests_delete ON public.leave_requests
  FOR DELETE USING (org_id = public.current_org_id() AND public.is_admin());
