import * as XLSX from "xlsx";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBundleCategory, getShiftType, DEFAULT_BUNDLE_CATEGORIES } from "@/lib/utils/carrier-kpi";

const BATCH_SIZE = 500;

// ---------------------------------------------------------------------------
// Excel column → field mapping (0-indexed columns A=0 … AJ=35)
// ---------------------------------------------------------------------------
function parseRow(row: unknown[]): RawActivationRow {
  function str(v: unknown): string | null {
    if (v === undefined || v === null || v === "") return null;
    return String(v).trim() || null;
  }
  function num(v: unknown): number {
    const n = parseFloat(String(v));
    return isFinite(n) ? n : 0;
  }
  function int(v: unknown): number {
    return Math.round(num(v));
  }
  function dateStr(v: unknown): string | null {
    if (!v) return null;
    if (typeof v === "number") {
      // Excel serial date
      const d = XLSX.SSF.parse_date_code(v);
      if (!d) return null;
      return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
    }
    const s = String(v).trim();
    return s || null;
  }
  function tsStr(v: unknown): string | null {
    if (!v) return null;
    if (typeof v === "number") {
      const d = XLSX.SSF.parse_date_code(v);
      if (!d) return null;
      return new Date(Date.UTC(d.y, d.m - 1, d.d, d.H ?? 0, d.M ?? 0, d.S ?? 0)).toISOString();
    }
    const s = String(v).trim();
    return s || null;
  }

  return {
    activation_count:      int(row[0]),
    bundle_type:           str(row[1]),
    activation_month:      dateStr(row[2]),
    activation_date:       dateStr(row[3]) ?? "",
    region:                str(row[4]),
    city:                  str(row[5]),
    distributor_name:      str(row[6]),
    channel:               str(row[7]),
    dealer_name:           str(row[8]),
    dealer_code:           str(row[9]) ?? "",
    key_account_manager:   str(row[10]),
    account_manager:       str(row[11]),
    team_leader:           str(row[12]),
    sales_champion:        str(row[13]),
    segment_brand:         str(row[14]),
    segment_group:         str(row[15]),
    customer_nationality:  str(row[16]),
    customer_id_type:      str(row[17]),
    latitude:              num(row[18]) || null,
    longitude:             num(row[19]) || null,
    activated_at:          tsStr(row[20]),
    cas_location_id:       str(row[21]),
    cas_location_name:     str(row[22]),
    bundle_description:    str(row[23]),
    fpe_count:             int(row[24]),
    ibr_value:             num(row[25]),
    ibr_value_excl_vat:    num(row[26]),
    first_recharge_value:  num(row[27]),
    second_recharge_value: num(row[28]),
    uid_percent:           num(row[29]),
    first_bundle_qty:      int(row[30]),
    first_bundle_revenue:  num(row[31]),
    lifetime_recharge:     num(row[32]),
    initial_balance_total: num(row[33]),
    dealer_partner:        str(row[34]),
    subscription_type:     str(row[35]),
  };
}

interface RawActivationRow {
  activation_count: number;
  bundle_type: string | null;
  activation_month: string | null;
  activation_date: string;
  region: string | null;
  city: string | null;
  distributor_name: string | null;
  channel: string | null;
  dealer_name: string | null;
  dealer_code: string;
  key_account_manager: string | null;
  account_manager: string | null;
  team_leader: string | null;
  sales_champion: string | null;
  segment_brand: string | null;
  segment_group: string | null;
  customer_nationality: string | null;
  customer_id_type: string | null;
  latitude: number | null;
  longitude: number | null;
  activated_at: string | null;
  cas_location_id: string | null;
  cas_location_name: string | null;
  bundle_description: string | null;
  fpe_count: number;
  ibr_value: number;
  ibr_value_excl_vat: number;
  first_recharge_value: number;
  second_recharge_value: number;
  uid_percent: number;
  first_bundle_qty: number;
  first_bundle_revenue: number;
  lifetime_recharge: number;
  initial_balance_total: number;
  dealer_partner: string | null;
  subscription_type: string | null;
}

