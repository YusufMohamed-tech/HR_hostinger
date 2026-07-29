-- Preserve employee-master command versioning when HR saves unchanged profile
-- fields (for example, when the actual requested change is a password reset).
--
-- Onboarding rollup-only updates remain derived metadata and must not create
-- optimistic-lock conflicts. Every other accepted employee write, including a
-- no-op master-data save, receives a fresh lifecycle version so its durable
-- business-event key cannot collide with an earlier save.

CREATE OR REPLACE FUNCTION public.bump_employee_lifecycle_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (
    to_jsonb(NEW) - ARRAY[
      'lifecycle_version', 'updated_at',
      'onboarding_status', 'onboarding_progress', 'onboarding_due_at'
    ]
  ) IS DISTINCT FROM (
    to_jsonb(OLD) - ARRAY[
      'lifecycle_version', 'updated_at',
      'onboarding_status', 'onboarding_progress', 'onboarding_due_at'
    ]
  )
  OR ROW(
    NEW.onboarding_status, NEW.onboarding_progress, NEW.onboarding_due_at
  ) IS NOT DISTINCT FROM ROW(
    OLD.onboarding_status, OLD.onboarding_progress, OLD.onboarding_due_at
  ) THEN
    IF NEW.lifecycle_version = OLD.lifecycle_version THEN
      NEW.lifecycle_version := OLD.lifecycle_version + 1;
    END IF;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

