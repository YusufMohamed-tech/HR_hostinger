-- Platform control-plane identity and audit logging.

DO $$
BEGIN
  CREATE TYPE public.platform_role AS ENUM ('superadmin');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.platform_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.platform_role NOT NULL DEFAULT 'superadmin',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_admins_user_status
  ON public.platform_admins(user_id, status);

CREATE TABLE IF NOT EXISTS public.platform_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_role text NOT NULL DEFAULT 'superadmin',
  action text NOT NULL,
  target_org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  target_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  target_type text,
  target_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_audit_logs_actor_created
  ON public.platform_audit_logs(actor_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_platform_audit_logs_org_created
  ON public.platform_audit_logs(target_org_id, created_at DESC);

INSERT INTO public.platform_admins (user_id, role, status)
SELECT DISTINCT user_id, 'superadmin'::public.platform_role, 'active'
FROM public.org_members
WHERE role::text = 'super_admin'
ON CONFLICT (user_id) DO UPDATE
SET role = EXCLUDED.role,
    status = CASE
      WHEN public.platform_admins.status = 'suspended' THEN public.platform_admins.status
      ELSE EXCLUDED.status
    END,
    updated_at = now();

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Platform admins can read their own platform account" ON public.platform_admins;
CREATE POLICY "Platform admins can read their own platform account"
  ON public.platform_admins
  FOR SELECT
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT status = 'active' AND role::text = 'superadmin'
      FROM public.platform_admins
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

CREATE OR REPLACE FUNCTION public.can_manage_recruitment()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT role::text IN ('admin', 'hr_recruitment')
      FROM public.org_members
      WHERE user_id = auth.uid()
      LIMIT 1
    ),
    false
  );
$$;

DROP POLICY IF EXISTS "Platform admins can read platform audit logs" ON public.platform_audit_logs;
CREATE POLICY "Platform admins can read platform audit logs"
  ON public.platform_audit_logs
  FOR SELECT
  USING (public.is_super_admin());
