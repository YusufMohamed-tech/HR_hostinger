-- Finance & Accounting hardening. Additive and production-safe.
-- No schema reset commands.

CREATE UNIQUE INDEX IF NOT EXISTS idx_accounting_tax_rates_default_unique
  ON public.accounting_tax_rates(organization_id, name_en, rate)
  WHERE is_default = true;

CREATE UNIQUE INDEX IF NOT EXISTS idx_accounting_journal_entries_one_reversal
  ON public.accounting_journal_entries(organization_id, reversal_of)
  WHERE reversal_of IS NOT NULL;

CREATE OR REPLACE FUNCTION public.accounting_reference_org(
  p_table regclass,
  p_id uuid,
  p_org_column text DEFAULT 'organization_id'
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result uuid;
BEGIN
  IF p_id IS NULL THEN
    RETURN NULL;
  END IF;

  EXECUTE format('SELECT %I FROM %s WHERE id = $1', p_org_column, p_table)
    INTO result
    USING p_id;

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.accounting_assert_ref_org(
  p_expected_org uuid,
  p_ref_id uuid,
  p_ref_org uuid,
  p_label text
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_ref_id IS NOT NULL AND p_ref_org IS DISTINCT FROM p_expected_org THEN
    RAISE EXCEPTION '% must belong to the same organization.', p_label;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.accounting_prevent_posted_entry_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  line_count integer;
  line_debit numeric(14,2);
  line_credit numeric(14,2);
  locked_period_name text;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'posted' THEN
    RAISE EXCEPTION 'Accounting entries must be created as draft before posting.';
  END IF;

  IF TG_OP = 'DELETE' AND OLD.status IN ('posted', 'reversed') THEN
    RAISE EXCEPTION 'Posted accounting entries cannot be deleted.';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status = 'posted' AND OLD.status IS DISTINCT FROM 'posted' THEN
    SELECT count(*)::integer, COALESCE(sum(debit), 0)::numeric(14,2), COALESCE(sum(credit), 0)::numeric(14,2)
      INTO line_count, line_debit, line_credit
    FROM public.accounting_journal_lines
    WHERE organization_id = NEW.organization_id
      AND journal_entry_id = NEW.id;

    IF line_count < 2 THEN
      RAISE EXCEPTION 'Posted accounting entries must have at least two lines.';
    END IF;

    IF line_debit <> line_credit OR line_debit <> NEW.total_debit OR line_credit <> NEW.total_credit THEN
      RAISE EXCEPTION 'Posted accounting entries must be balanced.';
    END IF;

    SELECT name INTO locked_period_name
    FROM public.accounting_periods
    WHERE organization_id = NEW.organization_id
      AND start_date <= NEW.entry_date
      AND end_date >= NEW.entry_date
      AND status IN ('closed', 'locked')
    LIMIT 1;

    IF locked_period_name IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot post into a closed or locked accounting period.';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IN ('posted', 'reversed') THEN
    IF OLD.status = 'posted'
       AND NEW.status = 'reversed'
       AND NEW.reversed_by IS NOT NULL
       AND NEW.reversed_at IS NOT NULL
       AND (to_jsonb(NEW) - 'status' - 'reversed_by' - 'reversed_at' - 'updated_at')
           = (to_jsonb(OLD) - 'status' - 'reversed_by' - 'reversed_at' - 'updated_at') THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Posted accounting entries cannot be edited directly.';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_accounting_prevent_posted_entry_insert'
  ) THEN
    CREATE TRIGGER trg_accounting_prevent_posted_entry_insert
      BEFORE INSERT ON public.accounting_journal_entries
      FOR EACH ROW EXECUTE FUNCTION public.accounting_prevent_posted_entry_mutation();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.accounting_prevent_posted_line_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  entry_status text;
BEGIN
  SELECT status INTO entry_status
  FROM public.accounting_journal_entries
  WHERE id = COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);

  IF entry_status IN ('posted', 'reversed') THEN
    RAISE EXCEPTION 'Posted accounting entry lines cannot be changed.';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_accounting_prevent_posted_line_mutation'
  ) THEN
    CREATE TRIGGER trg_accounting_prevent_posted_line_mutation
      BEFORE INSERT OR UPDATE OR DELETE ON public.accounting_journal_lines
      FOR EACH ROW EXECUTE FUNCTION public.accounting_prevent_posted_line_mutation();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.accounting_validate_same_org()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  account_org uuid;
  account_active boolean;
