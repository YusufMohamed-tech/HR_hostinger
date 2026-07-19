import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { readSheet } from "read-excel-file/node";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBundleCategory, getShiftType, DEFAULT_BUNDLE_CATEGORIES } from "@/lib/utils/carrier-kpi";
import { runVerification } from "@/lib/services/carrier-verification";
import { zonedDateTimeToUtc } from "@/lib/business-time";

const BATCH_SIZE = 500;
export const MAX_CARRIER_IMPORT_BYTES = 10 * 1024 * 1024;
const MAX_CARRIER_IMPORT_ROWS = 50_000;
const CARRIER_COLUMN_COUNT = 36;
export const CARRIER_CONTRACT_VERSION = "virgin-friendi-activation-v1";

const EXPECTED_HEADERS = [
  "activation_count",
  "bundle_type",
  "activation_month",
  "activation_date",
  "region",
  "city",
  "distributor_name",
  "channel",
  "dealer_name",
  "dealer_code",
  "key_account_manager",
  "account_manager",
  "team_leader",
  "sales_champion",
  "segment_brand",
  "segment_group",
  "customer_nationality",
  "customer_id_type",
  "latitude",
  "longitude",
  "activated_at",
  "cas_location_id",
  "cas_location_name",
  "bundle_description",
  "fpe_count",
  "ibr_value",
  "ibr_value_excl_vat",
  "first_recharge_value",
  "second_recharge_value",
  "uid_percent",
  "first_bundle_qty",
  "first_bundle_revenue",
  "lifetime_recharge",
  "initial_balance_total",
  "dealer_partner",
  "subscription_type",
] as const;

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "");
}

function columnName(index: number): string {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function validateHeaders(headerRow: unknown[]) {
  if (headerRow.length < CARRIER_COLUMN_COUNT) {
    throw new Error(`Carrier workbook must contain ${CARRIER_COLUMN_COUNT} columns (A–AJ); found ${headerRow.length}.`);
  }

  const mismatches: string[] = [];
  for (let index = 0; index < CARRIER_COLUMN_COUNT; index++) {
    const actual = normalizeHeader(headerRow[index]);
    const expected = normalizeHeader(EXPECTED_HEADERS[index]);
    if (actual !== expected) {
      mismatches.push(`${columnName(index)}: expected ${EXPECTED_HEADERS[index]}, found ${String(headerRow[index] ?? "blank")}`);
    }
  }

  if (mismatches.length > 0) {
    throw new Error(`Carrier workbook headers do not match the v1 contract. ${mismatches.slice(0, 8).join("; ")}`);
  }
}

function excelSerialToParts(value: number) {
  if (!Number.isFinite(value) || value <= 0) return null;
  const wholeDays = Math.floor(value);
  const milliseconds = Math.round((value - wholeDays) * 86_400_000);
  const date = new Date(Date.UTC(1899, 11, 30 + wholeDays) + milliseconds);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
  };
}

function dateParts(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return {
      year: value.getFullYear(),
      month: value.getMonth() + 1,
      day: value.getDate(),
      hour: value.getHours(),
      minute: value.getMinutes(),
      second: value.getSeconds(),
    };
  }
  if (typeof value === "number") return excelSerialToParts(value);

  const text = String(value ?? "").trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/u.exec(text);
  if (iso) {
    return {
      year: Number(iso[1]),
      month: Number(iso[2]),
      day: Number(iso[3]),
      hour: Number(iso[4] ?? 0),
      minute: Number(iso[5] ?? 0),
      second: Number(iso[6] ?? 0),
    };
  }

  const dayFirst = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/u.exec(text);
  if (dayFirst) {
    return {
      year: Number(dayFirst[3]),
      month: Number(dayFirst[2]),
      day: Number(dayFirst[1]),
      hour: Number(dayFirst[4] ?? 0),
      minute: Number(dayFirst[5] ?? 0),
      second: Number(dayFirst[6] ?? 0),
    };
  }
  return null;
}

