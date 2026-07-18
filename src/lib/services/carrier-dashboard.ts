import { createAdminClient } from "@/lib/supabase/admin";

export interface DashboardFilters {
  orgId: string;
  month?: string;           // "YYYY-MM"
  dateFrom?: string;        // "YYYY-MM-DD"
  dateTo?: string;
  region?: string;
  channel?: string;
  supervisorId?: string;
  employeeId?: string;
  segmentBrand?: string;
  gosiStatus?: "registered" | "unregistered";
}

function buildActivationFilter(
  query: ReturnType<typeof createAdminClient>["from"] extends (t: string) => infer Q ? Q : never,
  filters: DashboardFilters
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = query as any;
  q = q.eq("organization_id", filters.orgId);
  if (filters.dateFrom) q = q.gte("activation_date", filters.dateFrom);
  if (filters.dateTo) q = q.lte("activation_date", filters.dateTo);
  if (!filters.dateFrom && filters.month) {
    const [y, m] = filters.month.split("-").map(Number);
    const nextM = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
    q = q.gte("activation_date", `${filters.month}-01`).lt("activation_date", `${nextM}-01`);
  }
  if (filters.region) q = q.eq("region", filters.region);
  if (filters.channel) q = q.eq("channel", filters.channel);
  if (filters.supervisorId) q = q.eq("matched_supervisor_id", filters.supervisorId);
  if (filters.employeeId) q = q.eq("matched_employee_id", filters.employeeId);
  if (filters.segmentBrand) q = q.eq("segment_brand", filters.segmentBrand);
  return q;
}

// ---------------------------------------------------------------------------
// Top-level KPIs
// ---------------------------------------------------------------------------
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

export async function getCarrierKPIs(filters: DashboardFilters): Promise<CarrierKPIs> {
  const admin = createAdminClient();
  const { data, error } = await buildActivationFilter(
    admin.from("carrier_activations").select(
      "fpe_count, ibr_value, segment_brand, segment_group, dealer_code, matched_employee_id"
    ),
    filters
  );
  if (error) throw error;

  const rows = (data ?? []) as {
    fpe_count: number;
    ibr_value: number;
    segment_brand: string | null;
    segment_group: string | null;
    dealer_code: string;
    matched_employee_id: string | null;
  }[];

  let fpe = 0, fpeFriendi = 0, fpeVirgin = 0, postpaid = 0, hbb = 0;
  let ibr = 0, ibrFriendi = 0, ibrVirgin = 0;
  const dealerCodes = new Set<string>();
  const employeeIds = new Set<string>();

  for (const r of rows) {
    fpe += r.fpe_count;
    ibr += r.ibr_value;
    dealerCodes.add(r.dealer_code);
    if (r.matched_employee_id) employeeIds.add(r.matched_employee_id);

    if (r.segment_brand === "FRiENDi mobile") {
      fpeFriendi += r.fpe_count;
      ibrFriendi += r.ibr_value;
    } else if (r.segment_brand === "Virgin Mobile") {
      ibrVirgin += r.ibr_value;
      if (r.segment_group === "Virgin Prepaid") fpeVirgin += r.fpe_count;
      if (r.segment_group === "Virgin Postpaid") postpaid++;
      if (r.segment_group === "Virgin HBB") hbb++;
    }
  }

  return {
    fpe,
    fpeFriendi,
    fpeVirgin,
    postpaid,
    hbb,
    ibr,
    ibrFriendi,
    ibrVirgin,
    users: dealerCodes.size,
    employees: employeeIds.size,
    activationsTotal: rows.length,
  };
}

// ---------------------------------------------------------------------------
// Daily series for trend charts
// ---------------------------------------------------------------------------
export interface DailyDataPoint {
  date: string;
  fpe: number;
  ibr: number;
  friendi: number;
  virgin: number;
  postpaid: number;
}

