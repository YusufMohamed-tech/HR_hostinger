-- Finance & Accounting module. Additive and production-safe.
-- Do not apply with schema reset commands.

ALTER TYPE public.org_role ADD VALUE IF NOT EXISTS 'finance_manager';
ALTER TYPE public.org_role ADD VALUE IF NOT EXISTS 'accountant';
ALTER TYPE public.org_role ADD VALUE IF NOT EXISTS 'finance_viewer';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'accounting';

CREATE TABLE IF NOT EXISTS public.accounting_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name_ar text NOT NULL,
  name_en text,
  type text NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  subtype text,
  parent_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  normal_balance text NOT NULL CHECK (normal_balance IN ('debit', 'credit')),
  is_system boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  description text,
  created_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS public.accounting_cost_centers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name_ar text NOT NULL,
  name_en text,
  type text NOT NULL CHECK (type IN ('department', 'location', 'project', 'sales_company', 'branch', 'channel', 'custom')),
  reference_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS public.accounting_journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  entry_no text NOT NULL,
  entry_date date NOT NULL,
  description text NOT NULL,
  source_module text NOT NULL DEFAULT 'manual',
  source_id uuid,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_approval', 'posted', 'reversed', 'cancelled')),
  currency text NOT NULL DEFAULT 'SAR',
  total_debit numeric(14,2) NOT NULL DEFAULT 0 CHECK (total_debit >= 0),
  total_credit numeric(14,2) NOT NULL DEFAULT 0 CHECK (total_credit >= 0),
  created_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  approved_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  posted_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  reversed_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  approved_at timestamptz,
  posted_at timestamptz,
  reversed_at timestamptz,
  reversal_of uuid REFERENCES public.accounting_journal_entries(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, entry_no),
  CHECK (status <> 'posted' OR (total_debit = total_credit AND posted_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS public.accounting_journal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  journal_entry_id uuid NOT NULL REFERENCES public.accounting_journal_entries(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounting_accounts(id) ON DELETE RESTRICT,
  debit numeric(14,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  description text,
  cost_center_id uuid REFERENCES public.accounting_cost_centers(id) ON DELETE SET NULL,
  employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
);

CREATE TABLE IF NOT EXISTS public.accounting_vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name_ar text NOT NULL,
  name_en text,
  vat_number text,
  commercial_registration text,
  phone text,
  email text,
  address text,
  city text,
  country text NOT NULL DEFAULT 'Saudi Arabia',
  bank_name text,
  iban text,
  payment_terms text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.accounting_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sales_company_id uuid REFERENCES public.sales_companies(id) ON DELETE SET NULL,
  name_ar text NOT NULL,
  name_en text,
  vat_number text,
  commercial_registration text,
  phone text,
  email text,
  address text,
  city text,
  country text NOT NULL DEFAULT 'Saudi Arabia',
  payment_terms text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.accounting_tax_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name_ar text NOT NULL,
  name_en text,
  rate numeric(5,2) NOT NULL CHECK (rate >= 0),
  tax_account_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.accounting_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.accounting_customers(id) ON DELETE SET NULL,
  invoice_no text NOT NULL,
  invoice_date date NOT NULL,
  due_date date,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'partially_paid', 'paid', 'cancelled', 'void')),
  source_module text NOT NULL DEFAULT 'manual',
  source_id uuid,
  subtotal numeric(14,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  vat_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
  total_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  paid_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  balance_due numeric(14,2) NOT NULL DEFAULT 0 CHECK (balance_due >= 0),
  currency text NOT NULL DEFAULT 'SAR',
  qr_code_data text,
  zatca_status text NOT NULL DEFAULT 'not_integrated',
  journal_entry_id uuid REFERENCES public.accounting_journal_entries(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  issued_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  issued_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, invoice_no)
);

CREATE TABLE IF NOT EXISTS public.accounting_invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.accounting_invoices(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.sales_products(id) ON DELETE SET NULL,
  description_ar text NOT NULL,
  description_en text,
  quantity numeric(12,2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price numeric(14,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  discount_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  tax_rate_id uuid REFERENCES public.accounting_tax_rates(id) ON DELETE SET NULL,
  vat_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
  line_total numeric(14,2) NOT NULL DEFAULT 0 CHECK (line_total >= 0),
  revenue_account_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  cost_center_id uuid REFERENCES public.accounting_cost_centers(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.accounting_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  expense_no text NOT NULL,
  vendor_id uuid REFERENCES public.accounting_vendors(id) ON DELETE SET NULL,
  employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  expense_date date NOT NULL,
  category_account_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  payment_account_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  cost_center_id uuid REFERENCES public.accounting_cost_centers(id) ON DELETE SET NULL,
  description text NOT NULL,
  amount_before_vat numeric(14,2) NOT NULL DEFAULT 0 CHECK (amount_before_vat >= 0),
  vat_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
  total_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_approval', 'approved', 'rejected', 'paid', 'cancelled')),
  paid_status text NOT NULL DEFAULT 'unpaid' CHECK (paid_status IN ('unpaid', 'partially_paid', 'paid')),
  payment_method text,
  attachment_url text,
  journal_entry_id uuid REFERENCES public.accounting_journal_entries(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  approved_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  approved_at timestamptz,
  paid_at timestamptz,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, expense_no)
);

CREATE TABLE IF NOT EXISTS public.accounting_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  payment_no text NOT NULL,
  payment_date date NOT NULL,
  type text NOT NULL CHECK (type IN ('customer_receipt', 'vendor_payment', 'payroll_payment', 'employee_advance', 'manual')),
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'SAR',
  account_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES public.accounting_customers(id) ON DELETE SET NULL,
  vendor_id uuid REFERENCES public.accounting_vendors(id) ON DELETE SET NULL,
  employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  invoice_id uuid REFERENCES public.accounting_invoices(id) ON DELETE SET NULL,
  expense_id uuid REFERENCES public.accounting_expenses(id) ON DELETE SET NULL,
  advance_request_id uuid REFERENCES public.advance_requests(id) ON DELETE SET NULL,
  payroll_id uuid,
  reference_no text,
  method text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'cancelled')),
  journal_entry_id uuid REFERENCES public.accounting_journal_entries(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  posted_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  posted_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, payment_no),
  CHECK (status <> 'posted' OR posted_at IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS public.accounting_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  default_cash_account_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  default_bank_account_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  default_accounts_receivable_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  default_accounts_payable_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  default_sales_revenue_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  default_vat_payable_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  default_vat_receivable_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  default_salary_expense_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  default_salary_payable_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  default_employee_advances_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  default_asset_account_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  default_depreciation_expense_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  default_accumulated_depreciation_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  fiscal_year_start_month integer NOT NULL DEFAULT 1 CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
  invoice_prefix text NOT NULL DEFAULT 'INV',
  expense_prefix text NOT NULL DEFAULT 'EXP',
  journal_prefix text NOT NULL DEFAULT 'JE',
  payment_prefix text NOT NULL DEFAULT 'PAY',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id)
);

CREATE TABLE IF NOT EXISTS public.accounting_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'locked')),
  closed_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS public.accounting_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  file_name text NOT NULL,
  file_url text NOT NULL,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.accounting_source_postings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_module text NOT NULL,
  source_id uuid NOT NULL,
  journal_entry_id uuid REFERENCES public.accounting_journal_entries(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'posted',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, source_module, source_id)
);

