export type ManualAdjustment = {
  id: string;
  type: "bonus" | "deduction";
  amount: number;
  reason: string;
  created_by: string;
  created_at: string;
};

export type PayrollRun = Record<string, unknown> & {
  id: string;
  status: "draft" | "approved" | "paid" | "void";
  version: number;
  formula_version: string;
};

async function parseResponse(response: Response) {
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(payload.message || "Payroll request failed."));
  return payload;
}

function persistentCommandId(key: string) {
  if (typeof window === "undefined") return crypto.randomUUID();
  const existing = window.sessionStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID();
  window.sessionStorage.setItem(key, created);
  return created;
}

export async function getPayslips(_orgId: string, month?: string) {
  if (!month) return { data: [], run: null, error: { message: "Payroll month is required." } };
  try {
    const response = await fetch(`/api/payroll?month=${encodeURIComponent(month)}`, { cache: "no-store" });
    const payload = await parseResponse(response);
    return {
      data: (payload.payslips || []) as Record<string, unknown>[],
      run: (payload.run || null) as PayrollRun | null,
      error: null,
    };
  } catch (error) {
    return { data: [], run: null, error: { message: error instanceof Error ? error.message : "Unable to load payroll." } };
  }
}

export async function runPayroll(month: string) {
  const storageKey = `payroll:run:${month}`;
  const commandId = persistentCommandId(storageKey);
  try {
    const payload = await parseResponse(await fetch("/api/payroll/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month, command_id: commandId }),
    }));
    if (typeof window !== "undefined") window.sessionStorage.removeItem(storageKey);
    return { data: payload.payslips as Record<string, unknown>[], error: null };
  } catch (error) {
    return { data: null, error: { message: error instanceof Error ? error.message : "Payroll run failed." } };
  }
}

export async function recalculatePayslip(employeeId: string, month: string) {
  try {
    const payload = await parseResponse(await fetch("/api/payroll/recalculate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employee_id: employeeId, month, command_id: crypto.randomUUID() }),
    }));
    return { data: payload.payslip as Record<string, unknown>, error: null };
  } catch (error) {
    return { data: null, error: { message: error instanceof Error ? error.message : "Payroll recalculation failed." } };
  }
}

export async function transitionPayrollRun(values: {
  payrollRunId: string;
  expectedVersion: number;
  targetStatus: "approved" | "void";
  reason?: string;
}) {
  try {
    const payload = await parseResponse(await fetch("/api/payroll/transition", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        payroll_run_id: values.payrollRunId,
        command_id: crypto.randomUUID(),
        expected_version: values.expectedVersion,
        target_status: values.targetStatus,
        reason: values.reason,
      }),
    }));
    return { data: payload.run as PayrollRun, error: null };
  } catch (error) {
    return { data: null, error: { message: error instanceof Error ? error.message : "Payroll transition failed." } };
  }
}