export async function getDailySeries(filters: DashboardFilters): Promise<DailyDataPoint[]> {
  const admin = createAdminClient();
  const { data, error } = await buildActivationFilter(
    admin.from("carrier_activations").select(
      "activation_date, fpe_count, ibr_value, segment_brand, segment_group"
    ),
    filters
  );
  if (error) throw error;

  const byDate = new Map<string, DailyDataPoint>();
  for (const r of (data ?? []) as { activation_date: string; fpe_count: number; ibr_value: number; segment_brand: string | null; segment_group: string | null }[]) {
    let point = byDate.get(r.activation_date);
    if (!point) {
      point = { date: r.activation_date, fpe: 0, ibr: 0, friendi: 0, virgin: 0, postpaid: 0 };
      byDate.set(r.activation_date, point);
    }
    point.fpe += r.fpe_count;
    point.ibr += r.ibr_value;
    if (r.segment_brand === "FRiENDi mobile") point.friendi += r.fpe_count;
    if (r.segment_brand === "Virgin Mobile" && r.segment_group === "Virgin Prepaid") point.virgin += r.fpe_count;
    if (r.segment_group === "Virgin Postpaid") point.postpaid++;
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------------------
// Employee performance table
// ---------------------------------------------------------------------------
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

export async function getEmployeePerformance(filters: DashboardFilters): Promise<EmployeePerformanceRow[]> {
  const admin = createAdminClient();

  const [activationsResult, employeesResult, targetsResult] = await Promise.all([
    buildActivationFilter(
      admin.from("carrier_activations").select(
        "matched_employee_id, fpe_count, ibr_value, segment_brand, segment_group, bundle_category"
      ),
      filters
    ),
    admin
      .from("employees")
      .select("id, full_name, gosi_registered")
      .eq("organization_id", filters.orgId),
    filters.month
      ? admin
          .from("carrier_sales_targets")
          .select("employee_id, fpe_target, revenue_target")
          .eq("organization_id", filters.orgId)
          .eq("target_month", `${filters.month}-01`)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (activationsResult.error) throw activationsResult.error;
  if (employeesResult.error) throw employeesResult.error;

  const employeeMap = new Map<string, { name: string; gosi: boolean }>();
  for (const e of (employeesResult.data ?? []) as { id: string; full_name: string; gosi_registered: boolean }[]) {
    employeeMap.set(e.id, { name: e.full_name, gosi: e.gosi_registered });
  }

  const targetMap = new Map<string, { fpe: number; revenue: number }>();
  for (const t of ((targetsResult as { data: unknown[] | null }).data ?? []) as { employee_id: string; fpe_target: number; revenue_target: number }[]) {
    targetMap.set(t.employee_id, { fpe: t.fpe_target, revenue: t.revenue_target });
  }

  const byEmployee = new Map<string, EmployeePerformanceRow>();
  for (const r of (activationsResult.data ?? []) as {
    matched_employee_id: string | null;
    fpe_count: number;
    ibr_value: number;
    segment_brand: string | null;
    segment_group: string | null;
    bundle_category: string | null;
  }[]) {
    if (!r.matched_employee_id) continue;
    const empId = r.matched_employee_id;
    if (!byEmployee.has(empId)) {
      const emp = employeeMap.get(empId);
      const target = targetMap.get(empId);
      byEmployee.set(empId, {
        employeeId: empId,
        employeeName: emp?.name ?? empId,
        gosiRegistered: emp?.gosi ?? false,
        fpe: 0,
        fpeFriendi: 0,
        fpeVirgin: 0,
        postpaid: 0,
        hbb: 0,
        ibr: 0,
        bundleCounts: {},
        fpeTarget: target?.fpe ?? null,
        revenueTarget: target?.revenue ?? null,
      });
    }
    const row = byEmployee.get(empId)!;
    row.fpe += r.fpe_count;
    row.ibr += r.ibr_value;
    if (r.segment_brand === "FRiENDi mobile") row.fpeFriendi += r.fpe_count;
    if (r.segment_brand === "Virgin Mobile" && r.segment_group === "Virgin Prepaid") row.fpeVirgin += r.fpe_count;
    if (r.segment_group === "Virgin Postpaid") row.postpaid++;
    if (r.segment_group === "Virgin HBB") row.hbb++;
    if (r.bundle_category) {
      row.bundleCounts[r.bundle_category] = (row.bundleCounts[r.bundle_category] ?? 0) + 1;
    }
  }

  return [...byEmployee.values()].sort((a, b) => b.fpe - a.fpe);
}

// ---------------------------------------------------------------------------
// Supervisor aggregates
// ---------------------------------------------------------------------------
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

export async function getSupervisorPerformance(filters: DashboardFilters): Promise<SupervisorRow[]> {
  const admin = createAdminClient();

  const [activationsResult, employeesResult, targetsResult] = await Promise.all([
    buildActivationFilter(
      admin.from("carrier_activations").select(
        "matched_supervisor_id, matched_employee_id, fpe_count, ibr_value, segment_group"
      ),
      filters
    ),
    admin.from("employees").select("id, full_name").eq("organization_id", filters.orgId),
    filters.month
      ? admin
          .from("carrier_sales_targets")
          .select("supervisor_id, fpe_target, revenue_target")
          .eq("organization_id", filters.orgId)
          .eq("target_month", `${filters.month}-01`)
          .not("supervisor_id", "is", null)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (activationsResult.error) throw activationsResult.error;

  const nameMap = new Map<string, string>();
  for (const e of (employeesResult.data ?? []) as { id: string; full_name: string }[]) {
    nameMap.set(e.id, e.full_name);
  }

  // Aggregate targets per supervisor
  const targetMap = new Map<string, { fpe: number; revenue: number }>();
  for (const t of ((targetsResult as { data: unknown[] | null }).data ?? []) as { supervisor_id: string; fpe_target: number; revenue_target: number }[]) {
    if (!t.supervisor_id) continue;
    const existing = targetMap.get(t.supervisor_id) ?? { fpe: 0, revenue: 0 };
    existing.fpe += t.fpe_target;
    existing.revenue += t.revenue_target;
    targetMap.set(t.supervisor_id, existing);
  }

  const bySupervisor = new Map<string, SupervisorRow & { employeeSet: Set<string> }>();
  for (const r of (activationsResult.data ?? []) as {
    matched_supervisor_id: string | null;
    matched_employee_id: string | null;
    fpe_count: number;
    ibr_value: number;
    segment_group: string | null;
  }[]) {
    if (!r.matched_supervisor_id) continue;
    const svId = r.matched_supervisor_id;
    if (!bySupervisor.has(svId)) {
      const target = targetMap.get(svId);
      bySupervisor.set(svId, {
        supervisorId: svId,
        supervisorName: nameMap.get(svId) ?? svId,
        fpe: 0,
        ibr: 0,
        postpaid: 0,
        hbb: 0,
        fpeTarget: target?.fpe ?? null,
        revenueTarget: target?.revenue ?? null,
        employeeCount: 0,
        employeeSet: new Set(),
      });
    }
    const row = bySupervisor.get(svId)!;
    row.fpe += r.fpe_count;
    row.ibr += r.ibr_value;
    if (r.segment_group === "Virgin Postpaid") row.postpaid++;
    if (r.segment_group === "Virgin HBB") row.hbb++;
    if (r.matched_employee_id) row.employeeSet.add(r.matched_employee_id);
  }

  return [...bySupervisor.values()].map(({ employeeSet, ...rest }) => ({
    ...rest,
    employeeCount: employeeSet.size,
  })).sort((a, b) => b.fpe - a.fpe);
}

// ---------------------------------------------------------------------------
// Bundle breakdown
// ---------------------------------------------------------------------------
export interface BundleBreakdownRow {
  bundleCategory: string;
  count: number;
  ibr: number;
  channel: string | null;
  region: string | null;
}

export async function getBundleBreakdown(filters: DashboardFilters): Promise<BundleBreakdownRow[]> {
  const admin = createAdminClient();
  const { data, error } = await buildActivationFilter(
    admin.from("carrier_activations").select(
      "bundle_category, fpe_count, ibr_value, channel, region"
    ).not("bundle_category", "is", null),
    filters
  );
  if (error) throw error;

  const byKey = new Map<string, BundleBreakdownRow>();
  for (const r of (data ?? []) as { bundle_category: string; fpe_count: number; ibr_value: number; channel: string | null; region: string | null }[]) {
    const key = `${r.bundle_category}|${r.channel ?? ""}|${r.region ?? ""}`;
    if (!byKey.has(key)) {
      byKey.set(key, { bundleCategory: r.bundle_category, count: 0, ibr: 0, channel: r.channel, region: r.region });
    }
    const row = byKey.get(key)!;
    row.count += r.fpe_count;
    row.ibr += r.ibr_value;
  }

  return [...byKey.values()].sort((a, b) => b.count - a.count);
}

// ---------------------------------------------------------------------------
// Shift distribution (hourly)
// ---------------------------------------------------------------------------
export interface HourlyPoint {
  hour: number;
  morning: number;
  night: number;
}

export async function getShiftDistribution(filters: DashboardFilters): Promise<HourlyPoint[]> {
  const admin = createAdminClient();
  const { data, error } = await buildActivationFilter(
    admin.from("carrier_activations").select("activated_at, shift_type"),
    filters
  );
  if (error) throw error;

  const byHour = new Map<number, HourlyPoint>();
  for (const r of (data ?? []) as { activated_at: string | null; shift_type: string | null }[]) {
    if (!r.activated_at) continue;
    const hour = new Date(r.activated_at).getUTCHours();
    if (!byHour.has(hour)) byHour.set(hour, { hour, morning: 0, night: 0 });
    const point = byHour.get(hour)!;
    if (r.shift_type === "morning") point.morning++;
    else point.night++;
  }

  return [...byHour.values()].sort((a, b) => a.hour - b.hour);
}

// ---------------------------------------------------------------------------
// Location coverage
// ---------------------------------------------------------------------------
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

export async function getLocationCoverage(
  filters: DashboardFilters,
  totalWorkingDays: number
): Promise<LocationRow[]> {
  const admin = createAdminClient();
  const { data, error } = await buildActivationFilter(
    admin.from("carrier_activations").select(
      "cas_location_name, dealer_code, region, channel, activation_date"
    ),
    filters
  );
  if (error) throw error;

  const byLocation = new Map<string, {
    locationName: string;
    dealerCode: string;
    region: string | null;
    channel: string | null;
    activationDates: Set<string>;
    total: number;
    lastDate: string | null;
  }>();

  for (const r of (data ?? []) as { cas_location_name: string | null; dealer_code: string; region: string | null; channel: string | null; activation_date: string }[]) {
    const key = r.cas_location_name ?? r.dealer_code;
    if (!byLocation.has(key)) {
      byLocation.set(key, {
        locationName: r.cas_location_name ?? r.dealer_code,
        dealerCode: r.dealer_code,
        region: r.region,
        channel: r.channel,
        activationDates: new Set(),
        total: 0,
        lastDate: null,
      });
    }
    const loc = byLocation.get(key)!;
    loc.activationDates.add(r.activation_date);
    loc.total++;
    if (!loc.lastDate || r.activation_date > loc.lastDate) loc.lastDate = r.activation_date;
  }

  return [...byLocation.values()].map((loc) => {
    const daysWithActivations = loc.activationDates.size;
    const coveragePercent = totalWorkingDays > 0 ? (daysWithActivations / totalWorkingDays) * 100 : 0;
    let status: LocationRow["status"] = "inactive";
    if (coveragePercent >= 100) status = "active";
    else if (coveragePercent >= 85) status = "acceptable";
    else if (coveragePercent >= 70) status = "warning";

    return {
      locationName: loc.locationName,
      dealerCode: loc.dealerCode,
      region: loc.region,
      channel: loc.channel,
      totalActivations: loc.total,
      daysWithActivations,
      lastActivationDate: loc.lastDate,
      coveragePercent,
      status,
    };
  }).sort((a, b) => b.totalActivations - a.totalActivations);
}

// ---------------------------------------------------------------------------
// Import history
// ---------------------------------------------------------------------------
export async function getImportHistory(orgId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("carrier_activation_imports")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return data ?? [];
}
