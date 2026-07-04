-- Dedicated manager role for the on-ground SIM distribution operation.
-- This moves field-agent/merchant stock authority away from HR_Admin.

ALTER TYPE public.org_role ADD VALUE IF NOT EXISTS 'onground_agent_manager';

CREATE OR REPLACE FUNCTION public.can_manage_field_agents()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.role() = 'service_role'
    OR COALESCE(
      (
        SELECT role::text IN ('admin', 'sales_manager', 'onground_agent_manager')
        FROM public.org_members
        WHERE user_id = auth.uid()
          AND org_id = public.current_org_id()
        LIMIT 1
      ),
      false
    );
$$;
