import { NextRequest, NextResponse } from "next/server";
import { requireSalesAccess } from "@/lib/server/sales-auth";
import { getBundleBreakdown } from "@/lib/services/carrier-dashboard";
import type { DashboardFilters } from "@/lib/services/carrier-dashboard";

function buildFilters(orgId: string, sp: URLSearchParams): DashboardFilters {
  return {
    orgId,
    month: sp.get("month") ?? undefined,
    dateFrom: sp.get("date_from") ?? undefined,
    dateTo: sp.get("date_to") ?? undefined,
    region: sp.get("region") ?? undefined,
    channel: sp.get("channel") ?? undefined,
    segmentBrand: sp.get("segment_brand") ?? undefined,
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireSalesAccess();
  if ("error" in auth) return auth.error;

  const filters = buildFilters(auth.orgId, request.nextUrl.searchParams);
  try {
    const data = await getBundleBreakdown(filters);
    return NextResponse.json({ data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load bundle breakdown";
    return NextResponse.json({ message }, { status: 500 });
  }
}
