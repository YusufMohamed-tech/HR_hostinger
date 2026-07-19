# Carrier Sales Dashboard & Verification System — Full Blueprint

> Single-file implementation guide. No external dependencies on other docs.
> Ready to hand off to any developer for implementation.

---

## 1. WHAT WE'RE BUILDING

A management dashboard that replicates the client's HGC Power BI (Virgin 2026 - Managers & Exec), plus an Excel verification system. The client (a telecom distributor in KSA) gets a daily Excel from Virgin/FRiENDi with every SIM activation their dealer codes produced. HR uploads that Excel into our system daily. Meanwhile, each salesperson logs their own sales in our app. The system:

1. Parses the carrier Excel into structured activation data
2. Matches each activation row to an employee via dealer codes
3. Computes all the KPIs and charts that the Power BI shows
4. Cross-checks the carrier data against what employees self-reported, flagging discrepancies to both the employee and HR (no auto-action)

### Business Context
- **Company**: Mashael Fahad Al Harthy Trading Est. — telecom distributor
- **Brands sold**: Virgin Mobile (prepaid, postpaid, HBB) and FRiENDi mobile (prepaid)
- **Channels**: Direct Sales (own shops) and Modern Trade (Panda, LuLu, Othaim, etc.)
- **Regions**: Central, Eastern, Southern, Western (KSA)
- **Employees**: ~150 active salespeople + ~15 supervisors
- **Daily volume**: ~700-1000 activations/day
- **Monthly volume**: ~20K-25K activations/month

---

## 2. THE EXCEL FILE (SOURCE OF TRUTH)

File naming: `Sales-Alharthi <DD-M>.xlsx` (e.g., `Sales-Alharthi 13-7.xlsx`)
Single sheet, 36 columns, ~700-1000 rows per day (cumulative monthly file that grows daily).

### 2.1 Complete Column Reference

| Col | Header | Type | Example | System Field |
|-----|--------|------|---------|--------------|
| A | Activations | int | 1 | `activation_count` |
| B | Bundle type | text | "Virgin 45", "Other Bundles", "No First Bundle" | `bundle_type` |
| C | Activation Month | date | 2026-07-01 | `activation_month` |
| D | Activation Date | date | 2026-07-07 | `activation_date` |
| E | Dealer Region (mSales) | text | "Central" | `region` |
| F | Dealer City | text | "Riyadh" | `city` |
| G | Distributor Name | text | "Mashael Fahad Al Harthy..." | `distributor_name` |
| H | Channel | text | "Direct Sales" / "Modern trade" | `channel` |
| I | Dealer Name | text | "Mashael Fahed Al Harthi-MT" | `dealer_name` |
| J | Dealer Code | text | "DIR-05577" | `dealer_code` **PRIMARY KEY FOR MATCHING** |
| K | Key Account Manager | text | "Salman Mohammed..." | `key_account_manager` |
| L | Account Manager Name | text | "Mostafa Saed..." / "-" | `account_manager` |
| M | Team Leader | text | "Nabil Mohamed..." / "Managed By Agencies" | `team_leader` **MAPS TO SUPERVISOR** |
| N | Sales Champion | text | "Managed By Agencies" | `sales_champion` |
| O | Segment Brand | text | "Virgin Mobile" / "FRiENDi mobile" | `segment_brand` |
| P | Segment Group | text | "Virgin Prepaid", "FRiENDi Prepaid", "Virgin Postpaid", "Virgin HBB", "Virgin MBB" | `segment_group` |
| Q | Nationality | text | "India", "Saudi Arabia" | `customer_nationality` |
| R | Customer ID Type | text | "Resident/Iqama Visa", "Saudi National ID", "Visitor Visa" | `customer_id_type` |
| S | Cas Latitude | numeric | 24.535245 | `latitude` |
| T | Cas Longitude | numeric | 46.693646 | `longitude` |
| U | Activation Timestamp | datetime | 2026-07-07 22:40:15 | `activated_at` **DETERMINES SHIFT** |
| V | Cas Location ID | text | "13308" / "-" | `cas_location_id` |
| W | Cas Location Name | text | "Panda - Emam University" / "-" | `cas_location_name` |
| X | First Bundle Description | text | "1GB, 3GB, 250Min" | `bundle_description` |
| Y | FPE Count | int | 1 or 0 | `fpe_count` **KEY METRIC** |
| Z | Initial Balance Recharge Value | numeric | 51.75 | `ibr_value` **KEY METRIC (with VAT)** |
| AA | Initial Balance Recharge Value Without VAT | numeric | 45.00 | `ibr_value_excl_vat` |
| AB | 1st Recharge Value | numeric | 345 | `first_recharge_value` |
| AC | 2nd Recharge Value | numeric | 0 or blank | `second_recharge_value` |
| AD | UID % | numeric | 1 | `uid_percent` |
| AE | Total First Bundle QTY | int | 1 | `first_bundle_qty` |
| AF | Total First Bundle Revenue | numeric | 45 | `first_bundle_revenue` **BUNDLE REVENUE (excl VAT)** |
| AG | Lifetime Recharge Amount | numeric | 345 | `lifetime_recharge` |
| AH | Initial Balance Total Value | numeric | 51.75 | `initial_balance_total` |
| AI | Dealer Partner Name | text | "Sadhan Market", "Panda" | `dealer_partner` |
| AJ | Cas Subscription Type | text | "Virgin_Prepaid_Digital_Cust" | `subscription_type` |

### 2.2 Key Data Patterns Observed

- **Total rows in sample file**: 9,790 (July 1-12, 12 days)
- **~816 activations/day average**
- **Channel split**: Modern trade 50.6% / Direct Sales 49.4%
- **Brand split**: FRiENDi 61.3% / Virgin 38.7%
- **Region split**: Central 42.2% / Western 40.4% / Southern 9.3% / Eastern 8.1%
- **Dealer codes used**: ~60+ unique codes active simultaneously
- **Team leaders (supervisors)**: 7 named + "Managed By Agencies" (for Modern Trade)
- **Dealer names**: Only 2 variants (MT suffix = Modern Trade, PR suffix = Direct Sales)

### 2.3 Important: One Employee Can Have Multiple Dealer Codes

A single employee may work at different dealer codes on different days (rotational deployment). The `employee_dealer_codes` table tracks assignments by date range. When matching activations, the system checks which employee was assigned to that dealer code on that specific activation date.

---

## 3. KPI DEFINITIONS (Exact Power BI Formulas)

### 3.1 Core KPIs