BEGIN
  IF TG_TABLE_NAME = 'accounting_accounts' THEN
    PERFORM public.accounting_assert_ref_org(
      NEW.organization_id,
      NEW.parent_id,
      public.accounting_reference_org('public.accounting_accounts', NEW.parent_id),
      'Parent account'
    );
  END IF;

  IF TG_TABLE_NAME = 'accounting_customers' THEN
    PERFORM public.accounting_assert_ref_org(
      NEW.organization_id,
      NEW.sales_company_id,
      public.accounting_reference_org('public.sales_companies', NEW.sales_company_id),
      'Sales company'
    );
  END IF;

  IF TG_TABLE_NAME = 'accounting_tax_rates' THEN
    PERFORM public.accounting_assert_ref_org(
      NEW.organization_id,
      NEW.tax_account_id,
      public.accounting_reference_org('public.accounting_accounts', NEW.tax_account_id),
      'Tax account'
    );
  END IF;

  IF TG_TABLE_NAME = 'accounting_journal_lines' THEN
    PERFORM public.accounting_assert_ref_org(
      NEW.organization_id,
      NEW.journal_entry_id,
      public.accounting_reference_org('public.accounting_journal_entries', NEW.journal_entry_id),
      'Journal entry'
    );

    SELECT organization_id, is_active INTO account_org, account_active
    FROM public.accounting_accounts
    WHERE id = NEW.account_id;

    PERFORM public.accounting_assert_ref_org(NEW.organization_id, NEW.account_id, account_org, 'Journal account');

    IF account_active IS FALSE THEN
      RAISE EXCEPTION 'Journal account must be active.';
    END IF;

    PERFORM public.accounting_assert_ref_org(
      NEW.organization_id,
      NEW.cost_center_id,
      public.accounting_reference_org('public.accounting_cost_centers', NEW.cost_center_id),
      'Cost center'
    );
    PERFORM public.accounting_assert_ref_org(
      NEW.organization_id,
      NEW.employee_id,
      public.accounting_reference_org('public.employees', NEW.employee_id, 'org_id'),
      'Employee'
    );
    PERFORM public.accounting_assert_ref_org(
      NEW.organization_id,
      NEW.department_id,
      public.accounting_reference_org('public.departments', NEW.department_id, 'org_id'),
      'Department'
    );
    PERFORM public.accounting_assert_ref_org(
      NEW.organization_id,
      NEW.location_id,
      public.accounting_reference_org('public.locations', NEW.location_id, 'org_id'),
      'Location'
    );
  END IF;

  IF TG_TABLE_NAME = 'accounting_invoices' THEN
    PERFORM public.accounting_assert_ref_org(
      NEW.organization_id,
      NEW.customer_id,
      public.accounting_reference_org('public.accounting_customers', NEW.customer_id),
      'Customer'
    );
  END IF;

  IF TG_TABLE_NAME = 'accounting_invoice_lines' THEN
    PERFORM public.accounting_assert_ref_org(
      NEW.organization_id,
      NEW.invoice_id,
      public.accounting_reference_org('public.accounting_invoices', NEW.invoice_id),
      'Invoice'
    );
    PERFORM public.accounting_assert_ref_org(
      NEW.organization_id,
      NEW.product_id,
      public.accounting_reference_org('public.sales_products', NEW.product_id),
      'Sales product'
    );
    PERFORM public.accounting_assert_ref_org(
      NEW.organization_id,
      NEW.tax_rate_id,
      public.accounting_reference_org('public.accounting_tax_rates', NEW.tax_rate_id),
      'Tax rate'
    );
    PERFORM public.accounting_assert_ref_org(
      NEW.organization_id,
      NEW.revenue_account_id,
      public.accounting_reference_org('public.accounting_accounts', NEW.revenue_account_id),
      'Revenue account'
    );
    PERFORM public.accounting_assert_ref_org(
      NEW.organization_id,
      NEW.cost_center_id,
      public.accounting_reference_org('public.accounting_cost_centers', NEW.cost_center_id),
      'Cost center'
    );
  END IF;

  IF TG_TABLE_NAME = 'accounting_expenses' THEN
    PERFORM public.accounting_assert_ref_org(NEW.organization_id, NEW.vendor_id, public.accounting_reference_org('public.accounting_vendors', NEW.vendor_id), 'Vendor');
    PERFORM public.accounting_assert_ref_org(NEW.organization_id, NEW.employee_id, public.accounting_reference_org('public.employees', NEW.employee_id, 'org_id'), 'Employee');
    PERFORM public.accounting_assert_ref_org(NEW.organization_id, NEW.category_account_id, public.accounting_reference_org('public.accounting_accounts', NEW.category_account_id), 'Expense account');
    PERFORM public.accounting_assert_ref_org(NEW.organization_id, NEW.payment_account_id, public.accounting_reference_org('public.accounting_accounts', NEW.payment_account_id), 'Payment account');
    PERFORM public.accounting_assert_ref_org(NEW.organization_id, NEW.cost_center_id, public.accounting_reference_org('public.accounting_cost_centers', NEW.cost_center_id), 'Cost center');
  END IF;

  IF TG_TABLE_NAME = 'accounting_payments' THEN
    PERFORM public.accounting_assert_ref_org(NEW.organization_id, NEW.account_id, public.accounting_reference_org('public.accounting_accounts', NEW.account_id), 'Payment account');
    PERFORM public.accounting_assert_ref_org(NEW.organization_id, NEW.customer_id, public.accounting_reference_org('public.accounting_customers', NEW.customer_id), 'Customer');
    PERFORM public.accounting_assert_ref_org(NEW.organization_id, NEW.vendor_id, public.accounting_reference_org('public.accounting_vendors', NEW.vendor_id), 'Vendor');
    PERFORM public.accounting_assert_ref_org(NEW.organization_id, NEW.employee_id, public.accounting_reference_org('public.employees', NEW.employee_id, 'org_id'), 'Employee');
    PERFORM public.accounting_assert_ref_org(NEW.organization_id, NEW.invoice_id, public.accounting_reference_org('public.accounting_invoices', NEW.invoice_id), 'Invoice');
    PERFORM public.accounting_assert_ref_org(NEW.organization_id, NEW.expense_id, public.accounting_reference_org('public.accounting_expenses', NEW.expense_id), 'Expense');
    PERFORM public.accounting_assert_ref_org(NEW.organization_id, NEW.advance_request_id, public.accounting_reference_org('public.advance_requests', NEW.advance_request_id), 'Advance request');
  END IF;

  IF TG_TABLE_NAME = 'accounting_settings' THEN
    PERFORM public.accounting_assert_ref_org(NEW.organization_id, NEW.default_cash_account_id, public.accounting_reference_org('public.accounting_accounts', NEW.default_cash_account_id), 'Default cash account');
    PERFORM public.accounting_assert_ref_org(NEW.organization_id, NEW.default_bank_account_id, public.accounting_reference_org('public.accounting_accounts', NEW.default_bank_account_id), 'Default bank account');
    PERFORM public.accounting_assert_ref_org(NEW.organization_id, NEW.default_accounts_receivable_id, public.accounting_reference_org('public.accounting_accounts', NEW.default_accounts_receivable_id), 'Default receivable account');
    PERFORM public.accounting_assert_ref_org(NEW.organization_id, NEW.default_accounts_payable_id, public.accounting_reference_org('public.accounting_accounts', NEW.default_accounts_payable_id), 'Default payable account');
    PERFORM public.accounting_assert_ref_org(NEW.organization_id, NEW.default_sales_revenue_id, public.accounting_reference_org('public.accounting_accounts', NEW.default_sales_revenue_id), 'Default sales account');
    PERFORM public.accounting_assert_ref_org(NEW.organization_id, NEW.default_vat_payable_id, public.accounting_reference_org('public.accounting_accounts', NEW.default_vat_payable_id), 'Default VAT payable account');
    PERFORM public.accounting_assert_ref_org(NEW.organization_id, NEW.default_vat_receivable_id, public.accounting_reference_org('public.accounting_accounts', NEW.default_vat_receivable_id), 'Default VAT receivable account');
    PERFORM public.accounting_assert_ref_org(NEW.organization_id, NEW.default_salary_expense_id, public.accounting_reference_org('public.accounting_accounts', NEW.default_salary_expense_id), 'Default salary expense account');
    PERFORM public.accounting_assert_ref_org(NEW.organization_id, NEW.default_salary_payable_id, public.accounting_reference_org('public.accounting_accounts', NEW.default_salary_payable_id), 'Default salary payable account');
    PERFORM public.accounting_assert_ref_org(NEW.organization_id, NEW.default_employee_advances_id, public.accounting_reference_org('public.accounting_accounts', NEW.default_employee_advances_id), 'Default employee advances account');
    PERFORM public.accounting_assert_ref_org(NEW.organization_id, NEW.default_asset_account_id, public.accounting_reference_org('public.accounting_accounts', NEW.default_asset_account_id), 'Default asset account');
    PERFORM public.accounting_assert_ref_org(NEW.organization_id, NEW.default_depreciation_expense_id, public.accounting_reference_org('public.accounting_accounts', NEW.default_depreciation_expense_id), 'Default depreciation expense account');
    PERFORM public.accounting_assert_ref_org(NEW.organization_id, NEW.default_accumulated_depreciation_id, public.accounting_reference_org('public.accounting_accounts', NEW.default_accumulated_depreciation_id), 'Default accumulated depreciation account');
  END IF;

  IF TG_TABLE_NAME = 'accounting_source_postings' THEN
    PERFORM public.accounting_assert_ref_org(
      NEW.organization_id,
      NEW.journal_entry_id,
      public.accounting_reference_org('public.accounting_journal_entries', NEW.journal_entry_id),
      'Source posting journal entry'
    );
  END IF;

  RETURN NEW;
END;
$$;

DO $$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT * FROM (VALUES
      ('accounting_customers', 'trg_accounting_customers_same_org'),
      ('accounting_tax_rates', 'trg_accounting_tax_rates_same_org'),
      ('accounting_invoices', 'trg_accounting_invoices_same_org'),
      ('accounting_invoice_lines', 'trg_accounting_invoice_lines_same_org'),
      ('accounting_expenses', 'trg_accounting_expenses_same_org'),
      ('accounting_payments', 'trg_accounting_payments_same_org'),
      ('accounting_settings', 'trg_accounting_settings_same_org'),
      ('accounting_source_postings', 'trg_accounting_source_postings_same_org')
    ) AS t(table_name, trigger_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgname = item.trigger_name
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.accounting_validate_same_org()',
        item.trigger_name,
        item.table_name
      );
    END IF;
  END LOOP;
END $$;
