import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContext } from "@/lib/server/tenant-context";

const schema = z.object({
  employee_id: z.string().uuid(),
  command_id: z.string().uuid(),
  registered: z.boolean(),
  gosi_number: z.string().trim().min(1).max(255).optional(),
  registration_date: z.string().date().optional(),
  scheme_code: z.string().trim().min(2).max(100).optional(),
  contributory_wage: z.number().finite().nonnegative().optional(),
  maximum_contributory_wage: z.number().finite().positive().optional(),
  employee_rate_basis_points: z.number().int().min(0).max(10_000).optional(),
  employer_rate_basis_points: z.number().int().min(0).max(10_000).optional(),
  prorate_partial_month: z.boolean().default(false),
  effective_from: z.string().date().optional(),
  effective_to: z.string().date().optional(),
}).superRefine((value, context) => {
  if (!value.registered) return;
  for (const field of ["gosi_number", "scheme_code", "contributory_wage", "maximum_contributory_wage", "employee_rate_basis_points", "employer_rate_basis_points", "effective_from"] as const) {
    if (value[field] === undefined || value[field] === "") {
      context.addIssue({ code: "custom", path: [field], message: `${field} is required for a registered employee.` });
    }
  }
  if (value.effective_from && value.effective_to && value.effective_to < value.effective_from) {
    context.addIssue({ code: "custom", path: ["effective_to"], message: "Effective-to date cannot precede effective-from date." });
  }
});

export async function POST(request: NextRequest) {
  const auth = await requireTenantContext({ feature: "payroll", capability: "manage_payroll" }, request);
  if ("error" in auth) return auth.error;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message || "Invalid social-insurance configuration.", requestId: auth.requestId }, { status: 400 });
  const values = parsed.data;
  const { data, error } = await auth.admin.rpc("configure_employee_social_insurance", {
    p_org_id: auth.orgId,
    p_employee_id: values.employee_id,
    p_actor_user_id: auth.user.id,
    p_command_id: values.command_id,
    p_request_id: auth.requestId,
    p_configuration: {
      registered: values.registered,
      gosiNumber: values.gosi_number || "",
      registrationDate: values.registration_date || "",
      schemeCode: values.scheme_code || "",
      contributoryWage: values.contributory_wage ?? 0,
      maximumContributoryWage: values.maximum_contributory_wage ?? 0,
      employeeRateBasisPoints: values.employee_rate_basis_points ?? 0,
      employerRateBasisPoints: values.employer_rate_basis_points ?? 0,
      proratePartialMonth: values.prorate_partial_month,
      effectiveFrom: values.effective_from || "",
      effectiveTo: values.effective_to || "",
    },
  });
  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404
      : error.code === "23505" ? 409 : ["22023", "23514"].includes(error.code || "") ? 400 : 500;
    return NextResponse.json({ message: error.message, requestId: auth.requestId }, { status });
  }
  return NextResponse.json({ socialInsurance: data?.[0] || null, requestId: auth.requestId });
}