| KPI | Formula | Filter |
|-----|---------|--------|
| **FPE** | `SUM(fpe_count)` | All rows where fpe_count = 1 |
| **FPE Friendi** | `SUM(fpe_count)` | WHERE segment_brand = 'FRiENDi mobile' |
| **FPE Virgin** | `SUM(fpe_count)` | WHERE segment_brand = 'Virgin Mobile' AND segment_group = 'Virgin Prepaid' |
| **Postpaid** | `COUNT(*)` | WHERE segment_group = 'Virgin Postpaid' |
| **HBB** | `COUNT(*)` | WHERE segment_group = 'Virgin HBB' |
| **IBR** | `SUM(ibr_value)` | All rows |
| **IBR Friendi** | `SUM(ibr_value)` | WHERE segment_brand = 'FRiENDi mobile' |
| **IBR Virgin** | `SUM(ibr_value)` | WHERE segment_brand = 'Virgin Mobile' |
| **Users** | `COUNT(DISTINCT dealer_code)` | Active dealer codes with activations |
| **Avg** | `FPE / Users` | Per-employee average FPE |
| **Employees** | `COUNT(DISTINCT matched_employee_id)` | Matched employees |
| **Supervisors** | `COUNT(DISTINCT matched_supervisor_id)` | Active supervisors |

### 3.2 Target-Derived KPIs

| KPI | Formula |
|-----|---------|
| **Monthly Target** | From `carrier_sales_targets` table |
| **Remaining** | `target - achieved` (0 if exceeded) |
| **Required Daily** | `remaining / days_left_in_month` |
| **Average (المعدل)** | `achieved / working_days_elapsed` |
| **Expected (المتوقع)** | `average * total_working_days` |
| **FPE/Day (R)** | `fpe_target / working_days` |
| **IBR/Day (R)** | `revenue_target / working_days` |

### 3.3 Target Achievement Gauges

| Metric | Formula |
|--------|---------|
| **Excellent %** | `(achieved / target) * 100` (capped at 200%) |
| **Risk %** | `(days_elapsed / total_days) * 100` — shows time consumed |
| **Status** | `achieved >= target * (days_elapsed/total_days)` → Excellent, else Risk |

### 3.4 Bundle Quality Categories

Derived from `ibr_value_excl_vat` (col AA — the excl-VAT bundle revenue):

| Category | IBR Range (excl VAT) | Typical Bundle Types |
|----------|---------------------|---------------------|
| **+10** | 10 - 19.99 SAR | FRiENDi 1GB/60Min (12.99) |
| **+20** | 20 - 29.99 SAR | FRiENDi 3GB/150Min (29.99) |
| **+30** | 30 - 49.99 SAR | Virgin 45 (45 excl VAT) |
| **+45** | 50 - 69.99 SAR | Virgin 70 (60.87 excl VAT) |
| **+70** | 70 - 99.99 SAR | Virgin 100 (86.96), Flexi 100 |
| **+90** | >= 100 SAR | Virgin 110, 150, 365, Flexi 300 |

These ranges should be stored in a configurable `carrier_bundle_categories` table so HR can adjust them.

### 3.5 Shift Classification

Derived from `activated_at` timestamp (col U):

| Shift | Time Range | Configurable |
|-------|-----------|--------------|
| **Morning** | From opening hour to cutoff | `shift_morning_start` (default: 08:00) |
| **Night** | From cutoff to closing | `shift_night_start` (default: 16:00, configurable) |

Store in `carrier_dashboard_config` table so it can be adjusted without code changes.

### 3.6 Location Coverage Status

| Status | Arabic | Rule |
|--------|--------|------|
| **Active (نشط)** | Green | Coverage = 100% (activated every working day) |
| **Acceptable (مقبول)** | Yellow | Coverage >= 85% |
| **Warning (تنبيه)** | Orange | Coverage >= 70% |
| **Inactive (غير نشط)** | Red | Coverage < 70% |

Formula: `coverage_percent = (days_with_activations / total_working_days) * 100`

---

## 4. DATABASE SCHEMA

### 4.1 `carrier_activation_imports` — Tracks each Excel upload

```sql
CREATE TABLE IF NOT EXISTS public.carrier_activation_imports (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  file_name         text NOT NULL,
  file_path         text,
  import_date       date NOT NULL DEFAULT current_date,
  activation_month  date NOT NULL,
  date_range_start  date NOT NULL,
  date_range_end    date NOT NULL,
  total_rows        integer NOT NULL DEFAULT 0,
  new_rows          integer NOT NULL DEFAULT 0,
  duplicate_rows    integer NOT NULL DEFAULT 0,
  matched_rows      integer NOT NULL DEFAULT 0,
  unmatched_rows    integer NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'processing'
                    CHECK (status IN ('processing','completed','partial','failed')),
  uploaded_by       uuid NOT NULL REFERENCES auth.users(id),
  error_message     text,
  processing_log    jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_carrier_imports_org_month
  ON public.carrier_activation_imports(organization_id, activation_month DESC);
CREATE INDEX idx_carrier_imports_org_status
  ON public.carrier_activation_imports(organization_id, status);
```

### 4.2 `carrier_activations` — Every activation row from Excel

```sql
CREATE TABLE IF NOT EXISTS public.carrier_activations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  import_id             uuid NOT NULL REFERENCES public.carrier_activation_imports(id) ON DELETE CASCADE,

  -- Raw Excel columns
  activation_count      integer NOT NULL DEFAULT 1,
  bundle_type           text,
  activation_month      date,
  activation_date       date NOT NULL,
  region                text,
  city                  text,
  distributor_name      text,
  channel               text CHECK (channel IN ('Direct Sales', 'Modern trade')),
  dealer_name           text,
  dealer_code           text NOT NULL,
  key_account_manager   text,
  account_manager       text,
  team_leader           text,
  sales_champion        text,
  segment_brand         text CHECK (segment_brand IN ('Virgin Mobile', 'FRiENDi mobile')),
  segment_group         text,
  customer_nationality  text,
  customer_id_type      text,
  latitude              numeric,
  longitude             numeric,
  activated_at          timestamptz,
  cas_location_id       text,
  cas_location_name     text,
  bundle_description    text,
  fpe_count             integer NOT NULL DEFAULT 0,
  ibr_value             numeric NOT NULL DEFAULT 0,
  ibr_value_excl_vat    numeric NOT NULL DEFAULT 0,
  first_recharge_value  numeric NOT NULL DEFAULT 0,
  second_recharge_value numeric NOT NULL DEFAULT 0,
  uid_percent           numeric NOT NULL DEFAULT 0,
  first_bundle_qty      integer NOT NULL DEFAULT 0,
  first_bundle_revenue  numeric NOT NULL DEFAULT 0,
  lifetime_recharge     numeric NOT NULL DEFAULT 0,
  initial_balance_total numeric NOT NULL DEFAULT 0,
  dealer_partner        text,
  subscription_type     text,

  -- Computed fields (set during import matching)
  matched_employee_id   uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  matched_supervisor_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  bundle_category       text,    -- '+10', '+20', '+30', '+45', '+70', '+90'
  shift_type            text CHECK (shift_type IN ('morning', 'night')),
  is_duplicate          boolean NOT NULL DEFAULT false,

  created_at            timestamptz NOT NULL DEFAULT now(),

  -- Dedup: same activation on same date at same dealer code at same timestamp
  UNIQUE (organization_id, dealer_code, activated_at)
);

CREATE INDEX idx_carrier_act_org_date ON public.carrier_activations(organization_id, activation_date);
CREATE INDEX idx_carrier_act_org_month ON public.carrier_activations(organization_id, activation_month);
CREATE INDEX idx_carrier_act_dealer ON public.carrier_activations(organization_id, dealer_code, activation_date);
CREATE INDEX idx_carrier_act_employee ON public.carrier_activations(organization_id, matched_employee_id, activation_date);
CREATE INDEX idx_carrier_act_supervisor ON public.carrier_activations(organization_id, matched_supervisor_id, activation_date);
CREATE INDEX idx_carrier_act_brand ON public.carrier_activations(organization_id, segment_brand, activation_date);
CREATE INDEX idx_carrier_act_channel ON public.carrier_activations(organization_id, channel, activation_date);
CREATE INDEX idx_carrier_act_region ON public.carrier_activations(organization_id, region, activation_date);
CREATE INDEX idx_carrier_act_import ON public.carrier_activations(import_id);
```

