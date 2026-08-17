-- Phase 1: Identity status hardening and permissions enforcement.
-- Fixes case-sensitive account_status checks, adds user access diagnostics,
-- and locks down permission management to authorized roles only.

------------------------------------------------------------
-- 1. Diagnostic function for admin troubleshooting
------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.accounting_diagnose_user_access(
  p_organization_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_profile_status text;
  v_member_role text;
  v_scope_count integer;
  v_entity_ids uuid[];
BEGIN
  -- Get profile status
  SELECT lower(btrim(coalesce(account_status, '')))
  INTO v_profile_status
  FROM profiles WHERE user_id = p_user_id;

  -- Get org membership role
  SELECT role INTO v_member_role
  FROM org_members
  WHERE user_id = p_user_id AND org_id = p_organization_id;

  -- Get active entity scopes
  SELECT count(*), array_agg(legal_entity_id)
  INTO v_scope_count, v_entity_ids
  FROM accounting_user_scopes
  WHERE user_id = p_user_id
    AND organization_id = p_organization_id
    AND is_active = true
    AND (effective_from IS NULL OR effective_from <= CURRENT_DATE)
    AND (effective_to IS NULL OR effective_to >= CURRENT_DATE);

  SELECT jsonb_build_object(
    'auth_user_exists', EXISTS(SELECT 1 FROM auth.users WHERE id = p_user_id),
    'profile_exists', v_profile_status IS NOT NULL,
    'account_status', v_profile_status,
    'account_status_valid', v_profile_status = 'active',
    'org_member_exists', v_member_role IS NOT NULL,
    'member_role', coalesce(v_member_role, 'none'),
    'is_finance_role', v_member_role IN ('finance_manager', 'accountant', 'finance_viewer'),
    'entity_scopes_count', coalesce(v_scope_count, 0),
    'entity_ids', coalesce(to_jsonb(v_entity_ids), '[]'::jsonb),
    'has_default_entity', EXISTS(
      SELECT 1 FROM accounting_legal_entities
      WHERE organization_id = p_organization_id AND is_default = true AND status = 'active'
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

------------------------------------------------------------
-- 2. Fix any remaining case-sensitive status checks in RPCs
-- The main fix was in v167, but scan for other occurrences
------------------------------------------------------------

-- Unified status check helper
CREATE OR REPLACE FUNCTION public.accounting_is_user_active(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS(
    SELECT 1 FROM profiles
    WHERE user_id = p_user_id
      AND lower(btrim(coalesce(account_status, ''))) = 'active'
  );
END;
$$;

------------------------------------------------------------
-- 3. Permission management guard
-- Ensure only users with permissions:manage can grant/revoke
------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.accounting_check_permission_management(
  p_organization_id uuid,
  p_actor_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  SELECT role INTO v_role
  FROM org_members
  WHERE user_id = p_actor_user_id AND org_id = p_organization_id;

  -- Only finance_manager can manage permissions
  RETURN v_role = 'finance_manager';
END;
$$;

------------------------------------------------------------
-- 4. Hardened capability resolution function
------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.accounting_resolve_capabilities(
  p_organization_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_is_active boolean;
  v_capabilities jsonb;
BEGIN
  -- Check user is active
  v_is_active := accounting_is_user_active(p_user_id);
  IF NOT v_is_active THEN
    RETURN jsonb_build_object('error', 'user_inactive', 'capabilities', '[]'::jsonb);
  END IF;

  -- Get role
  SELECT role INTO v_role
  FROM org_members
  WHERE user_id = p_user_id AND org_id = p_organization_id;

  IF v_role IS NULL THEN
    RETURN jsonb_build_object('error', 'not_org_member', 'capabilities', '[]'::jsonb);
  END IF;

  -- Resolve capabilities based on role
  v_capabilities := CASE v_role
    WHEN 'finance_manager' THEN '["accounting:read","reports:export","journals:prepare","journals:post","master_data:edit_contacts","master_data:manage_coa","control_accounts:assign","party_netting:prepare","party_netting:approve","bank_statement:edit","bank_statement:recall_approved","bank_statement:archive","permissions:manage"]'::jsonb
    WHEN 'accountant' THEN '["accounting:read","reports:export","journals:prepare","master_data:edit_contacts","party_netting:prepare","bank_statement:edit"]'::jsonb
    WHEN 'finance_viewer' THEN '["accounting:read","reports:export"]'::jsonb
    ELSE '[]'::jsonb
  END;

  -- Merge with explicit grants from accounting_role_permissions
  SELECT coalesce(
    jsonb_agg(DISTINCT cap),
    '[]'::jsonb
  ) INTO v_capabilities
  FROM (
    SELECT jsonb_array_elements_text(v_capabilities) AS cap
    UNION
    SELECT permission_key FROM accounting_role_permissions
    WHERE organization_id = p_organization_id
      AND role = v_role
      AND is_granted = true
  ) combined;

  RETURN jsonb_build_object(
    'role', v_role,
    'capabilities', v_capabilities
  );
END;
$$;
