-- Journal Entry Attachments
-- Allows users to attach supporting documents to journal entries

CREATE TABLE IF NOT EXISTS accounting_journal_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  journal_entry_id uuid NOT NULL REFERENCES accounting_journal_entries(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_path text NOT NULL,
  file_size integer NOT NULL,
  mime_type text NOT NULL,
  description text,
  uploaded_by uuid NOT NULL REFERENCES auth.users(id),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  checksum_sha256 text
);

ALTER TABLE accounting_journal_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation_accounting_journal_attachments"
  ON accounting_journal_attachments FOR ALL
  USING (organization_id = (current_setting('app.current_org_id', true))::uuid);

CREATE INDEX IF NOT EXISTS idx_journal_attachments_entry
  ON accounting_journal_attachments(journal_entry_id);

CREATE INDEX IF NOT EXISTS idx_journal_attachments_org
  ON accounting_journal_attachments(organization_id);