### 4.3 `employee_dealer_codes` — Dealer code assignments (DATE-BASED)

Since an employee can have different dealer codes on different days, this is a date-range based assignment table with a dedicated management tab in the UI.

```sql
CREATE TABLE IF NOT EXISTS public.employee_dealer_codes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  dealer_code     text NOT NULL,
  dealer_name     text,
  channel         text CHECK (channel IN ('Direct Sales', 'Modern trade')),
  region          text,
  city            text,
  location_name   text,                     -- Specific store/location
  start_date      date NOT NULL,            -- When this assignment begins
  end_date        date,                     -- NULL = still active (no end date)
  is_active       boolean NOT NULL DEFAULT true,
  notes           text,
  assigned_by     uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- An employee can be at only ONE dealer code on a given date range
  -- But same code can be reassigned to different employees on different dates
  CONSTRAINT no_overlap_dealer_code EXCLUDE USING gist (
    organization_id WITH =,
    dealer_code WITH =,
    daterange(start_date, COALESCE(end_date, '9999-12-31'::date), '[]') WITH &&
  )
);

CREATE INDEX idx_dealer_codes_org_employee
  ON public.employee_dealer_codes(organization_id, employee_id, start_date DESC);
CREATE INDEX idx_dealer_codes_org_code
  ON public.employee_dealer_codes(organization_id, dealer_code, start_date DESC);
CREATE INDEX idx_dealer_codes_active
  ON public.employee_dealer_codes(organization_id, is_active, dealer_code);
```

**Matching Logic**: When importing activations, for each row find the employee assigned to that `dealer_code` on that `activation_date`:
```sql
SELECT employee_id FROM employee_dealer_codes
WHERE organization_id = $org
  AND dealer_code = $code
  AND start_date <= $activation_date
  AND (end_date IS NULL OR end_date >= $activation_date)
  AND is_active = true
LIMIT 1;
```

### 4.4 `carrier_sales_targets` — Monthly targets (HR sets per employee)

```sql
CREATE TABLE IF NOT EXISTS public.carrier_sales_targets (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  target_month        date NOT NULL,           -- First day of month (2026-07-01)
  employee_id         uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  supervisor_id       uuid REFERENCES public.employees(id) ON DELETE SET NULL,

  -- Targets (all set by HR)
  fpe_target          integer NOT NULL DEFAULT 0,
  revenue_target      numeric NOT NULL DEFAULT 0,
  friendi_target      integer NOT NULL DEFAULT 0,
  virgin_target       integer NOT NULL DEFAULT 0,
  postpaid_target     integer NOT NULL DEFAULT 0,
  hbb_target          integer NOT NULL DEFAULT 0,
  working_days        integer NOT NULL DEFAULT 25 CHECK (working_days BETWEEN 1 AND 31),

  set_by              uuid REFERENCES auth.users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, target_month, employee_id)
);

CREATE INDEX idx_carrier_targets_org_month
  ON public.carrier_sales_targets(organization_id, target_month);
CREATE INDEX idx_carrier_targets_supervisor
  ON public.carrier_sales_targets(organization_id, supervisor_id, target_month);
```

### 4.5 `carrier_sales_verifications` — Discrepancy tracking

```sql
CREATE TABLE IF NOT EXISTS public.carrier_sales_verifications (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  import_id           uuid NOT NULL REFERENCES public.carrier_activation_imports(id) ON DELETE CASCADE,
  employee_id         uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  verification_date   date NOT NULL,

  -- What the carrier Excel says (aggregated per employee per day)
  carrier_fpe         integer NOT NULL DEFAULT 0,
  carrier_ibr         numeric NOT NULL DEFAULT 0,
  carrier_friendi     integer NOT NULL DEFAULT 0,
  carrier_virgin      integer NOT NULL DEFAULT 0,
  carrier_postpaid    integer NOT NULL DEFAULT 0,

  -- What the employee logged in our system (from sales_logs)
  logged_fpe          integer NOT NULL DEFAULT 0,
  logged_ibr          numeric NOT NULL DEFAULT 0,
  logged_friendi      integer NOT NULL DEFAULT 0,
  logged_virgin       integer NOT NULL DEFAULT 0,
  logged_postpaid     integer NOT NULL DEFAULT 0,

  -- Discrepancy analysis
  has_discrepancy     boolean NOT NULL DEFAULT false,
  discrepancy_type    text CHECK (discrepancy_type IN (
    'over_reported',    -- Employee logged more than carrier shows
    'under_reported',   -- Employee logged less than carrier shows
    'missing_log',      -- Carrier has data but employee never logged
    'extra_log'         -- Employee logged but carrier shows nothing
  )),
  fpe_difference      integer NOT NULL DEFAULT 0,   -- positive = over, negative = under
  ibr_difference      numeric NOT NULL DEFAULT 0,

  -- Visibility (NO ACTION taken — display only)
  seen_by_employee    boolean NOT NULL DEFAULT false,
  seen_by_hr          boolean NOT NULL DEFAULT false,
  seen_at_employee    timestamptz,
  seen_at_hr          timestamptz,
  employee_note       text,                         -- Employee can explain
  status              text NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open','acknowledged','resolved')),

  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, import_id, employee_id, verification_date)
);

CREATE INDEX idx_verifications_org_employee
  ON public.carrier_sales_verifications(organization_id, employee_id, verification_date DESC);
CREATE INDEX idx_verifications_org_status
  ON public.carrier_sales_verifications(organization_id, status, has_discrepancy);
CREATE INDEX idx_verifications_unseen_employee
  ON public.carrier_sales_verifications(organization_id, employee_id, seen_by_employee)
  WHERE has_discrepancy = true AND seen_by_employee = false;
```

