import { NextRequest, NextResponse } from "next/server";
import { requireTenantContext } from "@/lib/server/tenant-context";

const adminRoles = ["admin", "hr_admin"];

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireTenantContext({ roles: adminRoles, feature: "hr" });
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.name !== undefined) updates.name = String(body.name).trim();
  if (body.late_grace_minutes !== undefined) updates.late_grace_minutes = Number(body.late_grace_minutes);
  if (body.deduction_per_late_hour !== undefined) updates.deduction_per_late_hour = Number(body.deduction_per_late_hour);
  if (body.allowed_absent_days !== undefined) updates.allowed_absent_days = Number(body.allowed_absent_days);
  if (body.deduction_per_absent_day !== undefined) updates.deduction_per_absent_day = Number(body.deduction_per_absent_day);
  if (body.deduction_per_excess_approved_day !== undefined) updates.deduction_per_excess_approved_day = Number(body.deduction_per_excess_approved_day);

  const { data, error } = await auth.admin
    .from("deduction_rule_groups")
    .update(updates)
    .eq("id", params.id)
    .eq("org_id", auth.orgId)
    .select()
    .single();

  if (error) {
    if (error.code === "23505")
      return NextResponse.json({ message: "A group with this name already exists." }, { status: 409 });
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ message: "Group not found." }, { status: 404 });

  return NextResponse.json({ data });
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireTenantContext({ roles: ["admin"], feature: "hr" });
  if ("error" in auth) return auth.error;

  // Block deletion if employees are assigned
  const { count } = await auth.admin
    .from("employees")
    .select("id", { count: "exact", head: true })
    .eq("deduction_rule_group_id", params.id)
    .eq("org_id", auth.orgId);

  if (count && count > 0) {
    return NextResponse.json(
      { message: `Cannot delete: ${count} employee${count > 1 ? "s are" : " is"} assigned to this group.`, assignedCount: count },
      { status: 409 }
    );
  }

  const { error } = await auth.admin
    .from("deduction_rule_groups")
    .delete()
    .eq("id", params.id)
    .eq("org_id", auth.orgId);

  if (error) return NextResponse.json({ message: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
