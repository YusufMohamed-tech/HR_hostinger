-- Accounting completion pass: payroll, sales, and manual payment integration.
-- Safe, additive migration only. No destructive schema changes.

ALTER TABLE public.accounting_payments
  ADD COLUMN IF NOT EXISTS counterpart_account_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cost_center_id uuid REFERENCES public.accounting_cost_centers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS attachment_url text;

ALTER TABLE public.sales_products
  ADD COLUMN IF NOT EXISTS revenue_account_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL;

ALTER TABLE public.sales_companies
  ADD COLUMN IF NOT EXISTS accounting_customer_id uuid REFERENCES public.accounting_customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_accounting_payments_counterpart
  ON public.accounting_payments(organization_id, counterpart_account_id)
  WHERE counterpart_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_accounting_payments_cost_center
  ON public.accounting_payments(organization_id, cost_center_id)
  WHERE cost_center_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sales_products_revenue_account
  ON public.sales_products(organization_id, revenue_account_id)
  WHERE revenue_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sales_companies_accounting_customer
  ON public.sales_companies(organization_id, accounting_customer_id)
  WHERE accounting_customer_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.accounting_payments
    WHERE type = 'payroll_payment'
      AND status <> 'cancelled'
      AND payroll_id IS NOT NULL
    GROUP BY organization_id, payroll_id
    HAVING COUNT(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_accounting_payroll_payment_source
      ON public.accounting_payments(organization_id, payroll_id)
      WHERE type = 'payroll_payment'
        AND status <> 'cancelled'
        AND payroll_id IS NOT NULL;
  ELSE
    RAISE NOTICE 'Skipped uq_accounting_payroll_payment_source because duplicate active payroll payments already exist.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.accounting_invoices
    WHERE source_module = 'sales_log'
      AND source_id IS NOT NULL
      AND status NOT IN ('cancelled', 'void')
    GROUP BY organization_id, source_id
    HAVING COUNT(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_accounting_sales_log_invoice_source
      ON public.accounting_invoices(organization_id, source_id)
      WHERE source_module = 'sales_log'
        AND source_id IS NOT NULL
        AND status NOT IN ('cancelled', 'void');
  ELSE
    RAISE NOTICE 'Skipped uq_accounting_sales_log_invoice_source because duplicate active sales-log invoices already exist.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.accounting_customers
    WHERE sales_company_id IS NOT NULL
      AND is_active = true
    GROUP BY organization_id, sales_company_id
    HAVING COUNT(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_accounting_customer_sales_company
      ON public.accounting_customers(organization_id, sales_company_id)
      WHERE sales_company_id IS NOT NULL
        AND is_active = true;
  ELSE
    RAISE NOTICE 'Skipped uq_accounting_customer_sales_company because duplicate active customer/company links already exist.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.accounting_completion_validate_refs()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_account_type text;
BEGIN
  IF TG_TABLE_NAME = 'accounting_payments' THEN
    PERFORM public.accounting_assert_ref_org(
      NEW.organization_id,
      NEW.counterpart_account_id,
      public.accounting_reference_org('public.accounting_accounts', NEW.counterpart_account_id),
      'Counterpart account'
    );

    PERFORM public.accounting_assert_ref_org(
      NEW.organization_id,
      NEW.cost_center_id,
      public.accounting_reference_org('public.accounting_cost_centers', NEW.cost_center_id),
      'Cost center'
    );

    IF NEW.type = 'manual' THEN
      IF NEW.payment_date IS NULL THEN
        RAISE EXCEPTION 'Manual payment date is required.';
      END IF;
      IF NEW.amount IS NULL OR NEW.amount <= 0 THEN
        RAISE EXCEPTION 'Manual payment amount must be greater than zero.';
      END IF;
      IF NEW.account_id IS NULL THEN
        RAISE EXCEPTION 'Manual payment bank/cash account is required.';
      END IF;
      IF NEW.counterpart_account_id IS NULL THEN
        RAISE EXCEPTION 'Manual payment counterpart account is required.';
      END IF;
      IF NEW.account_id = NEW.counterpart_account_id THEN
        RAISE EXCEPTION 'Manual payment bank/cash account and counterpart account must be different.';
      END IF;
      IF NULLIF(BTRIM(COALESCE(NEW.description, NEW.notes, '')), '') IS NULL THEN
        RAISE EXCEPTION 'Manual payment description is required.';
      END IF;
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.status = 'posted' THEN
      IF ROW(
        NEW.payment_date,
        NEW.type,
        NEW.direction,
        NEW.amount,
        NEW.account_id,
        NEW.counterpart_account_id,
        NEW.cost_center_id,
        NEW.customer_id,
        NEW.vendor_id,
        NEW.employee_id,
        NEW.invoice_id,
        NEW.expense_id,
        NEW.advance_request_id,
        NEW.payroll_id,
        NEW.description,
        NEW.reference_no,
        NEW.method,
        NEW.notes,
        NEW.attachment_url
      ) IS DISTINCT FROM ROW(
        OLD.payment_date,
        OLD.type,
        OLD.direction,
        OLD.amount,
        OLD.account_id,
        OLD.counterpart_account_id,
        OLD.cost_center_id,
        OLD.customer_id,
        OLD.vendor_id,
        OLD.employee_id,
        OLD.invoice_id,
        OLD.expense_id,
        OLD.advance_request_id,
        OLD.payroll_id,
        OLD.description,
        OLD.reference_no,
        OLD.method,
        OLD.notes,
        OLD.attachment_url
      ) THEN
        RAISE EXCEPTION 'Posted accounting payments cannot be edited; reverse or cancel through an accounting workflow.';
      END IF;
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'sales_products' THEN
    PERFORM public.accounting_assert_ref_org(
      NEW.organization_id,
      NEW.revenue_account_id,
      public.accounting_reference_org('public.accounting_accounts', NEW.revenue_account_id),
      'Revenue account'
    );

    IF NEW.revenue_account_id IS NOT NULL THEN
      SELECT type INTO v_account_type
      FROM public.accounting_accounts
      WHERE id = NEW.revenue_account_id
        AND organization_id = NEW.organization_id;

      IF v_account_type IS DISTINCT FROM 'revenue' THEN
        RAISE EXCEPTION 'Sales product revenue account must be a revenue account.';
      END IF;
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'sales_companies' THEN
    PERFORM public.accounting_assert_ref_org(
      NEW.organization_id,
      NEW.accounting_customer_id,
      public.accounting_reference_org('public.accounting_customers', NEW.accounting_customer_id),
      'Accounting customer'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_accounting_payments_completion_refs ON public.accounting_payments;
CREATE TRIGGER trg_accounting_payments_completion_refs
  BEFORE INSERT OR UPDATE ON public.accounting_payments
  FOR EACH ROW EXECUTE FUNCTION public.accounting_completion_validate_refs();

DROP TRIGGER IF EXISTS trg_sales_products_accounting_refs ON public.sales_products;
CREATE TRIGGER trg_sales_products_accounting_refs
  BEFORE INSERT OR UPDATE ON public.sales_products
  FOR EACH ROW EXECUTE FUNCTION public.accounting_completion_validate_refs();

DROP TRIGGER IF EXISTS trg_sales_companies_accounting_refs ON public.sales_companies;
CREATE TRIGGER trg_sales_companies_accounting_refs
  BEFORE INSERT OR UPDATE ON public.sales_companies
  FOR EACH ROW EXECUTE FUNCTION public.accounting_completion_validate_refs();
