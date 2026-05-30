-- Temporarily allow multiple attendance check-ins per employee per day for mobile/GPS testing.
-- Re-enable a same-day uniqueness guard before production if each employee should have one attendance record per date.

ALTER TABLE public.attendance_records
  DROP CONSTRAINT IF EXISTS attendance_records_org_id_employee_id_work_date_key;
