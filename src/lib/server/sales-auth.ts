import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const managerRoles = new Set(["admin", "hr_admin", "sales_manager"]);
const salesRoles = new Set(["sales", "sales_manager", "admin", "hr_admin"]);

export async function requireSalesAccess(options?: { managerOnly?: boolean }) {
  const supabase = await createServerSupabaseClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData?.user;

  if (userError || !user) {
    return { error: NextResponse.json({ message: "غير مصرح بالدخول." }, { status: 401 }) };
  }

  const { data: membership, error: membershipError } = await supabase
    .from("org_members")
    .select("org_id, role")
    .eq("user_id", user.id)
    .maybeSingle();

  const membershipRecord = membership as unknown as Record<string, unknown> | null;
  const orgId = String(membershipRecord?.org_id || "");
  const role = String(membershipRecord?.role || "");
  const allowed = options?.managerOnly ? managerRoles.has(role) : salesRoles.has(role);

  if (membershipError || !membershipRecord || !orgId || !allowed) {
    return { error: NextResponse.json({ message: "ليست لديك صلاحية للوصول إلى المبيعات." }, { status: 403 }) };
  }

  return { user, orgId, role, isManager: managerRoles.has(role) };
}

export { managerRoles, salesRoles };
