import { createAdminClient } from "@/lib/supabase/admin";

export interface DashboardFilters {
  orgId: string;
  month?: string;
  dateFrom?: string;
  dateTo?: string;
  region?: string;
  channel?: string;
  supervisorId?: string;
  employeeId?: string;
  segmentBrand?: string;
  gosiStatus?: "registered" | "unregistered";
  workingDays?: number;
}

export interface CarrierKPIs {
  fpe: number;
  fpeFriendi: number;
  fpeVirgin: number;
  postpaid: number;
  hbb: number;
  ibr: number;
  ibrFriendi: number;
  ibrVirgin: number;
  users: number;
  employees: number;
  activationsTotal: number;
}

export interface DailyDataPoint {
  date: string;
  fpe: number;
  ibr: number;
  friendi: number;
  virgin: number;
  postpaid: number;
}

export interface EmployeePerformanceRow {
  employeeId: string;
  employeeName: string;
  gosiRegistered: boolean;
  fpe: number;
  fpeFriendi: number;
  fpeVirgin: number;
  postpaid: number;
  hbb: number;
  ibr: number;
  bundleCounts: Record<string, number>;
  fpeTarget: number | null;
  revenueTarget: number | null;
}

export interface SupervisorRow {
  supervisorId: string;
  supervisorName: string;
  fpe: number;
  ibr: number;
  postpaid: number;
  hbb: number;
  fpeTarget: number | null;
  revenueTarget: number | null;
  employeeCount: number;
}

export interface BundleBreakdownRow {
  bundleCategory: string;
  count: number;
  ibr: number;
  channel: string | null;
  region: string | null;
}

export interface HourlyPoint {
  hour: number;
  morning: number;
  night: number;
}

export interface LocationRow {
  locationName: string;
  dealerCode: string;
  region: string | null;
  channel: string | null;
  totalActivations: number;
  daysWithActivations: number;
  lastActivationDate: string | null;
  coveragePercent: number;
  status: "active" | "acceptable" | "warning" | "inactive";
}

export interface CarrierCompleteness {
  importIds: string[];
  importCount: number;
  sourceTotalRows: number;
  publishedRows: number;
  duplicateRows: number;
  rejectedRows: number;
  matchedRows: number;
  unmatchedRows: number;
  filteredRowCount: number;
  controlFpe: number;
  dateRangeStart: string;
  dateRangeEnd: string;
  refreshedAt: string | null;
  complete: boolean;
}

export interface CarrierDashboardSnapshot {
  kpis: CarrierKPIs;
  daily: DailyDataPoint[];
  employees: EmployeePerformanceRow[];
  supervisors: SupervisorRow[];
  bundles: BundleBreakdownRow[];
  shifts: HourlyPoint[];
  locations: LocationRow[];
  completeness: CarrierCompleteness;
}

function rpcClient() {
  // Carrier schema is newer than the generated client declaration in some deployments.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createAdminClient() as any;
}

function rpcFilters(filters: DashboardFilters) {
  return {
    month: filters.month || null,
    dateFrom: filters.dateFrom || null,
    dateTo: filters.dateTo || null,
    region: filters.region || null,
    channel: filters.channel || null,
    supervisorId: filters.supervisorId || null,
    employeeId: filters.employeeId || null,
    segmentBrand: filters.segmentBrand || null,
    gosiStatus: filters.gosiStatus || null,
    workingDays: filters.workingDays || null,
  };
}

export async function getCarrierDashboardSnapshot(filters: DashboardFilters): Promise<CarrierDashboardSnapshot> {
  const { data, error } = await rpcClient().rpc("carrier_dashboard_snapshot", {
    p_org_id: filters.orgId,
    p_filters: rpcFilters(filters),
  });
  if (error) throw new Error(error.message);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Carrier dashboard aggregation returned an invalid snapshot.");
  }
  return data as CarrierDashboardSnapshot;
}

export async function getCarrierKPIs(filters: DashboardFilters) {
  return (await getCarrierDashboardSnapshot(filters)).kpis;
}

export async function getDailySeries(filters: DashboardFilters) {
  return (await getCarrierDashboardSnapshot(filters)).daily;
}

export async function getEmployeePerformance(filters: DashboardFilters) {
  const snapshot = await getCarrierDashboardSnapshot(filters);
  return filters.gosiStatus
    ? snapshot.employees.filter((employee) => employee.gosiRegistered === (filters.gosiStatus === "registered"))
    : snapshot.employees;
}

export async function getSupervisorPerformance(filters: DashboardFilters) {
  return (await getCarrierDashboardSnapshot(filters)).supervisors;
}

export async function getBundleBreakdown(filters: DashboardFilters) {
  return (await getCarrierDashboardSnapshot(filters)).bundles;
}

export async function getShiftDistribution(filters: DashboardFilters) {
  return (await getCarrierDashboardSnapshot(filters)).shifts;
}

export async function getLocationCoverage(filters: DashboardFilters, totalWorkingDays: number) {
  return (await getCarrierDashboardSnapshot({ ...filters, workingDays: totalWorkingDays })).locations;
}

export async function getImportHistory(orgId: string) {
  const { data, error } = await rpcClient()
    .from("carrier_activation_imports")
    .select("id, file_name, contract_version, file_sha256, activation_month, date_range_start, date_range_end, total_rows, staged_rows, new_rows, duplicate_rows, rejected_rows, matched_rows, unmatched_rows, status, error_message, published_at, created_at, updated_at")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return data ?? [];
}