### 4.6 `carrier_bundle_categories` — Configurable bundle tiers

```sql
CREATE TABLE IF NOT EXISTS public.carrier_bundle_categories (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  category_label  text NOT NULL,              -- '+10', '+20', '+30', '+45', '+70', '+90'
  min_value       numeric NOT NULL,           -- Minimum IBR excl VAT (inclusive)
  max_value       numeric,                    -- Maximum IBR excl VAT (exclusive, NULL = unlimited)
  display_order   integer NOT NULL DEFAULT 0,
  color           text,                       -- Hex color for chart
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, category_label)
);
```

### 4.7 `carrier_dashboard_config` — Global settings

```sql
CREATE TABLE IF NOT EXISTS public.carrier_dashboard_config (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  config_key      text NOT NULL,
  config_value    text NOT NULL,
  updated_by      uuid REFERENCES auth.users(id),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, config_key)
);

-- Default config entries:
-- ('shift_morning_start', '08:00')
-- ('shift_night_start', '16:00')       -- Flexible cutoff
-- ('verification_tolerance_percent', '5')
-- ('location_active_threshold', '100')
-- ('location_acceptable_threshold', '85')
-- ('location_warning_threshold', '70')
```

### 4.8 Employee table additions

```sql
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS gosi_registered boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gosi_number text,
  ADD COLUMN IF NOT EXISTS carrier_supervisor_id uuid REFERENCES public.employees(id);
```

---

## 5. MATCHING ENGINE (Import Logic)

### 5.1 Import Flow (when HR uploads Excel)

```
1. HR uploads .xlsx file via UI
2. API creates carrier_activation_imports record (status='processing')
3. Parse Excel using xlsx library (server-side)
4. For each row:
   a. Check for duplicate (same org + dealer_code + activated_at timestamp)
   b. If duplicate → skip, increment duplicate_rows counter
   c. Match dealer_code to employee:
      - Query employee_dealer_codes WHERE dealer_code = row.dealer_code
        AND start_date <= row.activation_date
        AND (end_date IS NULL OR end_date >= row.activation_date)
      - If found → set matched_employee_id
      - If not found → leave NULL, increment unmatched_rows
   d. Match supervisor:
      - From matched employee → look up carrier_supervisor_id
      - OR from team_leader column → match by name to employees table
   e. Compute bundle_category from ibr_value_excl_vat
   f. Compute shift_type from activated_at hour vs config cutoff
   g. INSERT into carrier_activations
5. After all rows processed:
   a. Update import record (total_rows, matched_rows, etc., status='completed')
   b. Run verification engine for all dates in this import
   c. Return summary to HR
```

### 5.2 Deduplication Strategy

The Excel is cumulative (each upload contains the full month-to-date). On re-upload:
- Use UNIQUE constraint on `(organization_id, dealer_code, activated_at)` 
- ON CONFLICT DO NOTHING — existing rows are preserved
- Only genuinely new rows get inserted
- Import record tracks: `new_rows` vs `duplicate_rows`

### 5.3 Unmatched Dealer Codes

When a dealer code in the Excel has no employee assignment:
- Store the activation anyway (matched_employee_id = NULL)
- Show in import summary: "X rows unmatched — dealer codes: DIR-XXXXX, DIR-YYYYY"
- HR can then go to dealer codes tab, assign employees, and re-run matching

### 5.4 Re-matching API

After HR assigns new dealer codes, provide a "Re-match" button that:
1. Queries all activations with matched_employee_id IS NULL for the given month
2. Re-runs the matching logic
3. Updates the records that now have valid assignments

---

## 6. VERIFICATION ENGINE

### 6.1 When It Runs

Triggered automatically after each successful import. Compares data for each date covered by the import.

### 6.2 Comparison Logic

For each (employee, date) pair in the imported data:

```
carrier_data = aggregate carrier_activations 
  WHERE matched_employee_id = employee 
  AND activation_date = date
  → { fpe, ibr, friendi_count, virgin_count, postpaid_count }

employee_log = query sales_logs 
  WHERE sales_agent_id = employee.user_id 
  AND log_date = date
  AND company_id IN (virgin_company_id, friendi_company_id)
  → { fpe, ibr, friendi_count, virgin_count, postpaid_count }

tolerance = config('verification_tolerance_percent') / 100  -- default 5%

IF abs(carrier_data.fpe - employee_log.fpe) > carrier_data.fpe * tolerance:
  → CREATE verification record with has_discrepancy = true
```

### 6.3 Discrepancy Types

| Type | Condition |
|------|-----------|
| `over_reported` | `logged_fpe > carrier_fpe * (1 + tolerance)` |
| `under_reported` | `logged_fpe < carrier_fpe * (1 - tolerance)` AND employee has a log |
| `missing_log` | Carrier has activations but employee has NO log for that date |
| `extra_log` | Employee has a log but carrier shows 0 activations |

### 6.4 What Gets Shown

**To HR** (on verification dashboard):
- Full list of discrepancies, filterable by employee, date, type
- Summary stats: X discrepancies found, Y employees affected
- No action buttons (per requirement — display only for now)

**To Employee** (on their sales dashboard):
- Notification badge: "3 days with sales differences"
- Detail view showing: "Jul 7: Carrier shows 12 FPE, you logged 15 FPE"
- Employee can add a note (optional)
- Marking as "acknowledged" just clears the badge

---

## 7. DASHBOARD PAGES (9 Pages + Settings)

All pages live under `/sales/carrier-dashboard/`. All share the same dark theme layout and filter sidebar.

### 7.1 Shared Layout

```
┌─────────────────────────────────────────────────────────────┐
│  [Logo]  Carrier Sales Dashboard    [Employee Dropdown] [👤] │
├────────┬────────────────────────────────────────────────────┤
│Filters │                                                     │
│        │                                                     │
│Employee│              MAIN CONTENT AREA                      │
│  Name  │           (varies by page)                          │
│        │                                                     │
│  S.V   │                                                     │
│        │                                                     │
│Channel │                                                     │
│□Direct │                                                     │
│□Modern │                                                     │
│        │                                                     │
│Region  │                                                     │
│□Central│                                                     │
│□Eastern│                                                     │
│□South  │                                                     │
│□Western│                                                     │
│        │                                                     │
│Date    │                                                     │
│□Jul 1  │                                                     │
│□Jul 2  │                                                     │
│...     │                                                     │
└────────┴────────────────────────────────────────────────────┘
```

