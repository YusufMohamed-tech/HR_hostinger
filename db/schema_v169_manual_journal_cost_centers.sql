-- Require an active cost center on every manual journal line without changing
-- the nullable storage contract used by automated and reversal journals.

CREATE OR REPLACE FUNCTION public.accounting_validate_manual_journal_line_cost_center()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  entry_org_id uuid;
  entry_source_module text;
  entry_entity_id uuid;
  center_org_id uuid;
  center_entity_id uuid;
  center_is_active boolean;
BEGIN
  SELECT organization_id, source_module, legal_entity_id
    INTO entry_org_id, entry_source_module, entry_entity_id
  FROM public.accounting_journal_entries
  WHERE id = NEW.journal_entry_id;

  -- Automated postings and reversals intentionally retain optional dimensions.
  IF COALESCE(NULLIF(lower(btrim(entry_source_module)), ''), 'manual') <> 'manual' THEN
    RETURN NEW;
  END IF;

  IF NEW.cost_center_id IS NULL THEN
    RAISE EXCEPTION 'A cost center is required for every manual journal line.'
      USING ERRCODE = '23514',
            CONSTRAINT = 'accounting_manual_journal_line_cost_center_required';
  END IF;

  SELECT organization_id, legal_entity_id, is_active
    INTO center_org_id, center_entity_id, center_is_active
  FROM public.accounting_cost_centers
  WHERE id = NEW.cost_center_id
  FOR SHARE;

  IF center_org_id IS NULL
     OR center_org_id IS DISTINCT FROM NEW.organization_id
     OR center_org_id IS DISTINCT FROM entry_org_id THEN
    RAISE EXCEPTION 'The cost center must belong to the journal organization.'
      USING ERRCODE = '23514',
            CONSTRAINT = 'accounting_manual_journal_line_cost_center_organization';
  END IF;
  IF center_is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'The cost center must be active.'
      USING ERRCODE = '23514',
            CONSTRAINT = 'accounting_manual_journal_line_cost_center_active';
  END IF;
  IF entry_entity_id IS NOT NULL
     AND center_entity_id IS NOT NULL
     AND center_entity_id IS DISTINCT FROM entry_entity_id THEN
    RAISE EXCEPTION 'The cost center must belong to the journal legal entity.'
      USING ERRCODE = '23514',
            CONSTRAINT = 'accounting_manual_journal_line_cost_center_entity';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_accounting_journal_lines_manual_cost_center
  ON public.accounting_journal_lines;
CREATE TRIGGER trg_accounting_journal_lines_manual_cost_center
  BEFORE INSERT OR UPDATE ON public.accounting_journal_lines
  FOR EACH ROW EXECUTE FUNCTION public.accounting_validate_manual_journal_line_cost_center();

CREATE OR REPLACE FUNCTION public.accounting_validate_manual_journal_cost_centers_on_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  line_row public.accounting_journal_lines%ROWTYPE;
  center_row public.accounting_cost_centers%ROWTYPE;
  line_count integer := 0;
BEGIN
  IF TG_OP = 'UPDATE'
     AND COALESCE(NULLIF(lower(btrim(OLD.source_module)), ''), 'manual') = 'manual'
     AND COALESCE(NULLIF(lower(btrim(NEW.source_module)), ''), 'manual') <> 'manual' THEN
    RAISE EXCEPTION 'A manual journal source cannot be relabeled to bypass cost-center controls.'
      USING ERRCODE = '23514',
            CONSTRAINT = 'accounting_manual_journal_source_immutable';
  END IF;

  IF COALESCE(NULLIF(lower(btrim(NEW.source_module)), ''), 'manual') <> 'manual' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'A manual journal must be inserted as a draft before submission or posting.'
        USING ERRCODE = '23514',
              CONSTRAINT = 'accounting_manual_journal_initial_status';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.source_module IS NOT DISTINCT FROM OLD.source_module
     AND NEW.legal_entity_id IS NOT DISTINCT FROM OLD.legal_entity_id THEN
    RETURN NEW;
  END IF;

  FOR line_row IN
    SELECT * FROM public.accounting_journal_lines
    WHERE journal_entry_id = NEW.id
  LOOP
    line_count := line_count + 1;
    IF line_row.organization_id IS DISTINCT FROM NEW.organization_id
       OR line_row.cost_center_id IS NULL THEN
      RAISE EXCEPTION 'Every manual journal line must use an active cost center from the journal organization.'
        USING ERRCODE = '23514',
              CONSTRAINT = 'accounting_manual_journal_cost_centers_valid';
    END IF;

    SELECT * INTO center_row
    FROM public.accounting_cost_centers
    WHERE id = line_row.cost_center_id
    FOR SHARE;
    IF NOT FOUND
       OR center_row.organization_id IS DISTINCT FROM NEW.organization_id
       OR center_row.is_active IS NOT TRUE
       OR (
         NEW.legal_entity_id IS NOT NULL
         AND center_row.legal_entity_id IS NOT NULL
         AND center_row.legal_entity_id IS DISTINCT FROM NEW.legal_entity_id
       ) THEN
      RAISE EXCEPTION 'Every manual journal line must use an active cost center from the journal organization.'
        USING ERRCODE = '23514',
              CONSTRAINT = 'accounting_manual_journal_cost_centers_valid';
    END IF;
  END LOOP;

  IF line_count = 0 THEN
    RAISE EXCEPTION 'Every manual journal line must use an active cost center from the journal organization.'
      USING ERRCODE = '23514',
            CONSTRAINT = 'accounting_manual_journal_cost_centers_valid';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_accounting_journals_manual_cost_center_transition
  ON public.accounting_journal_entries;
CREATE TRIGGER trg_accounting_journals_manual_cost_center_transition
  BEFORE INSERT OR UPDATE OF status, source_module, legal_entity_id ON public.accounting_journal_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.accounting_validate_manual_journal_cost_centers_on_transition();

DO $$
DECLARE
  remediation_count bigint;
BEGIN
  SELECT count(*) INTO remediation_count
  FROM public.accounting_journal_entries entry
  WHERE COALESCE(NULLIF(lower(btrim(entry.source_module)), ''), 'manual') = 'manual'
    AND entry.status IN ('draft', 'pending_approval')
    AND (
      NOT EXISTS (
        SELECT 1 FROM public.accounting_journal_lines line
        WHERE line.journal_entry_id = entry.id
      )
      OR EXISTS (
        SELECT 1
        FROM public.accounting_journal_lines line
        LEFT JOIN public.accounting_cost_centers center ON center.id = line.cost_center_id
        WHERE line.journal_entry_id = entry.id
          AND (
            line.cost_center_id IS NULL
            OR center.is_active IS NOT TRUE
            OR center.organization_id IS DISTINCT FROM entry.organization_id
            OR (
              entry.legal_entity_id IS NOT NULL
              AND center.legal_entity_id IS NOT NULL
              AND center.legal_entity_id IS DISTINCT FROM entry.legal_entity_id
            )
          )
      )
    );
  IF remediation_count > 0 THEN
    RAISE NOTICE '% open manual journal(s) require cost-center remediation before submission or posting.', remediation_count;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.accounting_validate_manual_journal_line_cost_center() IS
  'Requires active same-organization cost centers for manual journal lines; automated and reversal journals are exempt.';
COMMENT ON FUNCTION public.accounting_validate_manual_journal_cost_centers_on_transition() IS
  'Rechecks all manual journal cost centers when source, entity, or workflow status changes.';
