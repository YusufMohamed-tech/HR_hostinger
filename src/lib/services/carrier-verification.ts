import { createAdminClient } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// Runs after each import: compares carrier activations vs employee sales_logs
// and writes discrepancy records to carrier_sales_verifications.
// ---------------------------------------------------------------------------

interface CarrierDay {
  employeeId: string;
  date: string;
  fpe: number;
  ibr: number;
  friendi: number;
  virgin: number;
  postpaid: number;
}

interface LogDay {
  userId: string;
  date: string;
  fpe: number;
  ibr: number;
  friendi: number;
  virgin: number;
  postpaid: number;
}

export async function runVerification(
  orgId: string,
  importId: string,
  dateRangeStart: string,
  dateRangeEnd: string
): Promise<{ checked: number; discrepancies: number }> {
  const admin = createAdminClient();

  // Load tolerance from config (default 5%)
  const { data: cfgData } = await admin
    .from("carrier_dashboard_config")
    .select("config_value")
    .eq("organization_id", orgId)
    .eq("config_key", "verification_tolerance_percent")
    .single();
  const tolerance = parseFloat((cfgData as { config_value: string } | null)?.config_value ?? "5") / 100;

  // 1. Aggregate carrier activations per (employee, date)
  const { data: actData, error: actErr } = await admin
    .from("carrier_activations")
    .select("matched_employee_id, activation_date, fpe_count, ibr_value, segment_brand, segment_group")
    .eq("organization_id", orgId)
    .eq("import_id", importId)
    .not("matched_employee_id", "is", null);

  if (actErr) throw actErr;

  const carrierByKey = new Map<string, CarrierDay>();
  for (const r of (actData ?? []) as {
    matched_employee_id: string;
    activation_date: string;
    fpe_count: number;
    ibr_value: number;
    segment_brand: string | null;
    segment_group: string | null;
  }[]) {
    const key = `${r.matched_employee_id}|${r.activation_date}`;
    if (!carrierByKey.has(key)) {
      carrierByKey.set(key, {
        employeeId: r.matched_employee_id,
        date: r.activation_date,
        fpe: 0, ibr: 0, friendi: 0, virgin: 0, postpaid: 0,
      });
    }
    const day = carrierByKey.get(key)!;
    day.fpe += r.fpe_count;
    day.ibr += r.ibr_value;
    if (r.segment_brand === "FRiENDi mobile") day.friendi += r.fpe_count;
    if (r.segment_brand === "Virgin Mobile" && r.segment_group === "Virgin Prepaid") day.virgin += r.fpe_count;
    if (r.segment_group === "Virgin Postpaid") day.postpaid++;
  }

  if (carrierByKey.size === 0) return { checked: 0, discrepancies: 0 };

  // 2. Get the user_ids for all matched employees
  const employeeIds = [...new Set([...carrierByKey.values()].map((d) => d.employeeId))];
  const { data: empData } = await admin
    .from("employees")
    .select("id, user_id")
    .in("id", employeeIds);

  const empToUser = new Map<string, string>();
  const userToEmp = new Map<string, string>();
  for (const e of (empData ?? []) as { id: string; user_id: string | null }[]) {
    if (e.user_id) {
      empToUser.set(e.id, e.user_id);
      userToEmp.set(e.user_id, e.id);
    }
  }

  // 3. Aggregate sales_logs per (user, date) for the date range
  // sales_logs.items is a jsonb array; each item has product_name/company hints
  // We aggregate grand_total as proxy for IBR and item counts as proxy for FPE
  const userIds = [...empToUser.values()];
  const logByKey = new Map<string, LogDay>();

  if (userIds.length > 0) {
    const { data: logData } = await admin
      .from("sales_logs")
      .select("sales_agent_id, log_date, items, grand_total")
      .eq("organization_id", orgId)
      .in("sales_agent_id", userIds)
      .gte("log_date", dateRangeStart)
      .lte("log_date", dateRangeEnd);

    for (const log of (logData ?? []) as {
      sales_agent_id: string;
      log_date: string;
      items: unknown[];
      grand_total: number;
    }[]) {
      const empId = userToEmp.get(log.sales_agent_id);
      if (!empId) continue;
      const key = `${empId}|${log.log_date}`;
      const items = Array.isArray(log.items) ? log.items : [];

      let fpe = 0, friendi = 0, virgin = 0, postpaid = 0;
      for (const item of items as { quantity?: number; product_name?: string; company_name?: string }[]) {
        const qty = Number(item.quantity ?? 1);
        const name = (item.product_name ?? "").toLowerCase();
        const company = (item.company_name ?? "").toLowerCase();
        fpe += qty;
        if (company.includes("friendi") || name.includes("friendi")) friendi += qty;
        if (company.includes("virgin") || name.includes("virgin")) {
          if (name.includes("postpaid")) postpaid += qty;
          else virgin += qty;
        }
      }

      logByKey.set(key, {
        userId: log.sales_agent_id,
        date: log.log_date,
        fpe,
        ibr: log.grand_total,
        friendi,
        virgin,
        postpaid,
      });
    }
  }

  // 4. Compare and build verification records
  const upserts: Record<string, unknown>[] = [];

  for (const [key, carrier] of carrierByKey) {
    const log = logByKey.get(key);
    const logFpe = log?.fpe ?? 0;
    const logIbr = log?.ibr ?? 0;

    const fpeDiff = logFpe - carrier.fpe;
    const ibrDiff = logIbr - carrier.ibr;

    // Determine discrepancy type
    let hasDiscrepancy = false;
    let discrepancyType: string | null = null;

    if (!log && carrier.fpe > 0) {
      hasDiscrepancy = true;
      discrepancyType = "missing_log";
    } else if (log && carrier.fpe === 0) {
      hasDiscrepancy = true;
      discrepancyType = "extra_log";
    } else if (log) {
      const threshold = carrier.fpe * tolerance;
      if (Math.abs(fpeDiff) > threshold) {
        hasDiscrepancy = true;
        discrepancyType = fpeDiff > 0 ? "over_reported" : "under_reported";
      }
    }

    upserts.push({
      organization_id: orgId,
      import_id: importId,
      employee_id: carrier.employeeId,
      verification_date: carrier.date,
      carrier_fpe: carrier.fpe,
      carrier_ibr: carrier.ibr,
      carrier_friendi: carrier.friendi,
      carrier_virgin: carrier.virgin,
      carrier_postpaid: carrier.postpaid,
      logged_fpe: logFpe,
      logged_ibr: logIbr,
      logged_friendi: log?.friendi ?? 0,
      logged_virgin: log?.virgin ?? 0,
      logged_postpaid: log?.postpaid ?? 0,
      has_discrepancy: hasDiscrepancy,
      discrepancy_type: discrepancyType,
      fpe_difference: fpeDiff,
      ibr_difference: ibrDiff,
    });
  }

  // Batch upsert in chunks of 500
  const CHUNK = 500;
  for (let i = 0; i < upserts.length; i += CHUNK) {
    const { error } = await admin
      .from("carrier_sales_verifications")
      .upsert(upserts.slice(i, i + CHUNK), {
        onConflict: "organization_id,import_id,employee_id,verification_date",
        ignoreDuplicates: false,
      });
    if (error) throw error;
  }

  const discrepancies = upserts.filter((u) => u.has_discrepancy).length;
  return { checked: upserts.length, discrepancies };
}
