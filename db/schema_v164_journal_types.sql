-- Configurable Journal/Ledger Types
-- Each type has its own prefix, number format, and independent sequence

CREATE TABLE IF NOT EXISTS accounting_journal_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name_ar text NOT NULL,
  name_en text,
  description text,
  prefix text NOT NULL,
  number_format text NOT NULL DEFAULT '{PREFIX}-{YYYY}{MM}-{SEQ}',
  sequence_reset text NOT NULL DEFAULT 'monthly'
    CHECK (sequence_reset IN ('never', 'yearly', 'monthly')),
  current_sequence integer NOT NULL DEFAULT 0,
  sequence_year integer,
  sequence_month integer,
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  allowed_roles text[] DEFAULT '{}',
  requires_approval boolean NOT NULL DEFAULT false,
  auto_post boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, code)
);

ALTER TABLE accounting_journal_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation_accounting_journal_types"
  ON accounting_journal_types FOR ALL
  USING (organization_id = (current_setting('app.current_org_id', true))::uuid);

-- Link journal entries to their type
ALTER TABLE accounting_journal_entries
  ADD COLUMN IF NOT EXISTS journal_type_id uuid REFERENCES accounting_journal_types(id);

-- Function to generate next journal number for a given type
CREATE OR REPLACE FUNCTION accounting_next_journal_number(
  p_org_id uuid,
  p_type_id uuid,
  p_date date DEFAULT CURRENT_DATE
) RETURNS text AS $$
DECLARE
  v_type accounting_journal_types%ROWTYPE;
  v_seq integer;
  v_result text;
  v_year integer := EXTRACT(YEAR FROM p_date);
  v_month integer := EXTRACT(MONTH FROM p_date);
BEGIN
  SELECT * INTO v_type FROM accounting_journal_types
    WHERE id = p_type_id AND organization_id = p_org_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journal type not found';
  END IF;

  IF v_type.sequence_reset = 'monthly' AND
     (v_type.sequence_year IS DISTINCT FROM v_year OR
      v_type.sequence_month IS DISTINCT FROM v_month) THEN
    v_seq := 1;
    UPDATE accounting_journal_types SET
      current_sequence = 1, sequence_year = v_year, sequence_month = v_month,
      updated_at = now()
    WHERE id = p_type_id;
  ELSIF v_type.sequence_reset = 'yearly' AND
        v_type.sequence_year IS DISTINCT FROM v_year THEN
    v_seq := 1;
    UPDATE accounting_journal_types SET
      current_sequence = 1, sequence_year = v_year, sequence_month = v_month,
      updated_at = now()
    WHERE id = p_type_id;
  ELSE
    v_seq := v_type.current_sequence + 1;
    UPDATE accounting_journal_types SET
      current_sequence = v_seq, updated_at = now()
    WHERE id = p_type_id;
  END IF;

  v_result := v_type.number_format;
  v_result := REPLACE(v_result, '{PREFIX}', v_type.prefix);
  v_result := REPLACE(v_result, '{YYYY}', LPAD(v_year::text, 4, '0'));
  v_result := REPLACE(v_result, '{YY}', LPAD((v_year % 100)::text, 2, '0'));
  v_result := REPLACE(v_result, '{MM}', LPAD(v_month::text, 2, '0'));
  v_result := REPLACE(v_result, '{DD}', LPAD(EXTRACT(DAY FROM p_date)::text, 2, '0'));
  v_result := REPLACE(v_result, '{SEQ}', LPAD(v_seq::text, 4, '0'));

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;