**Navigation**: Tab bar or sub-nav at top switching between the 9 pages.

### 7.2 Page 1: Employee Performance (`/sales/carrier-dashboard`)

**Purpose**: Individual salesperson's daily KPI view. Matches PDF Page 1.

**Layout**:
```
┌──────────────────────────────────────────────────────────────────────┐
│  [DIR-05577 | DIR-09927 | ...]           اختر موظف (Select Employee) │
├──────────────────────┬──────────────────────┬────────────────────────┤
│      Friendi         │       Virgin         │      Postpaid          │
│ Target: 50           │ Target: 115          │ Target: 15             │
│ Achieved: 2031.7     │ Achieved: 3252.8     │ Achieved: 477.0        │
│ Remaining: 0.0       │ Remaining: 0.0       │ Remaining: 0.0         │
│                      │                      │                        │
│ Req/Day: 0.0         │ Req/Day: 0.0         │                        │
│ Average: 225.7       │ Average: 361.4       │ Average: 53.0          │
│ Expected: 5.6K       │ Expected: 9.0K       │ Expected: 1.3K         │
│ ████████░░ 4063      │ ██████████ 2828      │ ██████████ 3180        │
├──────────────────────┴──────────────────────┴────────────────────────┤
│  🔔 مستوى 180 | متبقي 0 فريندي | متبقي 0 فيرجن | متبقي 0 سويتش     │
├───────────────────────────────────────┬──────────────────────────────┤
│           تطور التحقيق (Daily Trend)  │      تفاصيل الباقات         │
│                                       │     (Bundle Quality)         │
│    860                                │  +90 ████████████████ 4.6K  │
│   /    \                              │  +10 ████████████ 2.9K      │
│  421    \     432                     │  +30 ████████ 1.4K          │
│ /   153  325/   \  296               │  +20 ██████ 1.0K            │
│           Avg: 374.5                  │  +45 █████ 0.9K             │
│  Day 0  5  10  15                     │  +70 ████ 0.8K              │
└───────────────────────────────────────┴──────────────────────────────┘
```

**Data Source**: `carrier_activations` filtered by `matched_employee_id` + date range
**Requires**: Employee selector, targets from `carrier_sales_targets`

### 7.3 Page 2: Analysis (`/sales/carrier-dashboard/analysis`)

**Purpose**: All-employees overview table + aggregate KPIs. Matches PDF Page 2.

**Layout**:
```
┌────────┬────────────┬────────────┬────────────┬──────────┐
│  FPE   │ FPE/Day(R) │ FPE Friendi│ FPE Virgin │ Postpaid │
│ 11.6K  │    826     │   7258     │   4360     │   477    │
├────────┼────────────┼────────────┼────────────┼──────────┤
│  IBR   │ IBR/Day(R) │ IBR Friendi│ IBR Virgin │  Users   │
│889.08K │    64K     │   467K     │   422K     │   151    │
├────────┴────────────┴────────────┴────────────┴──────────┤
│                                                           │
│  [Supervisor FPE Gauge]    [Supervisor Revenue Gauge]     │
│  ✅ 96.7%  ⚠️ 46.8%      ✅ 96.1%  ⚠️ 46.5%            │
│                                                           │
├───────────────────────────────────────────────────────────┤
│ Employee Name│Gosi│FPE│+10│+20│Friendi│Virgin│Post│Target │
│─────────────────────────────────────────────────────────── │
│زهرة إبراهيم │Yes │166│ 0 │ 5 │ 23.0 │96.7 │5.0 │  87   │
│منال مغبش    │Yes │142│ 0 │ 0 │ 54.5 │58.3 │9.0 │  87   │
│...           │    │   │   │   │      │     │    │       │
├───────────────────────────────────────────────────────────┤
│              Total FPE Per Day (Line Chart)                │
│    1362                                                   │
│   /    \           1023        903                        │
│  /  252 \   ...   /    \      /  \  781   Avg: 775       │
│ 699      \       /      \    /    \/                      │
│           ...  699       791                              │
│  1  2  3  4  5  6  7  8  9  10  11  12  13  14  15       │
└───────────────────────────────────────────────────────────┘
```

### 7.4 Page 3: Supervisors (`/sales/carrier-dashboard/supervisors`)

**Purpose**: Supervisor-level FPE and Revenue achievement. Matches PDF Page 3.

**Content**:
- Supervisor table: S.V | Postpaid | HBB | FPE Target MTD | FPE Ach | Rev Target MTD | Rev Ach
- Per-channel gauge pairs (2 gauges per section: FPE + Revenue)
- Daily trend chart (same as Page 2)

**Data**: Aggregate `carrier_activations` grouped by `matched_supervisor_id`

### 7.5 Page 4: KSA Overview (`/sales/carrier-dashboard/overview`)

**Purpose**: Country-wide totals and rankings. Matches PDF Page 4.

**Content**:
- Top row: FPE | IBR | Supervisors count | Employees count | Users count
- Total KSA FPE gauge (target vs achieved)
- Total KSA Revenue gauge
- Tab bar: % MTD FPE | % MTD Rev | Employees | FPE | Revenue | Users
- Horizontal bar chart ranking supervisors by selected tab metric
- Filters: City, Region, Channel, Date

### 7.6 Page 5: Bundles (`/sales/carrier-dashboard/bundles`)

**Purpose**: Package/denomination breakdown. Matches PDF Page 5.

**Content**:
- Brand filter tabs: FRiENDi Prepaid | Virgin Postpaid | Virgin Prepaid
- Denomination selector: scrollable buttons (10, 13, 17, 20, 26, 30, 40, 42, 43, 44, 45, 50...)
- Toggle: # (absolute count) | % (percentage of total)
- KPI row: FPE | IBR | Avg | Users
- Vertical bar chart: one bar per denomination value, colored by selected brand
- Split header: Direct Sales | Modern Trade | Central | Eastern | Southern | Western

**Data grouping**: Group `carrier_activations` by `ibr_value_excl_vat` rounded to nearest denomination

### 7.7 Page 6: Shifts (`/sales/carrier-dashboard/shifts`)

**Purpose**: Time-of-day activation analysis. Matches PDF Page 6.

