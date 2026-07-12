import { NextRequest, NextResponse } from "next/server";
import { requireTenantContext } from "@/lib/server/tenant-context";

const adminRoles = ["admin", "hr_admin"];

export async function GET() {
  const auth = await requireTenantContext({ feature: "hr" });
  if ("error" in auth) return auth.error;

  const { data, error } = await auth.admin
    .from("deduction_rule_groups")
    .select("*")
    .eq("org_id", auth.orgId)
    .order("name");

  if (error) return NextResponse.json({ message: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function POST(request: NextRequest) {
  const auth = await requireTenantContext({ roles: adminRoles, feature: "hr" });
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;

  const name = String(body.name || "").trim();
  if (!name) return NextResponse.json({ message: "Group name is required." }, { status: 400 });

  const payload = {
    org_id: auth.orgId,
    name,
    late_grace_minutes: Number(body.late_grace_minutes ?? 0),
    deduction_per_late_hour: Number(body.deduction_per_late_hour ?? 0),
    allowed_absent_days: Number(body.allowed_absent_days ?? 0),
    deduction_per_absent_day: Number(body.deduction_per_absent_day ?? 0),
    deduction_per_excess_approved_day: Number(body.deduction_per_excess_approved_day ?? 0),
  };

  const { data, error } = await auth.admin
    .from("deduction_rule_groups")
    .insert(payload)
    .select()
    .single();

  if (error) {
    if (error.code === "23505")
      return NextResponse.json({ message: "A group with this name already exists." }, { status: 409 });
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json({ data }, { status: 201 });
}
