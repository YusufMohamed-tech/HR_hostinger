-- Store full shift timing results on attendance history.
-- Arrival: early / on_time / late. Departure: early_leave / on_time / overtime.

ALTER TABLE public.attendance_records
  ADD COLUMN IF NOT EXISTS scheduled_check_in_at timestamptz,
  ADD COLUMN IF NOT EXISTS scheduled_check_out_at timestamptz,
  ADD COLUMN IF NOT EXISTS early_arrival_minutes integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS early_leave_minutes integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overtime_minutes integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS arrival_status text DEFAULT 'on_time',
  ADD COLUMN IF NOT EXISTS departure_status text;

CREATE OR REPLACE FUNCTION public.apply_shift_late_attendance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  active_shift record;
  check_in_value timestamptz;
  check_out_value timestamptz;
  shift_start_at timestamptz;
  shift_end_at timestamptz;
  late_value integer;
  early_arrival_value integer;
  early_leave_value integer;
  overtime_value integer;
BEGIN
  check_in_value := COALESCE(NEW.check_in_at, now());
  NEW.check_in_at := check_in_value;
  check_out_value := NEW.check_out_at;

  SELECT
    es.shift_id,
    s.start_time,
    s.end_time,
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
    NEW.scheduled_check_in_at := shift_start_at;

    late_value := GREATEST(
      0,
      FLOOR(EXTRACT(EPOCH FROM (check_in_value - shift_start_at)) / 60)::integer
    );
    early_arrival_value := GREATEST(
      0,
      FLOOR(EXTRACT(EPOCH FROM (shift_start_at - check_in_value)) / 60)::integer
    );

    NEW.late_minutes := late_value;
    NEW.early_arrival_minutes := early_arrival_value;

    IF late_value > 0 THEN
      NEW.arrival_status := 'late';
      NEW.status := 'late'::public.attendance_status;
    ELSIF early_arrival_value > 0 THEN
      NEW.arrival_status := 'early';
      IF NEW.status IS NULL OR NEW.status = 'late'::public.attendance_status THEN
        NEW.status := 'present'::public.attendance_status;
      END IF;
    ELSE
      NEW.arrival_status := 'on_time';
      IF NEW.status IS NULL OR NEW.status = 'late'::public.attendance_status THEN
        NEW.status := 'present'::public.attendance_status;
      END IF;
    END IF;
  END IF;

  IF active_shift.end_time IS NOT NULL THEN
    shift_end_at := ((NEW.work_date::timestamp + active_shift.end_time) AT TIME ZONE 'Africa/Cairo');
    IF active_shift.start_time IS NOT NULL AND active_shift.end_time <= active_shift.start_time THEN
      shift_end_at := shift_end_at + interval '1 day';
    END IF;
    NEW.scheduled_check_out_at := shift_end_at;

    IF check_out_value IS NOT NULL THEN
      early_leave_value := GREATEST(
        0,
        FLOOR(EXTRACT(EPOCH FROM (shift_end_at - check_out_value)) / 60)::integer
      );
      overtime_value := GREATEST(
        0,
        FLOOR(EXTRACT(EPOCH FROM (check_out_value - shift_end_at)) / 60)::integer
      );

      NEW.early_leave_minutes := early_leave_value;
      NEW.overtime_minutes := overtime_value;

      IF early_leave_value > 0 THEN
        NEW.departure_status := 'early_leave';
      ELSIF overtime_value > 0 THEN
        NEW.departure_status := 'overtime';
      ELSE
        NEW.departure_status := 'on_time';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_shift_late_attendance ON public.attendance_records;
CREATE TRIGGER trg_apply_shift_late_attendance
  BEFORE INSERT OR UPDATE OF check_in_at, check_out_at, work_date, employee_id
  ON public.attendance_records
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_shift_late_attendance();

CREATE INDEX IF NOT EXISTS idx_attendance_departure_flags
  ON public.attendance_records(org_id, work_date, early_leave_minutes, overtime_minutes)
  WHERE early_leave_minutes > 0 OR overtime_minutes > 0;