function validParts(parts: ReturnType<typeof dateParts>) {
  if (!parts) return false;
  const instant = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second));
  return instant.getUTCFullYear() === parts.year
    && instant.getUTCMonth() + 1 === parts.month
    && instant.getUTCDate() === parts.day
    && parts.hour >= 0 && parts.hour <= 23
    && parts.minute >= 0 && parts.minute <= 59
    && parts.second >= 0 && parts.second <= 59;
}

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
    return Number.isFinite(n) ? n : Number.NaN;
  }
  function int(v: unknown): number {
    return Math.round(num(v));
  }
  function dateStr(v: unknown): string | null {
    if (!v) return null;
    const parts = dateParts(v);
    if (!validParts(parts) || !parts) return null;
    return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  }
  function tsStr(v: unknown): string | null {
    if (!v) return null;
    const parts = dateParts(v);
    if (!validParts(parts) || !parts) return null;
    return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}:${String(parts.second).padStart(2, "0")}`;
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

function validateActivationRows(rows: RawActivationRow[]) {
  const errorsByRow = rows.map(() => [] as string[]);
  const allowedChannels = new Set(["Direct Sales", "Modern trade"]);
  const allowedBrands = new Set(["Virgin Mobile", "FRiENDi mobile"]);
  const nonnegativeFields: Array<keyof RawActivationRow> = [
    "activation_count",
    "fpe_count",
    "ibr_value",
    "ibr_value_excl_vat",
    "first_recharge_value",
    "second_recharge_value",
    "uid_percent",
    "first_bundle_qty",
    "first_bundle_revenue",
    "lifetime_recharge",
    "initial_balance_total",
  ];

  for (const [index, row] of rows.entries()) {
    const rowErrors = errorsByRow[index];
    if (!row.activation_date) rowErrors.push("activation_date is required and must be a valid date");
    if (!row.activated_at) rowErrors.push("activated_at is required and must be a valid timestamp");
    if (!row.dealer_code || row.dealer_code.length > 128) rowErrors.push("dealer_code is required and must be at most 128 characters");
    if (!Number.isInteger(row.activation_count) || row.activation_count <= 0 || row.activation_count > 1_000_000) {
      rowErrors.push("activation_count must be an integer between 1 and 1,000,000");
    }
    if (row.channel && !allowedChannels.has(row.channel)) rowErrors.push(`unsupported channel: ${row.channel}`);
    if (row.segment_brand && !allowedBrands.has(row.segment_brand)) rowErrors.push(`unsupported segment_brand: ${row.segment_brand}`);
    if (row.latitude !== null && (row.latitude < -90 || row.latitude > 90)) rowErrors.push("latitude must be between -90 and 90");
    if (row.longitude !== null && (row.longitude < -180 || row.longitude > 180)) rowErrors.push("longitude must be between -180 and 180");

    for (const field of nonnegativeFields) {
      const value = Number(row[field]);
      if (!Number.isFinite(value) || value < 0 || value > 1_000_000_000) {
        rowErrors.push(`${field} must be between 0 and 1,000,000,000`);
      }
    }

    if (row.activation_date) {
      const businessMonth = row.activation_date.slice(0, 7);
      if (row.activation_month && row.activation_month.slice(0, 7) !== businessMonth) {
        rowErrors.push("activation_month does not match activation_date");
      }
      row.activation_month = `${businessMonth}-01`;
    }
  }

  const months = new Set(rows.map((row) => row.activation_date.slice(0, 7)).filter((month) => /^\d{4}-\d{2}$/u.test(month)));
  if (months.size > 1) {
    const error = `Workbook contains multiple activation months: ${Array.from(months).join(", ")}`;
    for (const rowErrors of errorsByRow) rowErrors.push(error);
  }
  return errorsByRow;
}

// ---------------------------------------------------------------------------
// Dealer code → employee lookup cache
// ---------------------------------------------------------------------------
async function buildDealerCodeMap(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
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
  const employeeIds = Array.from(new Set((data ?? []).map((r: { employee_id: string }) => r.employee_id)));
  const supervisorMap = new Map<string, string | null>();
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadConfig(admin: any, orgId: string): Promise<Record<string, string>> {
  const { data, error } = await admin
    .from("carrier_dashboard_config")
    .select("config_key, config_value")
    .eq("organization_id", orgId);
  if (error) throw error;
  const cfg: Record<string, string> = {
    shift_night_start: "16:00",
  };
  for (const row of data ?? []) {
    cfg[row.config_key as string] = row.config_value as string;
  }
  return cfg;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadOrganizationTimezone(admin: any, orgId: string) {
  const { data, error } = await admin.from("organization_settings").select("timezone")
    .eq("org_id", orgId).maybeSingle();
  if (error) throw error;
  return String(data?.timezone || "UTC");
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------
export interface ImportResult {
  importId: string;
  status: string;
  contractVersion: string;
  fileSha256: string;
  totalRows: number;
  newRows: number;
  duplicateRows: number;
  rejectedRows: number;
  matchedRows: number;
  unmatchedRows: number;
  unmatchedCodes: string[];
  dateRangeStart: string;
  dateRangeEnd: string;
}

function deterministicUuid(scope: string) {
  const hash = createHash("sha256").update(scope).digest("hex").slice(0, 32);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20)}`;
}

