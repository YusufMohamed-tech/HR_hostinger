-- Multi-tenancy audit fixes: tenant isolation hardening from docs/audit.md Phase 1.
-- Safe forward migration: no schema reset and no table drops.

-- Make tenant resolution deterministic for the current single-org-per-user model.
CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT org_id
  FROM public.org_members
  WHERE user_id = auth.uid()
  ORDER BY created_at ASC, id ASC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role::text
  FROM public.org_members
  WHERE user_id = auth.uid()
    AND org_id = public.current_org_id()
  ORDER BY created_at ASC, id ASC
  LIMIT 1;
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
      SELECT role IN ('admin', 'super_admin')
      FROM public.org_members
      WHERE user_id = auth.uid()
        AND org_id = public.current_org_id()
      ORDER BY created_at ASC, id ASC
      LIMIT 1
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.current_employee_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id
  FROM public.employees
  WHERE user_id = auth.uid()
    AND org_id = public.current_org_id()
  ORDER BY created_at ASC, id ASC
  LIMIT 1;
$$;

-- employee_locations lacked direct tenant scope; backfill and enforce org_id.
ALTER TABLE public.employee_locations
  ADD COLUMN IF NOT EXISTS org_id uuid;

UPDATE public.employee_locations el
SET org_id = e.org_id
FROM public.employees e
WHERE el.employee_id = e.id
  AND el.org_id IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.employee_locations WHERE org_id IS NULL) THEN
    RAISE EXCEPTION 'Cannot set employee_locations.org_id NOT NULL while unscoped rows remain.';
  END IF;
END $$;

ALTER TABLE public.employee_locations
  ALTER COLUMN org_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'employee_locations_org_id_fkey'
      AND conrelid = 'public.employee_locations'::regclass
  ) THEN
    ALTER TABLE public.employee_locations
      ADD CONSTRAINT employee_locations_org_id_fkey
      FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_employee_locations_org_employee
  ON public.employee_locations(org_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_locations_org_location
  ON public.employee_locations(org_id, location_id);

DROP POLICY IF EXISTS employee_locations_select ON public.employee_locations;
CREATE POLICY employee_locations_select ON public.employee_locations
  FOR SELECT
  USING (org_id = public.current_org_id());

DROP POLICY IF EXISTS employee_locations_insert ON public.employee_locations;
CREATE POLICY employee_locations_insert ON public.employee_locations
  FOR INSERT
  WITH CHECK (
    public.is_admin()
    AND org_id = public.current_org_id()
    AND EXISTS (
      SELECT 1
      FROM public.employees e
      WHERE e.id = employee_locations.employee_id
        AND e.org_id = employee_locations.org_id
    )
    AND EXISTS (
      SELECT 1
      FROM public.locations l
      WHERE l.id = employee_locations.location_id
        AND l.org_id = employee_locations.org_id
    )
  );

DROP POLICY IF EXISTS employee_locations_update ON public.employee_locations;
CREATE POLICY employee_locations_update ON public.employee_locations
  FOR UPDATE
  USING (public.is_admin() AND org_id = public.current_org_id())
  WITH CHECK (
    public.is_admin()
    AND org_id = public.current_org_id()
    AND EXISTS (
      SELECT 1
      FROM public.employees e
      WHERE e.id = employee_locations.employee_id
        AND e.org_id = employee_locations.org_id
    )
    AND EXISTS (
      SELECT 1
      FROM public.locations l
      WHERE l.id = employee_locations.location_id
        AND l.org_id = employee_locations.org_id
    )
  );

DROP POLICY IF EXISTS employee_locations_delete ON public.employee_locations;
CREATE POLICY employee_locations_delete ON public.employee_locations
  FOR DELETE
  USING (public.is_admin() AND org_id = public.current_org_id());

-- Fix cross-org profile visibility for organization admins.
DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR auth.role() = 'service_role'
    OR (org_id = public.current_org_id() AND public.is_admin())
  );

DROP POLICY IF EXISTS profiles_update ON public.profiles;
CREATE POLICY profiles_update ON public.profiles
  FOR UPDATE
  USING (
    user_id = auth.uid()
    OR auth.role() = 'service_role'
    OR (org_id = public.current_org_id() AND public.is_admin())
  )
  WITH CHECK (
    user_id = auth.uid()
    OR auth.role() = 'service_role'
    OR (org_id = public.current_org_id() AND public.is_admin())
  );

