import { NextRequest, NextResponse } from "next/server";
import { requireSalesAccess } from "@/lib/server/sales-auth";
import { getCarrierDashboardSnapshot } from "@/lib/services/carrier-dashboard";
import type { DashboardFilters } from "@/lib/services/carrier-dashboard";

export async function GET(request: NextRequest) {
  const auth = await requireSalesAccess({ managerOnly: true }, request);
  if ("error" in auth) return auth.error;

  const sp = request.nextUrl.searchParams;
  const filters: DashboardFilters = {
    orgId: auth.orgId,
    month: sp.get("month") ?? undefined,
    dateFrom: sp.get("date_from") ?? undefined,
    dateTo: sp.get("date_to") ?? undefined,
    region: sp.get("region") ?? undefined,
    channel: sp.get("channel") ?? undefined,
  };

  try {
    const snapshot = await getCarrierDashboardSnapshot(filters);
    return NextResponse.json({ data: snapshot.shifts, completeness: snapshot.completeness, requestId: auth.requestId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load shift data";
    return NextResponse.json({ message }, { status: 500 });
  }
}
