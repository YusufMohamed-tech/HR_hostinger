import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContext } from "@/lib/server/tenant-context";
import { beginEmployeeOnboarding, EmployeeLifecycleError } from "@/lib/server/employee-lifecycle";

const requestSchema = z.object({
  application_id: z.string().uuid(),
  command_id: z.string().uuid().optional(),
});
const employmentTypes = new Set(["full_time", "part_time", "intern", "contract"]);

export async function POST(request: NextRequest) {
  const auth = await requireTenantContext({ feature: "recruitment", capability: "manage_recruitment" }, request);
  if ("error" in auth) return auth.error;

  const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ message: "A valid application id is required." }, { status: 400 });

  const applicationResult = await auth.admin
    .from("job_applications")
    .select("*, job:job_posting_id(title, department_id, location_id, employment_type)")
    .eq("id", parsed.data.application_id)
    .eq("org_id", auth.orgId)
    .maybeSingle();
  if (applicationResult.error) return NextResponse.json({ message: applicationResult.error.message }, { status: 500 });
  if (!applicationResult.data) return NextResponse.json({ message: "Application was not found." }, { status: 404 });

  const application = applicationResult.data as Record<string, unknown>;
  const posting = application.job as Record<string, unknown> | null;
  const requestedEmploymentType = String(posting?.employment_type || "full_time");

  try {
    const employee = await beginEmployeeOnboarding(auth.admin, {
      orgId: auth.orgId,
      actorUserId: auth.user.id,
      commandId: parsed.data.command_id || crypto.randomUUID(),
      sourceType: "recruitment",
      sourceId: parsed.data.application_id,
      employee: {
        full_name: String(application.candidate_name || "").trim(),
        email: String(application.email || "").trim().toLowerCase(),
        phone: application.phone ? String(application.phone) : undefined,
        job_title: String(posting?.title || "").trim() || undefined,
        department_id: posting?.department_id ? String(posting.department_id) : undefined,
        location_id: posting?.location_id ? String(posting.location_id) : undefined,
        hiring_date: new Date().toISOString().slice(0, 10),
        leave_accrual_start_date: new Date().toISOString().slice(0, 10),
        employment_type: employmentTypes.has(requestedEmploymentType) ? requestedEmploymentType : "full_time",
        status: "Active",
      },
    });

    const employeeId = String(employee.id || "");
    return NextResponse.json({ data: { employee_id: employeeId, lifecycle_status: employee.lifecycle_status }, requestId: auth.requestId });
  } catch (error) {
    const lifecycleError = error instanceof EmployeeLifecycleError ? error : null;
    return NextResponse.json(
      { message: lifecycleError?.message || "Unable to hire candidate.", requestId: auth.requestId },
      { status: lifecycleError?.status || 500 }
    );
  }
}