**Content**:
- KPIs: Peak Hour (اقوى ساعة) | Employees (عدد الموظفين) | Night Activations | Morning Activations | Total
- Hourly bar chart: X-axis = hours (8AM to 2AM), bars colored red (morning) / gray (night)
- Employee efficiency ranking: horizontal bars sorted by activation count
- Location shift table: Location | Region | Morning count | Night count | Night% | Morning% | Type (صباحي/مسائي/both)

**Shift cutoff**: Read from `carrier_dashboard_config.shift_night_start` (flexible)

### 7.8 Page 7: Locations (`/sales/carrier-dashboard/locations`)

**Purpose**: Store/location coverage health. Matches PDF Page 7.

**Content**:
- KPIs: Coverage Rate (معدل التغطية) | Empty Locations (المواقع الفاضية) | Total Locations (عدد المواقع)
- Status legend with colors
- Table: Location | Region | Activations | Working Days | Coverage% | Last Activation | Days Without | Status (with arrow icon + color)
- Rows sorted by activation count DESC

**Data**: Group activations by `cas_location_name` (or `dealer_code` + `dealer_name`), count distinct dates

### 7.9 Page 8: Executive Monthly (`/sales/carrier-dashboard/executive`)

**Purpose**: Month-over-month executive summary. Matches PDF Page 8.

**Content**:
- Target achievement gauge (half-circle, shows current month activations vs monthly target)
- KPIs with MoM delta: Revenue (10.04M, -$0.00M 0.0%) | Activations (142.42K) | Users (186)
- Bundle Contribution Ranking: horizontal bars by bundle category (+90, +10, +30, +70, +45, +20)
- Regional Breakdown: bar chart (Central, Western, Southern, Eastern, Total)
- Channel Share: donut chart (Direct Sales X% | Modern Trade Y%)
- Supervisor Monthly Heatmap: table where rows=supervisors, columns=months (Jan-Jul), cells=revenue/activations with heat coloring (darker = higher)
- Top 5 Increase / Top 5 Decrease sidebar

### 7.10 Page 9: Momentum (`/sales/carrier-dashboard/momentum`)

**Purpose**: Historical trend and location rankings. Matches PDF Page 9.

**Content**:
- Same top KPIs as Page 8
- Locations Contribution Ranking: horizontal bars (toggle: Top/Bottom, count selector: 100/50/20)
- Performance Momentum: area chart with monthly data points (Jan through current month)
- Filters: Metric, Region, Channel, Segment Brand, Month

### 7.11 Settings Page (`/sales/carrier-dashboard/settings`)

**Sub-tabs**:

**A. Dealer Codes Tab** (main management interface):
- Table: Dealer Code | Employee Name | Channel | Region | Location | Start Date | End Date | Status
- "Add Assignment" button → form: select employee, enter dealer code, set dates
- "End Assignment" → sets end_date to today
- "Reassign" → ends current, creates new for different employee
- Bulk import from CSV: dealer_code, employee_name_or_id, start_date
- View unmatched codes (from imports) with quick-assign button

**B. Targets Tab**:
- Month selector
- Employee table with editable target columns: FPE | Revenue | Friendi | Virgin | Postpaid | HBB | Working Days
- Supervisor auto-sum row (read-only, sums all employees under that supervisor)
- "Copy from previous month" button
- Bulk edit: select multiple employees, set same targets

**C. Configuration Tab**:
- Shift cutoff time (time picker, default 16:00)
- Verification tolerance % (slider, default 5%)
- Location coverage thresholds (4 number inputs)
- Bundle category ranges (editable table)

### 7.12 Verification Page (`/sales/carrier-dashboard/verification`)

**HR View**:
```
┌──────────────────────────────────────────────────────────────┐
│  Verification Dashboard                                       │
│  ──────────────────────────────────────────                  │
│  Total Checks: 1,240  │  Discrepancies: 47  │  Rate: 3.8%   │
├──────────────────────────────────────────────────────────────┤
│  Filter: [Date Range] [Employee▾] [Type▾] [Status▾]         │
├──────────────────────────────────────────────────────────────┤
│ Employee      │ Date    │ Carrier│ Logged │ Diff  │ Type     │
│───────────────────────────────────────────────────────────── │
│ زهرة إبراهيم │ Jul 7   │  12    │  15    │  +3   │ over     │
│ منال مغبش    │ Jul 8   │   8    │   0    │  -8   │ missing  │
│ ...           │         │        │        │       │          │
├──────────────────────────────────────────────────────────────┤
│  [Expand row for brand-level breakdown]                      │
│  Friendi: Carrier 8, Logged 10 (+2)                          │
│  Virgin:  Carrier 4, Logged 5 (+1)                           │
└──────────────────────────────────────────────────────────────┘
```

**Employee View** (shown on their existing sales dashboard):
- Alert banner: "⚠️ 3 days with sales differences — [View Details]"
- Modal/expandable: list of dates with differences
- "Acknowledge" button per item (just marks `seen_by_employee = true`)
- Optional text field for employee explanation

---

## 8. API ENDPOINTS

### 8.1 Import & Data

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/sales/carrier-import` | HR/Admin | Upload Excel file, parse and store |
| POST | `/api/sales/carrier-import/rematch` | HR/Admin | Re-run matching for unmatched rows |
| GET | `/api/sales/carrier-import/history` | HR/Admin | List past imports with stats |
| DELETE | `/api/sales/carrier-import/:id` | Admin | Delete an import and its activations |

### 8.2 Dashboard Data

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/sales/carrier-dashboard/kpis` | Sales+ | Aggregated KPIs (with filters as query params) |
| GET | `/api/sales/carrier-dashboard/daily` | Sales+ | Daily FPE/IBR series for charts |
| GET | `/api/sales/carrier-dashboard/employees` | Manager+ | Employee performance table |
| GET | `/api/sales/carrier-dashboard/supervisors` | Manager+ | Supervisor aggregates |
| GET | `/api/sales/carrier-dashboard/bundles` | Sales+ | Bundle/denomination breakdown |
| GET | `/api/sales/carrier-dashboard/shifts` | Manager+ | Hourly distribution data |
| GET | `/api/sales/carrier-dashboard/locations` | Manager+ | Location coverage data |
| GET | `/api/sales/carrier-dashboard/executive` | Manager+ | Monthly summary data |
| GET | `/api/sales/carrier-dashboard/momentum` | Manager+ | Multi-month trend data |

**Common query params** (all optional):
- `month` — activation month (YYYY-MM)
- `date_from`, `date_to` — specific date range
- `region` — filter by region
- `channel` — filter by channel
- `supervisor_id` — filter by supervisor
- `employee_id` — filter by specific employee
- `segment_brand` — filter by brand
- `gosi_status` — filter by gosi_registered

