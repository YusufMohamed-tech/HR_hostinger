-- Migration v138: Supervisor Module
-- Adds supervisor role, site evaluation checklists, and evaluation tracking.
-- Supervisors are assigned to locations, check in/out with GPS (reusing attendance_records),
-- and must complete a site evaluation checklist on check-out.

-- 1. Add supervisor role
ALTER TYPE public.org_role ADD VALUE IF NOT EXISTS 'supervisor';

-- 2. Site checklist templates (HR configures what supervisors evaluate)
CREATE TABLE IF NOT EXISTS site_checklist_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  items JSONB NOT NULL DEFAULT '[]',
  -- items schema: [{ "id": "uuid", "label": "string", "type": "boolean|rating|text", "required": bool, "order": int }]
  location_type public.location_type,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_checklist_templates_org ON site_checklist_templates(org_id, is_active);

-- 3. Site evaluations (supervisor submits on check-out)
CREATE TABLE IF NOT EXISTS site_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  supervisor_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  attendance_record_id UUID REFERENCES attendance_records(id) ON DELETE SET NULL,
  template_id UUID REFERENCES site_checklist_templates(id) ON DELETE SET NULL,

  -- Checklist responses
  responses JSONB NOT NULL DEFAULT '[]',
  -- responses schema: [{ "item_id": "uuid", "label": "string", "value": "bool|number|string", "notes": "string" }]

  -- Overall evaluation
  overall_score NUMERIC(3,1),
  comment TEXT,

  -- Status workflow
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('draft', 'submitted', 'reviewed', 'flagged')),
  reviewed_by UUID REFERENCES employees(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  reviewer_notes TEXT,

  -- Timestamps
  evaluation_date DATE NOT NULL,
  submitted_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_site_evaluations_supervisor ON site_evaluations(supervisor_id, evaluation_date DESC);
CREATE INDEX idx_site_evaluations_location ON site_evaluations(location_id, evaluation_date DESC);
CREATE INDEX idx_site_evaluations_org_status ON site_evaluations(org_id, status);
CREATE INDEX idx_site_evaluations_attendance ON site_evaluations(attendance_record_id);

-- 4. Evaluation attachments (photos, files)
CREATE TABLE IF NOT EXISTS site_evaluation_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  evaluation_id UUID NOT NULL REFERENCES site_evaluations(id) ON DELETE CASCADE,
  file_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER,
  uploaded_by UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_eval_attachments_evaluation ON site_evaluation_attachments(evaluation_id);

-- 5. Row Level Security
ALTER TABLE site_checklist_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_evaluation_attachments ENABLE ROW LEVEL SECURITY;

-- RLS Policies for site_checklist_templates
CREATE POLICY "org_members_read_templates" ON site_checklist_templates
  FOR SELECT USING (
    org_id IN (SELECT om.org_id FROM org_members om WHERE om.user_id = auth.uid())
  );

CREATE POLICY "admins_manage_templates" ON site_checklist_templates
  FOR ALL USING (
    org_id IN (
      SELECT om.org_id FROM org_members om
      WHERE om.user_id = auth.uid()
        AND om.role IN ('admin', 'hr_admin')
    )
  );

-- RLS Policies for site_evaluations
CREATE POLICY "supervisor_read_own_evaluations" ON site_evaluations
  FOR SELECT USING (
    supervisor_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
    OR org_id IN (
      SELECT om.org_id FROM org_members om
      WHERE om.user_id = auth.uid()
        AND om.role IN ('admin', 'hr_admin', 'supervisor')
    )
  );

CREATE POLICY "supervisor_insert_evaluations" ON site_evaluations
  FOR INSERT WITH CHECK (
    supervisor_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
  );

CREATE POLICY "admins_manage_evaluations" ON site_evaluations
  FOR ALL USING (
    org_id IN (
      SELECT om.org_id FROM org_members om
      WHERE om.user_id = auth.uid()
        AND om.role IN ('admin', 'hr_admin')
    )
  );

-- RLS Policies for site_evaluation_attachments
CREATE POLICY "evaluation_attachments_read" ON site_evaluation_attachments
  FOR SELECT USING (
    org_id IN (SELECT om.org_id FROM org_members om WHERE om.user_id = auth.uid())
  );

CREATE POLICY "evaluation_attachments_insert" ON site_evaluation_attachments
  FOR INSERT WITH CHECK (
    uploaded_by IN (SELECT id FROM employees WHERE user_id = auth.uid())
  );

CREATE POLICY "admins_manage_attachments" ON site_evaluation_attachments
  FOR ALL USING (
    org_id IN (
      SELECT om.org_id FROM org_members om
      WHERE om.user_id = auth.uid()
        AND om.role IN ('admin', 'hr_admin')
    )
  );

-- 6. Updated_at trigger for site_evaluations
CREATE OR REPLACE FUNCTION update_site_evaluation_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_site_evaluations_updated_at
  BEFORE UPDATE ON site_evaluations
  FOR EACH ROW EXECUTE FUNCTION update_site_evaluation_timestamp();

CREATE TRIGGER trg_checklist_templates_updated_at
  BEFORE UPDATE ON site_checklist_templates
  FOR EACH ROW EXECUTE FUNCTION update_site_evaluation_timestamp();