-- Chat RLS should require both participant access and tenant scope.
DROP POLICY IF EXISTS chat_conversations_member_select ON public.chat_conversations;
CREATE POLICY chat_conversations_member_select ON public.chat_conversations
  FOR SELECT
  USING (
    org_id = public.current_org_id()
    AND EXISTS (
      SELECT 1
      FROM public.chat_participants cp
      WHERE cp.conversation_id = chat_conversations.id
        AND cp.org_id = chat_conversations.org_id
        AND cp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS chat_participants_member_select ON public.chat_participants;
CREATE POLICY chat_participants_member_select ON public.chat_participants
  FOR SELECT
  USING (
    org_id = public.current_org_id()
    AND EXISTS (
      SELECT 1
      FROM public.chat_participants cp
      WHERE cp.conversation_id = chat_participants.conversation_id
        AND cp.org_id = chat_participants.org_id
        AND cp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS chat_messages_member_select ON public.chat_messages;
CREATE POLICY chat_messages_member_select ON public.chat_messages
  FOR SELECT
  USING (
    org_id = public.current_org_id()
    AND EXISTS (
      SELECT 1
      FROM public.chat_participants cp
      WHERE cp.conversation_id = chat_messages.conversation_id
        AND cp.org_id = chat_messages.org_id
        AND cp.user_id = auth.uid()
    )
  );

-- Storage buckets are private; access is granted by tenant-scoped object path.
INSERT INTO storage.buckets (id, name, public)
VALUES
  ('task-attachments', 'task-attachments', false),
  ('chat-attachments', 'chat-attachments', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS task_attachments_select ON storage.objects;
CREATE POLICY task_attachments_select ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'task-attachments'
    AND (
      auth.role() = 'service_role'
      OR (storage.foldername(name))[1] = public.current_org_id()::text
      OR EXISTS (
        SELECT 1
        FROM public.tasks t
        WHERE t.id::text = (storage.foldername(name))[1]
          AND t.org_id = public.current_org_id()
      )
    )
  );

DROP POLICY IF EXISTS task_attachments_insert ON storage.objects;
CREATE POLICY task_attachments_insert ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'task-attachments'
    AND (
      auth.role() = 'service_role'
      OR (storage.foldername(name))[1] = public.current_org_id()::text
    )
  );

DROP POLICY IF EXISTS task_attachments_update ON storage.objects;
CREATE POLICY task_attachments_update ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'task-attachments'
    AND (
      auth.role() = 'service_role'
      OR (storage.foldername(name))[1] = public.current_org_id()::text
      OR EXISTS (
        SELECT 1
        FROM public.tasks t
        WHERE t.id::text = (storage.foldername(name))[1]
          AND t.org_id = public.current_org_id()
      )
    )
  )
  WITH CHECK (
    bucket_id = 'task-attachments'
    AND (
      auth.role() = 'service_role'
      OR (storage.foldername(name))[1] = public.current_org_id()::text
    )
  );

DROP POLICY IF EXISTS task_attachments_delete ON storage.objects;
CREATE POLICY task_attachments_delete ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'task-attachments'
    AND (
      auth.role() = 'service_role'
      OR (storage.foldername(name))[1] = public.current_org_id()::text
    )
  );

DROP POLICY IF EXISTS chat_attachments_select ON storage.objects;
CREATE POLICY chat_attachments_select ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'chat-attachments'
    AND (
      auth.role() = 'service_role'
      OR (storage.foldername(name))[1] = public.current_org_id()::text
    )
  );

DROP POLICY IF EXISTS chat_attachments_insert ON storage.objects;
CREATE POLICY chat_attachments_insert ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'chat-attachments'
    AND (
      auth.role() = 'service_role'
      OR (storage.foldername(name))[1] = public.current_org_id()::text
    )
  );

DROP POLICY IF EXISTS chat_attachments_update ON storage.objects;
CREATE POLICY chat_attachments_update ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'chat-attachments'
    AND (
      auth.role() = 'service_role'
      OR (storage.foldername(name))[1] = public.current_org_id()::text
    )
  )
  WITH CHECK (
    bucket_id = 'chat-attachments'
    AND (
      auth.role() = 'service_role'
      OR (storage.foldername(name))[1] = public.current_org_id()::text
    )
  );

DROP POLICY IF EXISTS chat_attachments_delete ON storage.objects;
CREATE POLICY chat_attachments_delete ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'chat-attachments'
    AND (
      auth.role() = 'service_role'
      OR (storage.foldername(name))[1] = public.current_org_id()::text
    )
  );

-- Workspace audit logs should be insertable by service role or by admins for their own org.
DROP POLICY IF EXISTS audit_logs_insert ON public.audit_logs;
CREATE POLICY audit_logs_insert ON public.audit_logs
  FOR INSERT
  WITH CHECK (
    auth.role() = 'service_role'
    OR (public.is_admin() AND org_id = public.current_org_id())
  );
