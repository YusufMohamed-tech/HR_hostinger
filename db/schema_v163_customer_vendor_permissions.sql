-- Granular permissions for Customer & Vendor management
-- Allows orgs to configure which roles can create/edit/delete customers and vendors

CREATE TABLE IF NOT EXISTS accounting_role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role text NOT NULL,
  permission text NOT NULL,
  granted_by uuid REFERENCES auth.users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, role, permission)
);

ALTER TABLE accounting_role_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation_accounting_role_permissions"
  ON accounting_role_permissions FOR ALL
  USING (organization_id = (current_setting('app.current_org_id', true))::uuid);

CREATE INDEX IF NOT EXISTS idx_accounting_role_permissions_org_role
  ON accounting_role_permissions(organization_id, role);
