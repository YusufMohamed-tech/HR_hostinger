import { NextRequest, NextResponse } from "next/server";
import { requireSalesAccess } from "@/lib/server/sales-auth";
import { getLocationCoverage } from "@/lib/services/carrier-dashboard";
import type { DashboardFilters } from "@/lib/services/carrier-dashboard";

export async function GET(request: NextRequest) {
  const auth = await requireSalesAccess({ managerOnly: true });
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
  const workingDays = parseInt(sp.get("working_days") ?? "25", 10);

  try {
    const data = await getLocationCoverage(filters, workingDays);
    return NextResponse.json({ data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load location data";
    return NextResponse.json({ message }, { status: 500 });
  }
}
