ALTER TABLE public.attendance_records
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_attendance_records_location ON public.attendance_records(location_id);
