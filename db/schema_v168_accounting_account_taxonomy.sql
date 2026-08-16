-- Enforce account type/subtype taxonomy for new or reclassified accounts while
-- grandfathering untouched legacy classifications during descriptive updates.

CREATE OR REPLACE FUNCTION public.accounting_validate_account_classification()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  normalized_type text := lower(btrim(COALESCE(NEW.type, '')));
  normalized_subtype text := NULLIF(lower(btrim(COALESCE(NEW.subtype, ''))), '');
  previous_type text;
  previous_subtype text;
  classification_changed boolean := true;
  valid_pair boolean := false;
BEGIN
  -- A system account cannot be downgraded first and reclassified in a second
  -- statement. Legitimate system promotion remains available to seed flows.
  IF TG_OP = 'UPDATE' AND OLD.is_system AND NOT NEW.is_system THEN
    RAISE EXCEPTION 'System account classification protection cannot be removed.'
      USING ERRCODE = '55000';
  END IF;

  -- v107 writes every account column on PATCH. Preserve an unknown legacy pair
  -- byte-for-byte when neither classification field actually changed.
  IF TG_OP = 'UPDATE'
     AND NEW.type IS NOT DISTINCT FROM OLD.type
     AND NEW.subtype IS NOT DISTINCT FROM OLD.subtype THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    previous_type := lower(btrim(COALESCE(OLD.type, '')));
    previous_subtype := NULLIF(lower(btrim(COALESCE(OLD.subtype, ''))), '');
    classification_changed := normalized_type IS DISTINCT FROM previous_type
      OR normalized_subtype IS DISTINCT FROM previous_subtype;
  END IF;

  NEW.type := normalized_type;
  NEW.subtype := normalized_subtype;

  IF TG_OP = 'UPDATE' AND classification_changed THEN
    IF OLD.is_system OR NEW.is_system THEN
      RAISE EXCEPTION 'System account classification cannot be changed.'
        USING ERRCODE = '55000';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.accounting_journal_lines line
      WHERE line.account_id = OLD.id
    ) THEN
      RAISE EXCEPTION 'An account used by journals cannot change type or subtype.'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  -- A NULL subtype remains valid for compatibility. Every non-null value must
  -- be canonical or one of the known values seeded by earlier migrations.
  valid_pair := CASE normalized_type
    WHEN 'asset' THEN normalized_subtype IS NULL OR normalized_subtype = ANY (ARRAY[
      'cash', 'bank', 'receivable', 'related_party_receivable', 'inventory',
      'prepaid', 'current_asset', 'fixed_asset', 'other_asset',
      'employee_advances', 'fixed_assets', 'accumulated_depreciation', 'vat_receivable'
    ]::text[])
    WHEN 'liability' THEN normalized_subtype IS NULL OR normalized_subtype = ANY (ARRAY[
      'payable', 'related_party_payable', 'accrual', 'tax_payable',
      'current_liability', 'long_term_liability', 'other_liability',
      'accrued', 'accrued_expenses', 'salary_payable', 'commission_payable',
      'eos_provision', 'vat_payable'
    ]::text[])
    WHEN 'equity' THEN normalized_subtype IS NULL OR normalized_subtype = ANY (ARRAY[
      'capital', 'retained_earnings', 'reserves', 'current_year_result'
    ]::text[])
    WHEN 'revenue' THEN normalized_subtype IS NULL OR normalized_subtype = ANY (ARRAY[
      'sales_revenue', 'commission_revenue', 'service_revenue', 'other_income',
      'operating_revenue', 'sales', 'services'
    ]::text[])
    WHEN 'expense' THEN normalized_subtype IS NULL OR normalized_subtype = ANY (ARRAY[
      'cost_of_revenue', 'operating_expense', 'depreciation_expense',
      'finance_cost', 'other_expense', 'payroll', 'salary_expense', 'salaries',
      'bonuses', 'commissions', 'social_insurance', 'rent', 'utilities', 'telecom',
      'recruitment', 'training', 'travel', 'office_supplies', 'depreciation',
      'cost_of_sales'
    ]::text[])
    ELSE false
  END;

  IF valid_pair IS NOT TRUE THEN
    RAISE EXCEPTION 'Account subtype is not valid for the selected account type.'
      USING ERRCODE = '23514',
            CONSTRAINT = 'accounting_accounts_type_subtype_taxonomy';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_accounting_accounts_validate_classification
  ON public.accounting_accounts;
CREATE TRIGGER trg_accounting_accounts_validate_classification
  BEFORE INSERT OR UPDATE ON public.accounting_accounts
  FOR EACH ROW EXECUTE FUNCTION public.accounting_validate_account_classification();

COMMENT ON FUNCTION public.accounting_validate_account_classification() IS
  'Normalizes and validates changed account type/subtype classifications while preserving untouched legacy pairs.';
