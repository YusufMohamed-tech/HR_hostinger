-- Superadmin role and recruitment scope separation.

ALTER TYPE public.org_role ADD VALUE IF NOT EXISTS 'super_admin';

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT role::text = 'super_admin'
      FROM public.org_members
      WHERE user_id = auth.uid()
      LIMIT 1
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT role::text IN ('super_admin', 'admin', 'hr_admin')
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

CREATE OR REPLACE FUNCTION public.can_manage_recruitment()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT role::text IN ('super_admin', 'admin', 'hr_recruitment')
      FROM public.org_members
      WHERE user_id = auth.uid()
      LIMIT 1
    ),
    false
  );
$$;