### 8.3 Dealer Codes

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/sales/dealer-codes` | HR/Admin | List all assignments |
| POST | `/api/sales/dealer-codes` | HR/Admin | Create new assignment |
| PATCH | `/api/sales/dealer-codes/:id` | HR/Admin | Update (edit dates, deactivate) |
| DELETE | `/api/sales/dealer-codes/:id` | Admin | Remove assignment |
| POST | `/api/sales/dealer-codes/bulk` | HR/Admin | Bulk import from CSV |
| GET | `/api/sales/dealer-codes/unmatched` | HR/Admin | List codes in activations with no assignment |

### 8.4 Targets

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/sales/carrier-targets` | HR/Admin | Get targets for a month |
| POST | `/api/sales/carrier-targets` | HR/Admin | Set/update employee targets |
| POST | `/api/sales/carrier-targets/bulk` | HR/Admin | Bulk set targets |
| POST | `/api/sales/carrier-targets/copy-month` | HR/Admin | Copy previous month targets |

### 8.5 Verification

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/sales/carrier-verifications` | HR/Admin | List all verifications (with filters) |
| GET | `/api/sales/carrier-verifications/my` | Sales | Employee's own discrepancies |
| PATCH | `/api/sales/carrier-verifications/:id` | Sales/HR | Mark seen, add note, acknowledge |
| GET | `/api/sales/carrier-verifications/summary` | HR/Admin | Aggregate discrepancy stats |

---

## 9. FRONTEND COMPONENTS

### 9.1 Shared Components (reusable across pages)

| Component | File | Props | Used In |
|-----------|------|-------|---------|
| `CarrierKPICard` | `KPICard.tsx` | `{label, value, target?, remaining?, format}` | All pages |
| `CarrierGaugeChart` | `GaugeChart.tsx` | `{value, target, excellent_pct, risk_pct, label}` | P2, P3, P4, P8 |
| `DailyTrendChart` | `DailyTrendChart.tsx` | `{data: {day, value}[], avgLine?}` | P1, P2, P3 |
| `HorizontalBarChart` | `HorizontalBarChart.tsx` | `{data: {label, value, color?}[]}` | P1, P4, P5, P8, P9 |
| `HourlyDistribution` | `HourlyDistribution.tsx` | `{data: {hour, morning, night}[]}` | P6 |
| `DonutChart` | `DonutChart.tsx` | `{segments: {label, value, color}[]}` | P8 |
| `HeatmapTable` | `HeatmapTable.tsx` | `{rows, columns, getCellValue, getCellColor}` | P8 |
| `PerformanceMomentum` | `PerformanceMomentum.tsx` | `{data: {month, value}[]}` | P9 |
| `LocationStatusTable` | `LocationStatusTable.tsx` | `{locations: LocationRow[]}` | P7 |
| `FilterSidebar` | `FilterSidebar.tsx` | `{filters, onChange}` | All pages |
| `VerificationAlert` | `VerificationAlert.tsx` | `{count, onClick}` | Employee view |
| `ProgressBar` | `ProgressBar.tsx` | `{value, max, color}` | P1 |

### 9.2 Chart Library

Use **Recharts** (already installed in project):
- `LineChart` → Daily trends
- `BarChart` → Bundle analysis, hourly distribution, regional breakdown
- `PieChart` → Channel share donut
- Custom SVG → Gauge charts (Recharts doesn't have half-gauge)

### 9.3 Excel Parsing (Client or Server?)

**Server-side** using `xlsx` (SheetJS) npm package:
- Why: Files can be large (10K+ rows), don't want to parse in browser
- Parse in API route handler
- Stream rows to database in batches of 500
- Return progress percentage via response or polling

---

## 10. UI THEME & STYLING

### 10.1 Color Palette (matching Power BI screenshots)

```css
/* Dashboard background */
--carrier-bg: #1a1a2e;
--carrier-bg-card: #16213e;
--carrier-bg-card-alt: #0f3460;

/* Brand colors */
--carrier-friendi-blue: #3b82f6;     /* Blue for Friendi metrics */
--carrier-virgin-red: #ef4444;       /* Red for Virgin metrics */
--carrier-postpaid-green: #22c55e;   /* Green for Postpaid metrics */

/* Status colors */
--carrier-excellent: #22c55e;        /* Green - on target */
--carrier-risk: #f59e0b;             /* Yellow/amber - at risk */
--carrier-danger: #ef4444;           /* Red - behind */

/* Text */
--carrier-text-primary: #ffffff;
--carrier-text-secondary: #94a3b8;
--carrier-text-muted: #64748b;

/* Chart colors */
--carrier-chart-line: #ef4444;       /* Red trend line */
--carrier-chart-avg: #ef4444;        /* Dashed average line */
--carrier-chart-bar-morning: #ef4444;
--carrier-chart-bar-night: #6b7280;