// ---------------------------------------------------------------------------
// Dealer code → employee lookup cache
// ---------------------------------------------------------------------------
async function buildDealerCodeMap(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  activationDates: string[]
): Promise<Map<string, { employeeId: string; supervisorId: string | null }[]>> {
  const minDate = activationDates.reduce((a, b) => (a < b ? a : b));
  const maxDate = activationDates.reduce((a, b) => (a > b ? a : b));

  const { data, error } = await admin
    .from("employee_dealer_codes")
    .select("dealer_code, employee_id, start_date, end_date")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .lte("start_date", maxDate)
    .or(`end_date.is.null,end_date.gte.${minDate}`);

  if (error) throw error;

  // Also fetch supervisor info for each employee
  const employeeIds = [...new Set((data ?? []).map((r) => r.employee_id as string))];
  let supervisorMap = new Map<string, string | null>();
  if (employeeIds.length > 0) {
    const { data: empData } = await admin
      .from("employees")
      .select("id, carrier_supervisor_id")
      .in("id", employeeIds);
    for (const emp of empData ?? []) {
      supervisorMap.set(emp.id as string, (emp.carrier_supervisor_id as string | null) ?? null);
    }
  }

  const map = new Map<string, { employeeId: string; supervisorId: string | null; startDate: string; endDate: string | null }[]>();
  for (const row of data ?? []) {
    const code = row.dealer_code as string;
    if (!map.has(code)) map.set(code, []);
    map.get(code)!.push({
      employeeId: row.employee_id as string,
      supervisorId: supervisorMap.get(row.employee_id as string) ?? null,
      startDate: row.start_date as string,
      endDate: (row.end_date as string | null) ?? null,
    });
  }
  return map as Map<string, { employeeId: string; supervisorId: string | null }[]>;
}

function matchEmployee(
  dealerCodeMap: Map<string, { employeeId: string; supervisorId: string | null; startDate: string; endDate: string | null }[]>,
  dealerCode: string,
  activationDate: string
): { employeeId: string | null; supervisorId: string | null } {
  const assignments = (dealerCodeMap as Map<string, { employeeId: string; supervisorId: string | null; startDate: string; endDate: string | null }[]>).get(dealerCode);
  if (!assignments) return { employeeId: null, supervisorId: null };
  for (const a of assignments) {
    if (a.startDate <= activationDate && (a.endDate === null || a.endDate >= activationDate)) {
      return { employeeId: a.employeeId, supervisorId: a.supervisorId };
    }
  }
  return { employeeId: null, supervisorId: null };
}

