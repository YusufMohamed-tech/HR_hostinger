import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSalesAccess } from "@/lib/server/sales-auth";

function isActiveAssignment(assignment: Record<string, unknown>) {
  if (assignment.is_active === false) return false;
  const today = new Date().toISOString().slice(0, 10);
  const start = String(assignment.start_date || today);
  const end = assignment.end_date ? String(assignment.end_date) : "";
  return start <= today && (!end || end >= today);
}

export async function GET() {
  const auth = await requireSalesAccess();
  if ("error" in auth) return auth.error;

  const admin = createAdminClient();
  const [companiesResult, assignmentsResult] = await Promise.all([
    admin
      .from("sales_companies")
      .select("*")
      .eq("organization_id", auth.orgId)
      .eq("is_active", true)
      .order("name", { ascending: true }),
    admin
      .from("sales_company_assignments")
      .select("*")
      .eq("organization_id", auth.orgId)
      .eq("user_id", auth.user.id)
      .eq("is_active", true),
  ]);

  if (companiesResult.error) return NextResponse.json({ message: companiesResult.error.message }, { status: 500 });
  if (assignmentsResult.error) return NextResponse.json({ message: assignmentsResult.error.message }, { status: 500 });

  const assignments = ((assignmentsResult.data ?? []) as Record<string, unknown>[]).filter(isActiveAssignment);
  const assignmentByCompany = new Map(assignments.map((assignment) => [
    String(assignment.company_id),
    String(assignment.assignment_role),
  ]));

  const isOrgManager = ["admin", "hr_admin"].includes(auth.role);
  const companies = ((companiesResult.data ?? []) as Record<string, unknown>[])
    .map((company) => ({
      ...company,
      assignment_role: isOrgManager ? "admin" : assignmentByCompany.get(String(company.id)) || null,
    }))
    .filter((company) => isOrgManager || company.assignment_role);

  return NextResponse.json({ data: companies });
}
