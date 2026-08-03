-- Banking Module
-- Supports bank account management, statement import, transaction matching, and reconciliation

-- Bank Accounts
CREATE TABLE IF NOT EXISTS banking_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name_ar text NOT NULL,
  name_en text,
  bank_name text NOT NULL,
  account_number text NOT NULL,
  iban text,
  swift_code text,
  currency text NOT NULL DEFAULT 'SAR',
  linked_account_id uuid REFERENCES accounting_accounts(id),
  opening_balance numeric(18,2) NOT NULL DEFAULT 0,
  opening_balance_date date,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  UNIQUE(organization_id, account_number)
);

ALTER TABLE banking_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation_banking_accounts"
  ON banking_accounts FOR ALL
  USING (organization_id = (current_setting('app.current_org_id', true))::uuid);

-- Bank Statements (imported files)
CREATE TABLE IF NOT EXISTS banking_statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  bank_account_id uuid NOT NULL REFERENCES banking_accounts(id) ON DELETE CASCADE,
  statement_date date NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  opening_balance numeric(18,2) NOT NULL DEFAULT 0,
  closing_balance numeric(18,2) NOT NULL DEFAULT 0,
  file_path text,
  file_name text,
  import_format text NOT NULL DEFAULT 'csv',
  imported_at timestamptz NOT NULL DEFAULT now(),
  imported_by uuid REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'imported'
    CHECK (status IN ('imported', 'in_progress', 'reconciled')),
  transaction_count integer NOT NULL DEFAULT 0,
  matched_count integer NOT NULL DEFAULT 0,
  UNIQUE(organization_id, bank_account_id, statement_date)
);

ALTER TABLE banking_statements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation_banking_statements"
  ON banking_statements FOR ALL
  USING (organization_id = (current_setting('app.current_org_id', true))::uuid);

-- Bank Statement Lines (individual transactions)
CREATE TABLE IF NOT EXISTS banking_statement_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  statement_id uuid NOT NULL REFERENCES banking_statements(id) ON DELETE CASCADE,
  transaction_date date NOT NULL,
  value_date date,
  description text NOT NULL,
  reference text,
  amount numeric(18,2) NOT NULL,
  running_balance numeric(18,2),
  transaction_type text,
  payee text,
  match_status text NOT NULL DEFAULT 'unmatched'
    CHECK (match_status IN ('unmatched', 'matched', 'manually_matched', 'excluded')),
  matched_journal_line_id uuid REFERENCES accounting_journal_lines(id),
  matched_at timestamptz,
  matched_by uuid REFERENCES auth.users(id),
  match_confidence numeric(3,2),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE banking_statement_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation_banking_statement_lines"
  ON banking_statement_lines FOR ALL
  USING (organization_id = (current_setting('app.current_org_id', true))::uuid);

CREATE INDEX IF NOT EXISTS idx_banking_lines_statement
  ON banking_statement_lines(statement_id);

CREATE INDEX IF NOT EXISTS idx_banking_lines_match
  ON banking_statement_lines(match_status);

CREATE INDEX IF NOT EXISTS idx_banking_lines_date
  ON banking_statement_lines(organization_id, transaction_date);

-- Reconciliation Sessions
CREATE TABLE IF NOT EXISTS banking_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  bank_account_id uuid NOT NULL REFERENCES banking_accounts(id),
  statement_id uuid REFERENCES banking_statements(id),
  reconciliation_date date NOT NULL,
  statement_balance numeric(18,2) NOT NULL DEFAULT 0,
  ledger_balance numeric(18,2) NOT NULL DEFAULT 0,
  difference numeric(18,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'completed', 'approved')),
  completed_at timestamptz,
  completed_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  approved_by uuid REFERENCES auth.users(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE banking_reconciliations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation_banking_reconciliations"
  ON banking_reconciliations FOR ALL
  USING (organization_id = (current_setting('app.current_org_id', true))::uuid);