/* Location status */
--carrier-status-active: #22c55e;
--carrier-status-acceptable: #f59e0b;
--carrier-status-warning: #f97316;
--carrier-status-inactive: #ef4444;
```

### 10.2 Typography

- Numbers: Bold, large (24-36px for KPIs)
- Labels: Arabic RTL, smaller (12-14px)
- Use `dir="rtl"` on Arabic text containers
- Numbers always LTR even in RTL context

### 10.3 Layout Rules

- Dashboard is full-width, no max-width constraint
- Filter sidebar: fixed 200px left panel
- Cards use CSS Grid: `grid-template-columns: repeat(auto-fit, minmax(200px, 1fr))`
- Tables are horizontally scrollable on smaller screens
- Charts maintain 16:9 aspect ratio

---

## 11. FILE STRUCTURE

```
src/
├── app/(app)/sales/carrier-dashboard/
│   ├── layout.tsx                      -- Dark theme wrapper + nav tabs + filter sidebar
│   ├── page.tsx                        -- Page 1: Employee Performance
│   ├── analysis/page.tsx               -- Page 2: Analysis
│   ├── supervisors/page.tsx            -- Page 3: Supervisor Breakdown
│   ├── overview/page.tsx               -- Page 4: KSA Overview
│   ├── bundles/page.tsx                -- Page 5: Bundle Analysis
│   ├── shifts/page.tsx                 -- Page 6: Shift Monitoring
│   ├── locations/page.tsx              -- Page 7: Location Monitoring
│   ├── executive/page.tsx              -- Page 8: Executive Monthly
│   ├── momentum/page.tsx               -- Page 9: Performance Momentum
│   ├── verification/page.tsx           -- Verification Dashboard (HR)
│   └── settings/
│       ├── page.tsx                    -- Settings layout with sub-tabs
│       ├── dealer-codes/page.tsx       -- Dealer code management
│       ├── targets/page.tsx            -- Monthly target setting
│       └── config/page.tsx             -- Global config
│
├── app/api/sales/
│   ├── carrier-import/route.ts
│   ├── carrier-import/rematch/route.ts
│   ├── carrier-import/history/route.ts
│   ├── carrier-dashboard/
│   │   ├── kpis/route.ts
│   │   ├── daily/route.ts
│   │   ├── employees/route.ts
│   │   ├── supervisors/route.ts
│   │   ├── bundles/route.ts
│   │   ├── shifts/route.ts
│   │   ├── locations/route.ts
│   │   ├── executive/route.ts
│   │   └── momentum/route.ts
│   ├── dealer-codes/route.ts
│   ├── dealer-codes/bulk/route.ts
│   ├── dealer-codes/unmatched/route.ts
│   ├── carrier-targets/route.ts
│   ├── carrier-targets/bulk/route.ts
│   ├── carrier-targets/copy-month/route.ts
│   └── carrier-verifications/route.ts
│
├── components/carrier-dashboard/
│   ├── CarrierKPICard.tsx
│   ├── CarrierGaugeChart.tsx
│   ├── DailyTrendChart.tsx
│   ├── HorizontalBarChart.tsx
│   ├── HourlyDistribution.tsx
│   ├── DonutChart.tsx
│   ├── HeatmapTable.tsx
│   ├── PerformanceMomentum.tsx
│   ├── LocationStatusTable.tsx
│   ├── FilterSidebar.tsx
│   ├── VerificationAlert.tsx
│   ├── ProgressBar.tsx
│   ├── DealerCodeTable.tsx
│   ├── TargetEditor.tsx
│   └── ImportUploader.tsx
│
├── lib/services/
│   ├── carrier-import.ts               -- Excel parse + DB insert + matching
│   ├── carrier-dashboard.ts            -- All aggregation queries
│   ├── carrier-verification.ts         -- Comparison engine
│   ├── carrier-targets.ts              -- Target CRUD
│   └── carrier-dealer-codes.ts         -- Dealer code assignment CRUD
│
└── lib/utils/
    └── carrier-kpi.ts                  -- Pure functions: bundle category calc, shift calc, etc.

db/
└── schema_v54_carrier_dashboard.sql    -- All tables, indexes, RLS policies
```

---

## 12. IMPLEMENTATION ORDER

### Phase 1: Foundation (do first, everything depends on this)

1. **Schema**: Write and apply `schema_v54_carrier_dashboard.sql` with all tables
2. **Dealer Codes UI**: Build the dealer-codes settings tab so HR can assign codes
3. **Excel Parser**: Build `carrier-import.ts` that reads .xlsx → inserts to `carrier_activations`
4. **Import API**: POST endpoint that accepts file upload, parses, matches, returns summary
5. **Matching logic**: Query `employee_dealer_codes` to set `matched_employee_id` on each activation

### Phase 2: Core Dashboard

6. **KPI API**: Build the aggregation queries (SUM, GROUP BY, etc.)
7. **Layout**: Dark theme layout with filter sidebar
8. **Page 1** (Employee view): KPI cards + daily trend + bundle quality
9. **Page 2** (Analysis): Top KPIs + employee table + daily chart

### Phase 3: Management Views

10. **Gauge component**: Custom SVG half-circle gauge
11. **Page 3** (Supervisors): Table + gauges
12. **Page 4** (KSA Overview): Totals + supervisor ranking bars
13. **Targets UI**: HR sets monthly targets per employee

### Phase 4: Operational Views

14. **Page 5** (Bundles): Denomination bar chart with brand/channel splits
15. **Page 6** (Shifts): Hourly distribution + employee efficiency
16. **Page 7** (Locations): Coverage tracking + status colors

### Phase 5: Executive Views

17. **Page 8** (Executive): Monthly gauges + heatmap + regional breakdown + donut
18. **Page 9** (Momentum): Area chart + location rankings

### Phase 6: Verification

19. **Verification engine**: Comparison logic between carrier data and sales_logs
20. **HR Verification page**: Discrepancy table with filters
21. **Employee notification**: Alert banner + detail modal on their dashboard
22. **Acknowledgment flow**: Mark seen, add notes

---

## 13. DEPENDENCIES & PACKAGES

Already installed:
- `recharts` — charts
- `@supabase/supabase-js` — database
- `lucide-react` — icons
- `date-fns` — date utilities

Need to install:
- `xlsx` (SheetJS) — server-side Excel parsing: `npm install xlsx`

---

## 14. RLS POLICIES (Summary)

| Table | SELECT | INSERT/UPDATE/DELETE |
|-------|--------|---------------------|
| `carrier_activation_imports` | Org-scoped (HR/Admin/Sales Manager) | HR/Admin only |
| `carrier_activations` | Org-scoped (all roles can read) | Service role only (via import API) |
| `employee_dealer_codes` | Org-scoped | HR/Admin |
| `carrier_sales_targets` | Org-scoped | HR/Admin |
| `carrier_sales_verifications` | Org-scoped + employee sees own | Service role creates; HR/employee update own |
| `carrier_bundle_categories` | Org-scoped | HR/Admin |
| `carrier_dashboard_config` | Org-scoped | HR/Admin |

---

## 15. EDGE CASES & NOTES

1. **Cumulative Excel**: Each upload contains full month-to-date. The UNIQUE constraint on `(org, dealer_code, activated_at)` prevents duplicates. Import should count duplicates vs new rows.

2. **Employee rotation**: An employee at DIR-05577 on Jul 1-7 may be at DIR-09927 on Jul 8-15. The date-range based assignment handles this. UI must prevent overlapping assignments for the same code.

3. **"Managed By Agencies" rows**: Modern Trade activations have team_leader = "Managed By Agencies". These still match to employees via dealer_code, but supervisor is determined from the employee's `carrier_supervisor_id` field, not from the Excel.

4. **Unmatched rows**: Always store them. They can be matched later after HR assigns the code. Show count prominently on import summary.

5. **Month boundary**: Excel filename includes the date but data is for the full month. If HR uploads on Jul 13, it contains Jul 1-12 data. Next upload on Jul 14 will contain Jul 1-13 (Jul 1-12 are duplicates, Jul 13 is new).

6. **Performance**: With 25K rows/month, queries should be fast with proper indexes. For the momentum page (multi-month), consider a materialized/cached monthly summary table if needed.

7. **Arabic names**: Employee names in the system are in Arabic. The Excel has English names in team_leader/account_manager columns. Matching supervisors requires either: (a) a name mapping table, or (b) supervisor assignment on the employee record directly (`carrier_supervisor_id`). Recommend (b).

8. **No action on verification**: Per requirement, discrepancies are display-only. No salary deduction, no warnings, no workflow. Just visibility to both parties.
