-- Server-authoritative attendance state machine.
-- The browser supplies only raw location/device evidence. Organization,
-- employee, business date, shift, server timestamps, distance, geofence,
-- status, lateness, and worked minutes are derived inside the database.

ALTER TABLE public.attendance_records
  ADD COLUMN IF NOT EXISTS check_in_request_id uuid,
  ADD COLUMN IF NOT EXISTS check_out_request_id uuid,
  ADD COLUMN IF NOT EXISTS check_in_accuracy_meters numeric,
  ADD COLUMN IF NOT EXISTS check_out_accuracy_meters numeric,
  ADD COLUMN IF NOT EXISTS device_risk_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
DECLARE
  duplicate_record record;
BEGIN
  SELECT org_id, employee_id, work_date, count(*) AS duplicate_count
  INTO duplicate_record
  FROM public.attendance_records
  GROUP BY org_id, employee_id, work_date
  HAVING count(*) > 1
  LIMIT 1;

  IF duplicate_record.org_id IS NOT NULL THEN
    RAISE EXCEPTION
      'Attendance duplicate must be reconciled before launch: org %, employee %, date %, rows %.',
      duplicate_record.org_id,
      duplicate_record.employee_id,
      duplicate_record.work_date,
      duplicate_record.duplicate_count;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS attendance_one_record_per_business_day_idx
  ON public.attendance_records(org_id, employee_id, work_date);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_check_in_request_unique_idx
  ON public.attendance_records(check_in_request_id)
  WHERE check_in_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS attendance_check_out_request_unique_idx
  ON public.attendance_records(check_out_request_id)
  WHERE check_out_request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.geo_distance_meters(
  latitude_a numeric,
  longitude_a numeric,
  latitude_b numeric,
  longitude_b numeric
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = pg_catalog
AS $$
  SELECT 6371000 * acos(
    LEAST(1, GREATEST(-1,
      cos(radians(latitude_a::double precision))
      * cos(radians(latitude_b::double precision))
      * cos(radians(longitude_b::double precision) - radians(longitude_a::double precision))
      + sin(radians(latitude_a::double precision))
      * sin(radians(latitude_b::double precision))
    ))
  );
$$;

-- Replace the historical Cairo-fixed trigger with organization business time.
CREATE OR REPLACE FUNCTION public.apply_shift_late_attendance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  active_shift record;
  organization_timezone text;
  check_in_value timestamptz;
  check_out_value timestamptz;
  shift_start_at timestamptz;
  shift_end_at timestamptz;
  late_value integer;
  early_arrival_value integer;
  early_leave_value integer;
  overtime_value integer;
BEGIN
  SELECT timezone INTO organization_timezone
  FROM public.organization_settings
  WHERE org_id = NEW.org_id;
  IF organization_timezone IS NULL THEN
    RAISE EXCEPTION 'Organization timezone is missing.';
  END IF;

  check_in_value := COALESCE(NEW.check_in_at, clock_timestamp());
  NEW.check_in_at := check_in_value;
  check_out_value := NEW.check_out_at;

  SELECT es.shift_id, s.start_time, s.end_time
  INTO active_shift
  FROM public.employee_shifts es
  JOIN public.shifts s
    ON s.id = es.shift_id
   AND s.org_id = es.org_id
  WHERE es.org_id = NEW.org_id
    AND es.employee_id = NEW.employee_id
    AND (es.start_date IS NULL OR es.start_date <= NEW.work_date)
    AND (es.end_date IS NULL OR es.end_date >= NEW.work_date)
  ORDER BY es.start_date DESC NULLS LAST, es.created_at DESC, es.id DESC
  LIMIT 1;

  IF active_shift.shift_id IS NOT NULL THEN
    NEW.shift_id := active_shift.shift_id;
  END IF;

  IF active_shift.start_time IS NOT NULL THEN
    shift_start_at := ((NEW.work_date::timestamp + active_shift.start_time) AT TIME ZONE organization_timezone);
    NEW.scheduled_check_in_at := shift_start_at;
    late_value := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (check_in_value - shift_start_at)) / 60)::integer);
    early_arrival_value := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (shift_start_at - check_in_value)) / 60)::integer);
    NEW.late_minutes := late_value;
    NEW.early_arrival_minutes := early_arrival_value;
    IF late_value > 0 THEN
      NEW.arrival_status := 'late';
      NEW.status := 'late'::public.attendance_status;
    ELSIF early_arrival_value > 0 THEN
      NEW.arrival_status := 'early';
      NEW.status := 'present'::public.attendance_status;
    ELSE
      NEW.arrival_status := 'on_time';
      NEW.status := 'present'::public.attendance_status;
    END IF;
  ELSE
    NEW.status := COALESCE(NEW.status, 'present'::public.attendance_status);
    NEW.arrival_status := COALESCE(NEW.arrival_status, 'on_time');
  END IF;

  IF active_shift.end_time IS NOT NULL THEN
    shift_end_at := ((NEW.work_date::timestamp + active_shift.end_time) AT TIME ZONE organization_timezone);
    IF active_shift.start_time IS NOT NULL AND active_shift.end_time <= active_shift.start_time THEN
      shift_end_at := shift_end_at + interval '1 day';
    END IF;
    NEW.scheduled_check_out_at := shift_end_at;

    IF check_out_value IS NOT NULL THEN
      early_leave_value := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (shift_end_at - check_out_value)) / 60)::integer);
      overtime_value := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (check_out_value - shift_end_at)) / 60)::integer);
      NEW.early_leave_minutes := early_leave_value;
      NEW.overtime_minutes := overtime_value;
      NEW.departure_status := CASE
        WHEN early_leave_value > 0 THEN 'early_leave'
        WHEN overtime_value > 0 THEN 'overtime'
        ELSE 'on_time'
      END;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.attendance_check_in(
  p_org_id uuid,
  p_user_id uuid,
  p_request_id uuid,
  p_latitude numeric,
  p_longitude numeric,
  p_accuracy_meters numeric DEFAULT NULL,
  p_device_label text DEFAULT NULL,
  p_device_signal text DEFAULT NULL,
  p_photo_path text DEFAULT NULL
)
RETURNS SETOF public.attendance_records
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  employee_record public.employees%ROWTYPE;
  settings_record public.organization_settings%ROWTYPE;
  location_record record;
  existing_record public.attendance_records%ROWTYPE;
  organization_timezone text;
  business_date date;
  local_time time;
  active_shift record;
  distance_value numeric;
  allowed_radius integer;
  within_geofence_value boolean;
  event_payload jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'Request id is required.' USING ERRCODE = '22023';
  END IF;
  IF p_latitude NOT BETWEEN -90 AND 90 OR p_longitude NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'Valid coordinates are required.' USING ERRCODE = '22023';
  END IF;
  IF p_accuracy_meters IS NOT NULL AND (p_accuracy_meters < 0 OR p_accuracy_meters > 5000) THEN
    RAISE EXCEPTION 'Location accuracy is invalid.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO employee_record
  FROM public.employees
  WHERE org_id = p_org_id
    AND user_id = p_user_id
    AND COALESCE(status, 'Active') ILIKE 'active'
  FOR UPDATE;
  IF employee_record.id IS NULL THEN
    RAISE EXCEPTION 'Active employee profile is required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO settings_record
  FROM public.organization_settings
  WHERE org_id = p_org_id;
  IF settings_record.org_id IS NULL THEN
    RAISE EXCEPTION 'Organization settings are missing.';
  END IF;
  organization_timezone := settings_record.timezone;
  business_date := (clock_timestamp() AT TIME ZONE organization_timezone)::date;
  local_time := (clock_timestamp() AT TIME ZONE organization_timezone)::time;

  SELECT s.start_time, s.end_time
  INTO active_shift
  FROM public.employee_shifts es
  JOIN public.shifts s ON s.id = es.shift_id AND s.org_id = es.org_id
  WHERE es.org_id = p_org_id
    AND es.employee_id = employee_record.id
    AND (es.start_date IS NULL OR es.start_date <= business_date)
    AND (es.end_date IS NULL OR es.end_date >= business_date - 1)
  ORDER BY es.start_date DESC NULLS LAST, es.created_at DESC, es.id DESC
  LIMIT 1;
  IF active_shift.start_time IS NOT NULL
     AND active_shift.end_time IS NOT NULL
     AND active_shift.end_time <= active_shift.start_time
     AND local_time < active_shift.end_time THEN
    business_date := business_date - 1;
  END IF;

  SELECT * INTO existing_record
  FROM public.attendance_records
  WHERE check_in_request_id = p_request_id
  FOR UPDATE;
  IF existing_record.id IS NOT NULL THEN
    IF existing_record.org_id <> p_org_id OR existing_record.employee_id <> employee_record.id THEN
      RAISE EXCEPTION 'Request id belongs to another attendance operation.' USING ERRCODE = '23505';
    END IF;
    RETURN NEXT existing_record;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.attendance_records
    WHERE org_id = p_org_id AND employee_id = employee_record.id AND work_date = business_date
  ) THEN
    RAISE EXCEPTION 'Attendance already exists for this business date.' USING ERRCODE = '23505';
  END IF;

  SELECT
    loc.id,
    loc.latitude,
    loc.longitude,
    COALESCE(loc.radius_meters, settings_record.attendance_default_radius_meters) AS radius_meters,
    public.geo_distance_meters(p_latitude, p_longitude, loc.latitude, loc.longitude) AS distance_meters
  INTO location_record
  FROM public.locations loc
  WHERE loc.org_id = p_org_id
    AND loc.latitude IS NOT NULL
    AND loc.longitude IS NOT NULL
    AND (
      loc.id = employee_record.location_id
      OR EXISTS (
        SELECT 1 FROM public.employee_locations el
        WHERE el.org_id = p_org_id
          AND el.employee_id = employee_record.id
          AND el.location_id = loc.id
          AND (el.assigned_from IS NULL OR el.assigned_from <= business_date)
          AND (el.assigned_to IS NULL OR el.assigned_to >= business_date)
      )
    )
  ORDER BY public.geo_distance_meters(p_latitude, p_longitude, loc.latitude, loc.longitude), loc.id
  LIMIT 1;

  IF location_record.id IS NULL THEN
    RAISE EXCEPTION 'No active attendance location with coordinates is assigned.' USING ERRCODE = 'P0001';
  END IF;
  distance_value := ROUND(location_record.distance_meters::numeric, 2);
  allowed_radius := GREATEST(COALESCE(location_record.radius_meters, 100), 1);
  within_geofence_value := distance_value <= allowed_radius;
  IF NOT within_geofence_value AND NOT settings_record.allow_out_of_geofence_checkin THEN
    RAISE EXCEPTION 'Current location is outside the allowed attendance radius.' USING ERRCODE = 'P0001';
  END IF;
  IF p_photo_path IS NOT NULL
     AND p_photo_path NOT LIKE p_org_id::text || '/' || employee_record.id::text || '/%' THEN
    RAISE EXCEPTION 'Attendance photo path is outside the employee scope.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.attendance_records (
    org_id,
    employee_id,
    work_date,
    check_in_at,
    check_in_lat,
    check_in_lng,
    check_in_accuracy_meters,
    check_in_device,
    device_fingerprint,
    device_risk_metadata,
    check_in_photo_path,
    location_id,
    within_geofence,
    distance_meters,
    check_in_request_id,
    status
  ) VALUES (
    p_org_id,
    employee_record.id,
    business_date,
    clock_timestamp(),
    p_latitude,
    p_longitude,
    p_accuracy_meters,
    left(p_device_label, 500),
    left(p_device_signal, 500),
    jsonb_build_object('device_signal_trusted', false),
    p_photo_path,
    location_record.id,
    within_geofence_value,
    ROUND(distance_value)::integer,
    p_request_id,
    'present'::public.attendance_status
  )
  RETURNING * INTO existing_record;

  event_payload := jsonb_build_object(
    'attendance_id', existing_record.id,
    'employee_id', existing_record.employee_id,
    'work_date', existing_record.work_date,
    'check_in_at', existing_record.check_in_at,
    'location_id', existing_record.location_id,
    'within_geofence', existing_record.within_geofence
  );
  INSERT INTO public.business_events (
    org_id, source_type, business_key, payload, payload_hash, status,
    request_id, actor_user_id, occurred_at, processed_at
  ) VALUES (
    p_org_id,
    'attendance.check_in',
    existing_record.id::text,
    event_payload,
    encode(digest(event_payload::text, 'sha256'), 'hex'),
    'completed',
    p_request_id,
    p_user_id,
    existing_record.check_in_at,
    clock_timestamp()
  ) ON CONFLICT (org_id, source_type, business_key) DO NOTHING;

  RETURN NEXT existing_record;
  RETURN;