CREATE INDEX IF NOT EXISTS idx_accounting_accounts_org_type
  ON public.accounting_accounts(organization_id, type, parent_id, is_active);
CREATE INDEX IF NOT EXISTS idx_accounting_cost_centers_org
  ON public.accounting_cost_centers(organization_id, type, reference_id, is_active);
CREATE INDEX IF NOT EXISTS idx_accounting_journal_entries_org
  ON public.accounting_journal_entries(organization_id, entry_date DESC, status, source_module, source_id);
CREATE INDEX IF NOT EXISTS idx_accounting_journal_lines_org
  ON public.accounting_journal_lines(organization_id, journal_entry_id, account_id, cost_center_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_accounting_vendors_org
  ON public.accounting_vendors(organization_id, is_active, name_ar);
CREATE INDEX IF NOT EXISTS idx_accounting_customers_org
  ON public.accounting_customers(organization_id, is_active, name_ar, sales_company_id);
CREATE INDEX IF NOT EXISTS idx_accounting_invoices_org
  ON public.accounting_invoices(organization_id, customer_id, status, invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_accounting_expenses_org
  ON public.accounting_expenses(organization_id, status, expense_date DESC, vendor_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_accounting_payments_org
  ON public.accounting_payments(organization_id, status, payment_date DESC, type);
CREATE INDEX IF NOT EXISTS idx_accounting_periods_org
  ON public.accounting_periods(organization_id, start_date, end_date, status);
CREATE INDEX IF NOT EXISTS idx_accounting_source_postings_source
  ON public.accounting_source_postings(organization_id, source_module, source_id);

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'accounting_accounts',
    'accounting_cost_centers',
    'accounting_journal_entries',
    'accounting_journal_lines',
    'accounting_vendors',
    'accounting_customers',
    'accounting_tax_rates',
    'accounting_invoices',
    'accounting_invoice_lines',
    'accounting_expenses',
    'accounting_payments',
    'accounting_settings',
    'accounting_periods',
    'accounting_attachments',
    'accounting_source_postings'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.can_view_accounting()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_super_admin()
    OR COALESCE(
      (
        SELECT role::text IN ('admin', 'finance_manager', 'accountant', 'finance_viewer')
        FROM public.org_members
        WHERE user_id = auth.uid()
        LIMIT 1
      ),
      false
    );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_accounting()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT role::text IN ('admin', 'finance_manager', 'accountant')
      FROM public.org_members
      WHERE user_id = auth.uid()
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
      SELECT role::text IN ('admin', 'finance_manager')
      FROM public.org_members
      WHERE user_id = auth.uid()
      LIMIT 1
    ),
    false
  );
$$;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'accounting_accounts',
    'accounting_cost_centers',
    'accounting_journal_entries',
    'accounting_journal_lines',
    'accounting_vendors',
    'accounting_customers',
    'accounting_tax_rates',
    'accounting_invoices',
    'accounting_invoice_lines',
    'accounting_expenses',
    'accounting_payments',
    'accounting_settings',
    'accounting_periods',
    'accounting_attachments',
    'accounting_source_postings'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_select ON public.%I', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY %I_select ON public.%I FOR SELECT USING (auth.role() = ''service_role'' OR (organization_id = public.current_org_id() AND public.can_view_accounting()))',
      tbl,
      tbl
    );

    EXECUTE format('DROP POLICY IF EXISTS %I_insert ON public.%I', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY %I_insert ON public.%I FOR INSERT WITH CHECK (auth.role() = ''service_role'' OR (organization_id = public.current_org_id() AND public.can_manage_accounting()))',
      tbl,
      tbl
    );

    EXECUTE format('DROP POLICY IF EXISTS %I_update ON public.%I', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY %I_update ON public.%I FOR UPDATE USING (auth.role() = ''service_role'' OR (organization_id = public.current_org_id() AND public.can_manage_accounting())) WITH CHECK (auth.role() = ''service_role'' OR (organization_id = public.current_org_id() AND public.can_manage_accounting()))',
      tbl,
      tbl
    );

    EXECUTE format('DROP POLICY IF EXISTS %I_delete ON public.%I', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY %I_delete ON public.%I FOR DELETE USING (auth.role() = ''service_role'' OR (organization_id = public.current_org_id() AND public.can_manage_accounting()))',
      tbl,
      tbl
    );
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.accounting_prevent_posted_entry_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status IN ('posted', 'reversed') THEN
    RAISE EXCEPTION 'Posted accounting entries cannot be deleted.';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IN ('posted', 'reversed') THEN
    IF NEW.status = OLD.status
       AND NEW.reversed_by IS NOT DISTINCT FROM OLD.reversed_by
       AND NEW.reversed_at IS NOT DISTINCT FROM OLD.reversed_at THEN
      RAISE EXCEPTION 'Posted accounting entries cannot be edited directly.';
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_accounting_prevent_posted_entry_update ON public.accounting_journal_entries;
CREATE TRIGGER trg_accounting_prevent_posted_entry_update
  BEFORE UPDATE OR DELETE ON public.accounting_journal_entries
  FOR EACH ROW EXECUTE FUNCTION public.accounting_prevent_posted_entry_mutation();

