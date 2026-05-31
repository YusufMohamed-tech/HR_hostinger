-- Automatically bind attendance to the employee's active shift, calculate late minutes,
-- and notify HR/admin users while keeping the late value saved on attendance history.

CREATE OR REPLACE FUNCTION public.apply_shift_late_attendance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  active_shift record;
  check_in_value timestamptz;
  shift_start_at timestamptz;
  computed_late_minutes integer;
BEGIN
  check_in_value := COALESCE(NEW.check_in_at, now());
  NEW.check_in_at := check_in_value;

  SELECT
    es.shift_id,
    s.start_time,
    s.name AS shift_name
  INTO active_shift
  FROM public.employee_shifts es
  JOIN public.shifts s ON s.id = es.shift_id
  WHERE es.org_id = NEW.org_id
    AND es.employee_id = NEW.employee_id
    AND (es.start_date IS NULL OR es.start_date <= NEW.work_date)
    AND (es.end_date IS NULL OR es.end_date >= NEW.work_date)
  ORDER BY es.start_date DESC NULLS LAST, es.created_at DESC
  LIMIT 1;

  IF active_shift.shift_id IS NOT NULL THEN
    NEW.shift_id := active_shift.shift_id;
  END IF;

  IF active_shift.start_time IS NOT NULL THEN
    shift_start_at := ((NEW.work_date::timestamp + active_shift.start_time) AT TIME ZONE 'Africa/Cairo');
    computed_late_minutes := GREATEST(
      0,
      FLOOR(EXTRACT(EPOCH FROM (check_in_value - shift_start_at)) / 60)::integer
    );

    NEW.late_minutes := computed_late_minutes;
    IF computed_late_minutes > 0 THEN
      NEW.status := 'late'::public.attendance_status;
    ELSIF NEW.status IS NULL OR NEW.status = 'late'::public.attendance_status THEN
      NEW.status := 'present'::public.attendance_status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_shift_late_attendance ON public.attendance_records;
CREATE TRIGGER trg_apply_shift_late_attendance
  BEFORE INSERT OR UPDATE OF check_in_at, work_date, employee_id
  ON public.attendance_records
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_shift_late_attendance();

CREATE OR REPLACE FUNCTION public.notify_hr_late_attendance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  employee_name text;
  late_body text;
BEGIN
  IF COALESCE(NEW.late_minutes, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
    AND COALESCE(OLD.late_minutes, 0) = COALESCE(NEW.late_minutes, 0)
    AND OLD.status = NEW.status
  THEN
    RETURN NEW;
  END IF;

  SELECT full_name
  INTO employee_name
  FROM public.employees
  WHERE id = NEW.employee_id;

  late_body := COALESCE(employee_name, 'Employee')
    || ' تأخر عن موعد الشيفت '
    || NEW.late_minutes::text
    || ' دقيقة في تاريخ '
    || NEW.work_date::text
    || '.';

  INSERT INTO public.notifications (org_id, user_id, title, body, type, link, is_read)
  SELECT
    NEW.org_id,
    om.user_id,
    'تنبيه تأخير حضور',
    late_body,
    'attendance'::public.notification_type,
    '/attendance',
    false
  FROM public.org_members om
  WHERE om.org_id = NEW.org_id
    AND om.role::text IN ('admin', 'hr_admin');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_hr_late_attendance ON public.attendance_records;
CREATE TRIGGER trg_notify_hr_late_attendance
  AFTER INSERT OR UPDATE OF late_minutes, status
  ON public.attendance_records
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_hr_late_attendance();

CREATE INDEX IF NOT EXISTS idx_attendance_org_work_date_late
  ON public.attendance_records(org_id, work_date, late_minutes)
  WHERE late_minutes > 0;

CREATE INDEX IF NOT EXISTS idx_employee_shifts_active_lookup
  ON public.employee_shifts(org_id, employee_id, start_date, end_date);
