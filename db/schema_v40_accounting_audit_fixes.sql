-- Accounting audit fixes: DB/RLS hardening and sensitive transition guards.
-- Safe migration only: no data reset and no destructive table changes.

CREATE OR REPLACE FUNCTION public.can_manage_accounting()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT role::text IN ('finance_manager', 'accountant')
      FROM public.org_members
      WHERE user_id = auth.uid()
        AND org_id = public.current_org_id()
      LIMIT 1
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.can_post_accounting()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT role::text = 'finance_manager'
      FROM public.org_members
      WHERE user_id = auth.uid()
        AND org_id = public.current_org_id()
      LIMIT 1
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_accounting_settings()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT role::text = 'finance_manager'
      FROM public.org_members
      WHERE user_id = auth.uid()
        AND org_id = public.current_org_id()
      LIMIT 1
    ),
    false
  );
$$;

DROP POLICY IF EXISTS accounting_settings_insert ON public.accounting_settings;
CREATE POLICY accounting_settings_insert ON public.accounting_settings
  FOR INSERT
  WITH CHECK (
    auth.role() = 'service_role'
    OR (organization_id = public.current_org_id() AND public.can_manage_accounting_settings())
  );

DROP POLICY IF EXISTS accounting_settings_update ON public.accounting_settings;
CREATE POLICY accounting_settings_update ON public.accounting_settings
  FOR UPDATE
  USING (
    auth.role() = 'service_role'
    OR (organization_id = public.current_org_id() AND public.can_manage_accounting_settings())
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR (organization_id = public.current_org_id() AND public.can_manage_accounting_settings())
  );

DROP POLICY IF EXISTS accounting_settings_delete ON public.accounting_settings;
CREATE POLICY accounting_settings_delete ON public.accounting_settings
  FOR DELETE
  USING (
    auth.role() = 'service_role'
    OR (organization_id = public.current_org_id() AND public.can_manage_accounting_settings())
  );

CREATE OR REPLACE FUNCTION public.accounting_prevent_posted_entry_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  line_count integer;
  line_debit numeric(14,2);
  line_credit numeric(14,2);
  locked_period_name text;
  has_reversal boolean;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'posted' THEN
    RAISE EXCEPTION 'Accounting entries must be created as draft before posting.';
  END IF;

  IF TG_OP = 'DELETE' AND OLD.status IN ('posted', 'reversed') THEN
    RAISE EXCEPTION 'Posted accounting entries cannot be deleted.';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status = 'posted' AND OLD.status IS DISTINCT FROM 'posted' THEN
    IF auth.role() <> 'service_role' AND NOT public.can_post_accounting() THEN
      RAISE EXCEPTION 'Only finance managers can post accounting entries.';
    END IF;

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

      IF auth.role() <> 'service_role' AND NOT public.can_post_accounting() THEN
        RAISE EXCEPTION 'Only finance managers can reverse posted accounting entries.';
      END IF;

      SELECT EXISTS (
        SELECT 1
        FROM public.accounting_journal_entries reversal
        WHERE reversal.organization_id = OLD.organization_id
          AND reversal.reversal_of = OLD.id
          AND reversal.status IN ('posted', 'reversed')
      ) INTO has_reversal;

      IF auth.role() <> 'service_role' AND NOT has_reversal THEN
        RAISE EXCEPTION 'A posted reversal entry must exist before marking the original entry reversed.';
      END IF;

      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Posted accounting entries cannot be edited directly.';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.accounting_prevent_posted_payment_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'posted' THEN
    RAISE EXCEPTION 'Posted accounting payments cannot be deleted.';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_accounting_prevent_posted_payment_delete ON public.accounting_payments;
CREATE TRIGGER trg_accounting_prevent_posted_payment_delete
  BEFORE DELETE ON public.accounting_payments
  FOR EACH ROW EXECUTE FUNCTION public.accounting_prevent_posted_payment_delete();

CREATE OR REPLACE FUNCTION public.accounting_completion_validate_refs()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_account_type text;
BEGIN
  IF TG_TABLE_NAME = 'accounting_payments' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;

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

    IF TG_OP = 'INSERT' AND NEW.status = 'posted' THEN
      IF auth.role() <> 'service_role' AND NOT public.can_post_accounting() THEN
        RAISE EXCEPTION 'Only finance managers can create posted accounting payments.';
      END IF;
    END IF;

    IF TG_OP = 'UPDATE' AND NEW.status = 'posted' AND OLD.status IS DISTINCT FROM 'posted' THEN
      IF auth.role() <> 'service_role' AND NOT public.can_post_accounting() THEN
        RAISE EXCEPTION 'Only finance managers can post accounting payments.';
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
