import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSalesAccess } from "@/lib/server/sales-auth";

// Returns distinct dealer codes that appear in activations but have no employee assignment
export async function GET(request: NextRequest) {
  const auth = await requireSalesAccess({ managerOnly: true });
  if ("error" in auth) return auth.error;

  const month = request.nextUrl.searchParams.get("month");
  const admin = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (admin as any)
    .from("carrier_activations")
    .select("dealer_code")
    .eq("organization_id", auth.orgId)
    .is("matched_employee_id", null);

  if (month) {
    const [y, m] = month.split("-").map(Number);
    const nextM = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
    q = q.gte("activation_date", `${month}-01`).lt("activation_date", `${nextM}-01`) as typeof q;
  }

  const { data, error } = await q;
  if (error) return NextResponse.json({ message: error.message }, { status: 500 });

  const codes = Array.from(new Set(((data ?? []) as { dealer_code: string }[]).map((r) => r.dealer_code))).sort();
  return NextResponse.json({ data: codes });
}