END;
$$;

CREATE OR REPLACE FUNCTION public.attendance_check_out(
  p_org_id uuid,
  p_user_id uuid,
  p_attendance_id uuid,
  p_request_id uuid,
  p_latitude numeric,
  p_longitude numeric,
  p_accuracy_meters numeric DEFAULT NULL,
  p_device_label text DEFAULT NULL,
  p_device_signal text DEFAULT NULL
)
RETURNS SETOF public.attendance_records
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  employee_record public.employees%ROWTYPE;
  attendance_record public.attendance_records%ROWTYPE;
  settings_record public.organization_settings%ROWTYPE;
  location_record record;
  distance_value numeric;
  allowed_radius integer;
  within_geofence_value boolean;
  event_payload jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL OR p_attendance_id IS NULL THEN
    RAISE EXCEPTION 'Attendance id and request id are required.' USING ERRCODE = '22023';
  END IF;
  IF p_latitude NOT BETWEEN -90 AND 90 OR p_longitude NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'Valid coordinates are required.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO employee_record
  FROM public.employees
  WHERE org_id = p_org_id
    AND user_id = p_user_id
    AND COALESCE(status, 'Active') ILIKE 'active';
  IF employee_record.id IS NULL THEN
    RAISE EXCEPTION 'Active employee profile is required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO attendance_record
  FROM public.attendance_records
  WHERE id = p_attendance_id
    AND org_id = p_org_id
    AND employee_id = employee_record.id
  FOR UPDATE;
  IF attendance_record.id IS NULL THEN
    RAISE EXCEPTION 'Attendance record was not found.' USING ERRCODE = 'P0002';
  END IF;
  IF attendance_record.check_out_at IS NOT NULL THEN
    IF attendance_record.check_out_request_id = p_request_id THEN
      RETURN NEXT attendance_record;
      RETURN;
    END IF;
    RAISE EXCEPTION 'Attendance is already checked out.' USING ERRCODE = '23505';
  END IF;

  SELECT * INTO settings_record FROM public.organization_settings WHERE org_id = p_org_id;
  SELECT
    loc.id,
    COALESCE(loc.radius_meters, settings_record.attendance_default_radius_meters) AS radius_meters,
    public.geo_distance_meters(p_latitude, p_longitude, loc.latitude, loc.longitude) AS distance_meters
  INTO location_record
  FROM public.locations loc
  WHERE loc.org_id = p_org_id
    AND loc.latitude IS NOT NULL
    AND loc.longitude IS NOT NULL
    AND (
      loc.id = employee_record.location_id
      OR EXISTS (
        SELECT 1 FROM public.employee_locations el
        WHERE el.org_id = p_org_id
          AND el.employee_id = employee_record.id
          AND el.location_id = loc.id
          AND (el.assigned_from IS NULL OR el.assigned_from <= attendance_record.work_date)
          AND (el.assigned_to IS NULL OR el.assigned_to >= attendance_record.work_date)
      )
    )
  ORDER BY public.geo_distance_meters(p_latitude, p_longitude, loc.latitude, loc.longitude), loc.id
  LIMIT 1;
  IF location_record.id IS NULL THEN
    RAISE EXCEPTION 'No active attendance location with coordinates is assigned.' USING ERRCODE = 'P0001';
  END IF;
  distance_value := ROUND(location_record.distance_meters::numeric, 2);
  allowed_radius := GREATEST(COALESCE(location_record.radius_meters, 100), 1);
  within_geofence_value := distance_value <= allowed_radius;

  UPDATE public.attendance_records record
  SET check_out_at = clock_timestamp(),
      check_out_lat = p_latitude,
      check_out_lng = p_longitude,
      check_out_accuracy_meters = p_accuracy_meters,
      check_out_device = left(p_device_label, 500),
      device_fingerprint = COALESCE(left(p_device_signal, 500), record.device_fingerprint),
      check_out_within_geofence = within_geofence_value,
      check_out_distance_meters = ROUND(distance_value)::integer,
      total_minutes = GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (clock_timestamp() - record.check_in_at)) / 60)::integer),
      check_out_request_id = p_request_id,
      updated_at = clock_timestamp()
  WHERE record.id = attendance_record.id
  RETURNING record.* INTO attendance_record;

  event_payload := jsonb_build_object(
    'attendance_id', attendance_record.id,
    'employee_id', attendance_record.employee_id,
    'work_date', attendance_record.work_date,
    'check_out_at', attendance_record.check_out_at,
    'total_minutes', attendance_record.total_minutes,
    'within_geofence', attendance_record.check_out_within_geofence
  );
  INSERT INTO public.business_events (
    org_id, source_type, business_key, payload, payload_hash, status,
    request_id, actor_user_id, occurred_at, processed_at
  ) VALUES (
    p_org_id,
    'attendance.check_out',
    attendance_record.id::text,
    event_payload,
    encode(digest(event_payload::text, 'sha256'), 'hex'),
    'completed',
    p_request_id,
    p_user_id,
    attendance_record.check_out_at,
    clock_timestamp()
  ) ON CONFLICT (org_id, source_type, business_key) DO NOTHING;

  RETURN NEXT attendance_record;
  RETURN;
END;
$$;

-- Browser clients retain scoped read access but cannot author authoritative
-- attendance rows. Only the service-role RPCs above may mutate them.
DROP POLICY IF EXISTS attendance_records_insert ON public.attendance_records;
DROP POLICY IF EXISTS attendance_records_update ON public.attendance_records;
DROP POLICY IF EXISTS attendance_records_delete ON public.attendance_records;
DROP POLICY IF EXISTS attendance_self_insert ON public.attendance_records;
DROP POLICY IF EXISTS attendance_self_update ON public.attendance_records;

REVOKE ALL ON FUNCTION public.attendance_check_in(uuid, uuid, uuid, numeric, numeric, numeric, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_check_in(uuid, uuid, uuid, numeric, numeric, numeric, text, text, text)
  TO service_role;
REVOKE ALL ON FUNCTION public.attendance_check_out(uuid, uuid, uuid, uuid, numeric, numeric, numeric, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_check_out(uuid, uuid, uuid, uuid, numeric, numeric, numeric, text, text)
  TO service_role;