// ---------------------------------------------------------------------------
// Config loader
// ---------------------------------------------------------------------------
async function loadConfig(admin: ReturnType<typeof createAdminClient>, orgId: string): Promise<Record<string, string>> {
  const { data } = await admin
    .from("carrier_dashboard_config")
    .select("config_key, config_value")
    .eq("organization_id", orgId);
  const cfg: Record<string, string> = {
    shift_night_start: "16:00",
  };
  for (const row of data ?? []) {
    cfg[row.config_key as string] = row.config_value as string;
  }
  return cfg;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------
export interface ImportResult {
  importId: string;
  totalRows: number;
  newRows: number;
  duplicateRows: number;
  matchedRows: number;
  unmatchedRows: number;
  unmatchedCodes: string[];
  dateRangeStart: string;
  dateRangeEnd: string;
}

export async function processCarrierExcel(
  fileBuffer: ArrayBuffer,
  fileName: string,
  orgId: string,
  uploadedBy: string
): Promise<ImportResult> {
  const admin = createAdminClient();

  // Parse workbook
  const workbook = XLSX.read(fileBuffer, { type: "array", cellDates: false });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rawRows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

  // Skip header row
  const dataRows = rawRows.slice(1).filter((r) => r && (r as unknown[]).some((c) => c !== null));
  if (dataRows.length === 0) throw new Error("No data rows found in Excel file");

  const rows = dataRows.map((r) => parseRow(r as unknown[]));

  // Collect all activation dates for building the dealer-code map
  const allDates = [...new Set(rows.map((r) => r.activation_date).filter(Boolean))];
  const dateRangeStart = allDates.reduce((a, b) => (a < b ? a : b));
  const dateRangeEnd = allDates.reduce((a, b) => (a > b ? a : b));

  // Derive activation month from first date
  const activationMonth = dateRangeStart.slice(0, 7) + "-01";

  // Create import record
  const { data: importRec, error: importErr } = await admin
    .from("carrier_activation_imports")
    .insert({
      organization_id: orgId,
      file_name: fileName,
      activation_month: activationMonth,
      date_range_start: dateRangeStart,
      date_range_end: dateRangeEnd,
      total_rows: rows.length,
      status: "processing",
      uploaded_by: uploadedBy,
    })
    .select("id")
    .single();
  if (importErr) throw importErr;
  const importId = importRec.id as string;

  // Load config + build dealer code map
  const [config, dealerCodeMap] = await Promise.all([
    loadConfig(admin, orgId),
    buildDealerCodeMap(admin, orgId, allDates),
  ]);
  const nightStart = config.shift_night_start ?? "16:00";

  // Process rows in batches
  let newRows = 0;
  let duplicateRows = 0;
  let matchedRows = 0;
  const unmatchedCodeSet = new Set<string>();

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    const insertRows = batch.map((row) => {
      const { employeeId, supervisorId } = matchEmployee(
        dealerCodeMap as Map<string, { employeeId: string; supervisorId: string | null; startDate: string; endDate: string | null }[]>,
        row.dealer_code,
        row.activation_date
      );
      if (employeeId) {
        matchedRows++;
      } else {
        unmatchedCodeSet.add(row.dealer_code);
      }

      const bundleCategory = getBundleCategory(row.ibr_value_excl_vat, DEFAULT_BUNDLE_CATEGORIES);
      const shiftType = getShiftType(row.activated_at, nightStart);

      return {
        organization_id: orgId,
        import_id: importId,
        activation_count: row.activation_count,
        bundle_type: row.bundle_type,
        activation_month: row.activation_month,
        activation_date: row.activation_date,
        region: row.region,
        city: row.city,
        distributor_name: row.distributor_name,
        channel: row.channel,
        dealer_name: row.dealer_name,
        dealer_code: row.dealer_code,
        key_account_manager: row.key_account_manager,
        account_manager: row.account_manager,
        team_leader: row.team_leader,
        sales_champion: row.sales_champion,
        segment_brand: row.segment_brand,
        segment_group: row.segment_group,
        customer_nationality: row.customer_nationality,
        customer_id_type: row.customer_id_type,
        latitude: row.latitude,
        longitude: row.longitude,
        activated_at: row.activated_at,
        cas_location_id: row.cas_location_id,
        cas_location_name: row.cas_location_name,
        bundle_description: row.bundle_description,
        fpe_count: row.fpe_count,
        ibr_value: row.ibr_value,
        ibr_value_excl_vat: row.ibr_value_excl_vat,
        first_recharge_value: row.first_recharge_value,
        second_recharge_value: row.second_recharge_value,
        uid_percent: row.uid_percent,
        first_bundle_qty: row.first_bundle_qty,
        first_bundle_revenue: row.first_bundle_revenue,
        lifetime_recharge: row.lifetime_recharge,
        initial_balance_total: row.initial_balance_total,
        dealer_partner: row.dealer_partner,
        subscription_type: row.subscription_type,
        matched_employee_id: employeeId,
        matched_supervisor_id: supervisorId,
        bundle_category: bundleCategory,
        shift_type: shiftType,
        is_duplicate: false,
      };
    });

    const { error: insertErr, count } = await admin
      .from("carrier_activations")
      .upsert(insertRows, { onConflict: "organization_id,dealer_code,activated_at", ignoreDuplicates: true })
      .select("id");

    if (insertErr) {
      // Update import as failed
      await admin
        .from("carrier_activation_imports")
        .update({ status: "failed", error_message: insertErr.message, updated_at: new Date().toISOString() })
        .eq("id", importId);
      throw insertErr;
    }

    const inserted = count ?? 0;
    newRows += inserted;
    duplicateRows += batch.length - inserted;
  }

  const unmatchedRows = rows.filter((r) => unmatchedCodeSet.has(r.dealer_code)).length;

  // Update import record
  await admin
    .from("carrier_activation_imports")
    .update({
      total_rows: rows.length,
      new_rows: newRows,
      duplicate_rows: duplicateRows,
      matched_rows: matchedRows,
      unmatched_rows: unmatchedRows,
      status: "completed",
      updated_at: new Date().toISOString(),
    })
    .eq("id", importId);

  return {
    importId,
    totalRows: rows.length,
    newRows,
    duplicateRows,
    matchedRows,
    unmatchedRows,
    unmatchedCodes: [...unmatchedCodeSet],
    dateRangeStart,
    dateRangeEnd,
  };
}

// ---------------------------------------------------------------------------
// Re-matching: update unmatched activations after HR assigns dealer codes
// ---------------------------------------------------------------------------
export async function rematchActivations(
  orgId: string,
  month: string
): Promise<{ updated: number }> {
  const admin = createAdminClient();

  const { data: unmatched, error } = await admin
    .from("carrier_activations")
    .select("id, dealer_code, activation_date")
    .eq("organization_id", orgId)
    .is("matched_employee_id", null)
    .gte("activation_date", month + "-01")
    .lt("activation_date", nextMonth(month) + "-01");

  if (error) throw error;
  if (!unmatched || unmatched.length === 0) return { updated: 0 };

  const dates = [...new Set(unmatched.map((r) => r.activation_date as string))];
  const dealerCodeMap = await buildDealerCodeMap(admin, orgId, dates);

  let updated = 0;
  for (const row of unmatched) {
    const { employeeId, supervisorId } = matchEmployee(
      dealerCodeMap as Map<string, { employeeId: string; supervisorId: string | null; startDate: string; endDate: string | null }[]>,
      row.dealer_code as string,
      row.activation_date as string
    );
    if (!employeeId) continue;

    await admin
      .from("carrier_activations")
      .update({ matched_employee_id: employeeId, matched_supervisor_id: supervisorId })
      .eq("id", row.id as string);
    updated++;
  }

  return { updated };
}

function nextMonth(yyyyMm: string): string {
  const [y, m] = yyyyMm.split("-").map(Number);
  if (m === 12) return `${y + 1}-01`;
  return `${y}-${String(m + 1).padStart(2, "0")}`;
}