function firstRecord(value: unknown) {
  const record = Array.isArray(value) ? value[0] : value;
  if (!record || typeof record !== "object") throw new Error("Carrier import command returned no record.");
  return record as Record<string, unknown>;
}

function resultFromImport(record: Record<string, unknown>, unmatchedCodes: string[] = []): ImportResult {
  return {
    importId: String(record.id),
    status: String(record.status),
    contractVersion: String(record.contract_version || CARRIER_CONTRACT_VERSION),
    fileSha256: String(record.file_sha256 || ""),
    totalRows: Number(record.total_rows || 0),
    newRows: Number(record.new_rows || 0),
    duplicateRows: Number(record.duplicate_rows || 0),
    rejectedRows: Number(record.rejected_rows || 0),
    matchedRows: Number(record.matched_rows || 0),
    unmatchedRows: Number(record.unmatched_rows || 0),
    unmatchedCodes,
    dateRangeStart: String(record.date_range_start || ""),
    dateRangeEnd: String(record.date_range_end || ""),
  };
}

export async function processCarrierExcel(
  fileBuffer: ArrayBuffer,
  fileName: string,
  orgId: string,
  uploadedBy: string,
  options: { commandId?: string; requestId?: string } = {}
): Promise<ImportResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  if (fileBuffer.byteLength > MAX_CARRIER_IMPORT_BYTES) {
    throw new Error(`Carrier workbook exceeds the ${MAX_CARRIER_IMPORT_BYTES / 1024 / 1024} MB limit.`);
  }

  const parsedWorkbook = await readSheet(Buffer.from(fileBuffer));
  const rawRows = parsedWorkbook as unknown[][];
  if (rawRows.length === 0) throw new Error("Carrier workbook does not contain a worksheet.");
  validateHeaders(rawRows[0]);

  // Skip header row
  const dataRows = rawRows.slice(1).filter((r) => r && (r as unknown[]).some((c) => c !== null));
  if (dataRows.length === 0) throw new Error("No data rows found in Excel file");
  if (dataRows.length > MAX_CARRIER_IMPORT_ROWS) {
    throw new Error(`Carrier workbook exceeds the ${MAX_CARRIER_IMPORT_ROWS.toLocaleString()} row limit.`);
  }

  const rows = dataRows.map((r) => parseRow(r as unknown[]));
  const validationErrors = validateActivationRows(rows);
  const syntacticallyValidDates = rows.map((row) => row.activation_date)
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/u.test(date));
  const fallbackDate = new Date().toISOString().slice(0, 10);
  const firstDate = syntacticallyValidDates[0] || fallbackDate;
  const activationMonthKey = firstDate.slice(0, 7);
  const contractDates = syntacticallyValidDates.filter((date) => date.startsWith(`${activationMonthKey}-`));
  const dateRangeStart = contractDates.length > 0 ? contractDates.reduce((a, b) => (a < b ? a : b)) : firstDate;
  const dateRangeEnd = contractDates.length > 0 ? contractDates.reduce((a, b) => (a > b ? a : b)) : firstDate;
  const activationMonth = `${activationMonthKey}-01`;
  const fileSha256 = createHash("sha256").update(Buffer.from(fileBuffer)).digest("hex");
  const commandId = options.commandId || randomUUID();
  const requestId = options.requestId || randomUUID();
  const publishCommandId = deterministicUuid(`${commandId}:publish`);
  const failCommandId = deterministicUuid(`${commandId}:fail`);

  const begin = await admin.rpc("begin_carrier_import", {
    p_org_id: orgId,
    p_actor_user_id: uploadedBy,
    p_command_id: commandId,
    p_request_id: requestId,
    p_file_name: fileName,
    p_file_sha256: fileSha256,
    p_contract_version: CARRIER_CONTRACT_VERSION,
    p_activation_month: activationMonth,
    p_date_range_start: dateRangeStart,
    p_date_range_end: dateRangeEnd,
    p_total_rows: rows.length,
  });
  if (begin.error) throw begin.error;
  const importRecord = firstRecord(begin.data);
  const importId = String(importRecord.id);
  if (String(importRecord.status) !== "processing") return resultFromImport(importRecord);

  try {
    const validDates = rows.filter((_, index) => validationErrors[index].length === 0)
      .map((row) => row.activation_date);
    const [config, dealerCodeMap, organizationTimezone] = await Promise.all([
      loadConfig(admin, orgId),
      validDates.length > 0 ? buildDealerCodeMap(admin, orgId, validDates) : Promise.resolve(new Map()),
      loadOrganizationTimezone(admin, orgId),
    ]);
    const nightStart = config.shift_night_start ?? "16:00";
    const unmatchedCodeSet = new Set<string>();
    const stagedRows = rows.map((row, index) => {
      const isValid = validationErrors[index].length === 0;
      const match = isValid ? matchEmployee(
        dealerCodeMap as Map<string, { employeeId: string; supervisorId: string | null; startDate: string; endDate: string | null }[]>,
        row.dealer_code,
        row.activation_date
      ) : { employeeId: null, supervisorId: null };
      if (isValid && !match.employeeId) unmatchedCodeSet.add(row.dealer_code);
      const sourcePayload = JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
      const payload = {
        ...row,
        activated_at: isValid && row.activated_at
          ? zonedDateTimeToUtc(row.activated_at, organizationTimezone).toISOString() : row.activated_at,
        bundle_category: isValid ? getBundleCategory(row.ibr_value_excl_vat, DEFAULT_BUNDLE_CATEGORIES) : null,
        shift_type: isValid ? getShiftType(row.activated_at, nightStart) : null,
      };
      const sanitizedPayload = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
      return {
        organization_id: orgId,
        import_id: importId,
        row_number: index + 2,
        source_row_hash: createHash("sha256").update(JSON.stringify(sourcePayload)).digest("hex"),
        payload: sanitizedPayload,
        validation_errors: validationErrors[index],
        matched_employee_id: match.employeeId,
        matched_supervisor_id: match.supervisorId,
      };
    });
    for (let index = 0; index < stagedRows.length; index += BATCH_SIZE) {
      const { error } = await admin.from("carrier_import_staging")
        .upsert(stagedRows.slice(index, index + BATCH_SIZE), { onConflict: "import_id,row_number" });
      if (error) throw error;
    }
    const published = await admin.rpc("publish_carrier_import", {
      p_org_id: orgId,
      p_actor_user_id: uploadedBy,
      p_command_id: publishCommandId,
      p_request_id: requestId,
      p_import_id: importId,
    });
    if (published.error) throw published.error;
    const publishedRecord = firstRecord(published.data);

    if (["completed", "partial"].includes(String(publishedRecord.status))) {
      await runVerification(orgId, importId, uploadedBy, requestId);
    }
    return resultFromImport(publishedRecord, Array.from(unmatchedCodeSet).sort());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Carrier import failed.";
    const failed = await admin.rpc("fail_carrier_import", {
      p_org_id: orgId,
      p_actor_user_id: uploadedBy,
      p_command_id: failCommandId,
      p_request_id: requestId,
      p_import_id: importId,
      p_error_message: message,
    });
    if (failed.error && !String(failed.error.message || "").includes("no longer processing")) throw failed.error;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Re-matching: update unmatched activations after HR assigns dealer codes
// ---------------------------------------------------------------------------
export async function rematchActivations(
  orgId: string,
  month: string,
  actorUserId: string,
  requestId: string
): Promise<{ updated: number }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data, error } = await admin.rpc("rematch_carrier_activations", {
    p_org_id: orgId,
    p_actor_user_id: actorUserId,
    p_request_id: requestId,
    p_month: `${month}-01`,
  });
  if (error) throw new Error(error.message);
  return { updated: Number(data || 0) };
}