CREATE OR REPLACE FUNCTION public.accounting_validate_same_org()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_org uuid;
  journal_org uuid;
  account_org uuid;
  cost_center_org uuid;
BEGIN
  IF TG_TABLE_NAME = 'accounting_accounts' AND NEW.parent_id IS NOT NULL THEN
    SELECT organization_id INTO parent_org
    FROM public.accounting_accounts
    WHERE id = NEW.parent_id;
    IF parent_org IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'Parent account must belong to the same organization.';
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'accounting_journal_lines' THEN
    SELECT organization_id INTO journal_org
    FROM public.accounting_journal_entries
    WHERE id = NEW.journal_entry_id;
    SELECT organization_id INTO account_org
    FROM public.accounting_accounts
    WHERE id = NEW.account_id;
    IF journal_org IS DISTINCT FROM NEW.organization_id OR account_org IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'Journal line references must belong to the same organization.';
    END IF;
    IF NEW.cost_center_id IS NOT NULL THEN
      SELECT organization_id INTO cost_center_org
      FROM public.accounting_cost_centers
      WHERE id = NEW.cost_center_id;
      IF cost_center_org IS DISTINCT FROM NEW.organization_id THEN
        RAISE EXCEPTION 'Cost center must belong to the same organization.';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_accounting_accounts_same_org ON public.accounting_accounts;
CREATE TRIGGER trg_accounting_accounts_same_org
  BEFORE INSERT OR UPDATE ON public.accounting_accounts
  FOR EACH ROW EXECUTE FUNCTION public.accounting_validate_same_org();

DROP TRIGGER IF EXISTS trg_accounting_journal_lines_same_org ON public.accounting_journal_lines;
CREATE TRIGGER trg_accounting_journal_lines_same_org
  BEFORE INSERT OR UPDATE ON public.accounting_journal_lines
  FOR EACH ROW EXECUTE FUNCTION public.accounting_validate_same_org();

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'accounting_accounts',
    'accounting_cost_centers',
    'accounting_journal_entries',
    'accounting_vendors',
    'accounting_customers',
    'accounting_invoices',
    'accounting_expenses',
    'accounting_payments',
    'accounting_settings'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgname = 'trg_' || tbl || '_updated_at'
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()',
        tbl,
        tbl
      );
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.initialize_accounting_defaults(p_org_id uuid, p_user_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cash_id uuid;
  bank_id uuid;
  ar_id uuid;
  ap_id uuid;
  sales_id uuid;
  vat_payable_id uuid;
  vat_receivable_id uuid;
  salary_expense_id uuid;
  salary_payable_id uuid;
  advances_id uuid;
  asset_id uuid;
  depreciation_expense_id uuid;
  accumulated_depreciation_id uuid;
BEGIN
  INSERT INTO public.accounting_accounts
    (organization_id, code, name_ar, name_en, type, subtype, normal_balance, is_system, created_by)
  VALUES
    (p_org_id, '1000', 'النقدية', 'Cash', 'asset', 'cash', 'debit', true, p_user_id),
    (p_org_id, '1010', 'البنك', 'Bank', 'asset', 'bank', 'debit', true, p_user_id),
    (p_org_id, '1100', 'الذمم المدينة', 'Accounts Receivable', 'asset', 'receivable', 'debit', true, p_user_id),
    (p_org_id, '1200', 'سلف الموظفين', 'Employee Advances', 'asset', 'employee_advances', 'debit', true, p_user_id),
    (p_org_id, '1300', 'مصروفات مدفوعة مقدما', 'Prepaid Expenses', 'asset', 'prepaid', 'debit', true, p_user_id),
    (p_org_id, '1500', 'الأصول الثابتة', 'Fixed Assets', 'asset', 'fixed_assets', 'debit', true, p_user_id),
    (p_org_id, '1590', 'مجمع الإهلاك', 'Accumulated Depreciation', 'asset', 'accumulated_depreciation', 'credit', true, p_user_id),
    (p_org_id, '2000', 'الذمم الدائنة', 'Accounts Payable', 'liability', 'payable', 'credit', true, p_user_id),
    (p_org_id, '2100', 'ضريبة القيمة المضافة المستحقة', 'VAT Payable', 'liability', 'vat_payable', 'credit', true, p_user_id),
    (p_org_id, '2110', 'ضريبة القيمة المضافة القابلة للاسترداد', 'VAT Receivable', 'asset', 'vat_receivable', 'debit', true, p_user_id),
    (p_org_id, '2200', 'رواتب مستحقة الدفع', 'Salaries Payable', 'liability', 'salary_payable', 'credit', true, p_user_id),
    (p_org_id, '2300', 'مصروفات مستحقة', 'Accrued Expenses', 'liability', 'accrued_expenses', 'credit', true, p_user_id),
    (p_org_id, '2400', 'مخصص نهاية الخدمة', 'End of Service Provision', 'liability', 'eos_provision', 'credit', true, p_user_id),
    (p_org_id, '3000', 'رأس المال', 'Owner Capital', 'equity', 'capital', 'credit', true, p_user_id),
    (p_org_id, '3100', 'الأرباح المبقاة', 'Retained Earnings', 'equity', 'retained_earnings', 'credit', true, p_user_id),
    (p_org_id, '4000', 'إيرادات المبيعات', 'Sales Revenue', 'revenue', 'sales', 'credit', true, p_user_id),
    (p_org_id, '4100', 'إيرادات الخدمات', 'Service Revenue', 'revenue', 'services', 'credit', true, p_user_id),
    (p_org_id, '4200', 'إيرادات أخرى', 'Other Income', 'revenue', 'other_income', 'credit', true, p_user_id),
    (p_org_id, '5000', 'مصروف الرواتب', 'Salaries Expense', 'expense', 'salaries', 'debit', true, p_user_id),
    (p_org_id, '5010', 'مصروف المكافآت', 'Bonuses Expense', 'expense', 'bonuses', 'debit', true, p_user_id),
    (p_org_id, '5020', 'مصروف العمولات', 'Commissions Expense', 'expense', 'commissions', 'debit', true, p_user_id),
    (p_org_id, '5030', 'مصروف التأمينات الاجتماعية', 'GOSI / Social Insurance Expense', 'expense', 'social_insurance', 'debit', true, p_user_id),
    (p_org_id, '5100', 'مصروف الإيجار', 'Rent Expense', 'expense', 'rent', 'debit', true, p_user_id),
    (p_org_id, '5200', 'مصروف المرافق', 'Utilities Expense', 'expense', 'utilities', 'debit', true, p_user_id),
    (p_org_id, '5300', 'مصروف الاتصالات', 'Telecom Expense', 'expense', 'telecom', 'debit', true, p_user_id),
    (p_org_id, '5400', 'مصروف التوظيف', 'Recruitment Expense', 'expense', 'recruitment', 'debit', true, p_user_id),
    (p_org_id, '5500', 'مصروف التدريب', 'Training Expense', 'expense', 'training', 'debit', true, p_user_id),
    (p_org_id, '5600', 'مصروف السفر', 'Travel Expense', 'expense', 'travel', 'debit', true, p_user_id),
    (p_org_id, '5700', 'مصروف اللوازم المكتبية', 'Office Supplies Expense', 'expense', 'office_supplies', 'debit', true, p_user_id),
    (p_org_id, '5800', 'مصروف الإهلاك', 'Depreciation Expense', 'expense', 'depreciation', 'debit', true, p_user_id),
    (p_org_id, '5900', 'مصروفات أخرى', 'Other Expense', 'expense', 'other_expense', 'debit', true, p_user_id)
  ON CONFLICT (organization_id, code) DO UPDATE
  SET name_ar = EXCLUDED.name_ar,
      name_en = EXCLUDED.name_en,
      type = EXCLUDED.type,
      subtype = EXCLUDED.subtype,
      normal_balance = EXCLUDED.normal_balance,
      is_system = true,
      updated_at = now();

  SELECT id INTO cash_id FROM public.accounting_accounts WHERE organization_id = p_org_id AND code = '1000';
  SELECT id INTO bank_id FROM public.accounting_accounts WHERE organization_id = p_org_id AND code = '1010';
  SELECT id INTO ar_id FROM public.accounting_accounts WHERE organization_id = p_org_id AND code = '1100';
  SELECT id INTO advances_id FROM public.accounting_accounts WHERE organization_id = p_org_id AND code = '1200';
  SELECT id INTO asset_id FROM public.accounting_accounts WHERE organization_id = p_org_id AND code = '1500';
  SELECT id INTO accumulated_depreciation_id FROM public.accounting_accounts WHERE organization_id = p_org_id AND code = '1590';
  SELECT id INTO ap_id FROM public.accounting_accounts WHERE organization_id = p_org_id AND code = '2000';
  SELECT id INTO vat_payable_id FROM public.accounting_accounts WHERE organization_id = p_org_id AND code = '2100';
  SELECT id INTO vat_receivable_id FROM public.accounting_accounts WHERE organization_id = p_org_id AND code = '2110';
  SELECT id INTO salary_payable_id FROM public.accounting_accounts WHERE organization_id = p_org_id AND code = '2200';
  SELECT id INTO sales_id FROM public.accounting_accounts WHERE organization_id = p_org_id AND code = '4000';
  SELECT id INTO salary_expense_id FROM public.accounting_accounts WHERE organization_id = p_org_id AND code = '5000';
  SELECT id INTO depreciation_expense_id FROM public.accounting_accounts WHERE organization_id = p_org_id AND code = '5800';

  INSERT INTO public.accounting_settings (
    organization_id,
    default_cash_account_id,
    default_bank_account_id,
    default_accounts_receivable_id,
    default_accounts_payable_id,
    default_sales_revenue_id,
    default_vat_payable_id,
    default_vat_receivable_id,
    default_salary_expense_id,
    default_salary_payable_id,
    default_employee_advances_id,
    default_asset_account_id,
    default_depreciation_expense_id,
    default_accumulated_depreciation_id
  )
  VALUES (
    p_org_id,
    cash_id,
    bank_id,
    ar_id,
    ap_id,
    sales_id,
    vat_payable_id,
    vat_receivable_id,
    salary_expense_id,
    salary_payable_id,
    advances_id,
    asset_id,
    depreciation_expense_id,
    accumulated_depreciation_id
  )
  ON CONFLICT (organization_id) DO UPDATE
  SET default_cash_account_id = COALESCE(public.accounting_settings.default_cash_account_id, EXCLUDED.default_cash_account_id),
      default_bank_account_id = COALESCE(public.accounting_settings.default_bank_account_id, EXCLUDED.default_bank_account_id),
      default_accounts_receivable_id = COALESCE(public.accounting_settings.default_accounts_receivable_id, EXCLUDED.default_accounts_receivable_id),
      default_accounts_payable_id = COALESCE(public.accounting_settings.default_accounts_payable_id, EXCLUDED.default_accounts_payable_id),
      default_sales_revenue_id = COALESCE(public.accounting_settings.default_sales_revenue_id, EXCLUDED.default_sales_revenue_id),
      default_vat_payable_id = COALESCE(public.accounting_settings.default_vat_payable_id, EXCLUDED.default_vat_payable_id),
      default_vat_receivable_id = COALESCE(public.accounting_settings.default_vat_receivable_id, EXCLUDED.default_vat_receivable_id),
      default_salary_expense_id = COALESCE(public.accounting_settings.default_salary_expense_id, EXCLUDED.default_salary_expense_id),
      default_salary_payable_id = COALESCE(public.accounting_settings.default_salary_payable_id, EXCLUDED.default_salary_payable_id),
      default_employee_advances_id = COALESCE(public.accounting_settings.default_employee_advances_id, EXCLUDED.default_employee_advances_id),
      default_asset_account_id = COALESCE(public.accounting_settings.default_asset_account_id, EXCLUDED.default_asset_account_id),
      default_depreciation_expense_id = COALESCE(public.accounting_settings.default_depreciation_expense_id, EXCLUDED.default_depreciation_expense_id),
      default_accumulated_depreciation_id = COALESCE(public.accounting_settings.default_accumulated_depreciation_id, EXCLUDED.default_accumulated_depreciation_id),
      updated_at = now();

  INSERT INTO public.accounting_tax_rates (organization_id, name_ar, name_en, rate, tax_account_id, is_default, is_active)
  VALUES (p_org_id, 'ضريبة القيمة المضافة 15%', 'VAT 15%', 15, vat_payable_id, true, true)
  ON CONFLICT DO NOTHING;
END;
$$;

