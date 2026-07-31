import { NextRequest, NextResponse } from "next/server";
import { requireTenantContext } from "@/lib/server/tenant-context";

export async function GET(request: NextRequest) {
  const auth = await requireTenantContext(
    { feature: "hr", roles: ["supervisor", "admin", "hr_admin"], requireEmployee: true },
    request
  );
  if ("error" in auth) return auth.error;

  const today = new Date().toISOString().split("T")[0];

  const { data: assignments, error: assignError } = await auth.admin
    .from("employee_locations")
    .select("location_id, is_primary")
    .eq("employee_id", auth.employeeId)
    .or(`assigned_to.is.null,assigned_to.gte.${today}`);

  if (assignError || !assignments?.length) {
    return NextResponse.json(
      { locations: [], requestId: auth.requestId },
      { headers: { "cache-control": "no-store", "x-request-id": auth.requestId } }
    );
  }

  const locationIds = (assignments as Array<{ location_id: string; is_primary: boolean }>).map((a) => a.location_id);
  const primaryMap = new Map((assignments as Array<{ location_id: string; is_primary: boolean }>).map((a) => [a.location_id, a.is_primary]));

  const { data: locations, error } = await auth.admin
    .from("locations")
    .select("id, name, type, latitude, longitude, radius_meters")
    .in("id", locationIds);

  if (error) {
    return NextResponse.json(
      { message: "Failed to fetch locations.", requestId: auth.requestId },
      { status: 500, headers: { "x-request-id": auth.requestId } }
    );
  }

  const result = (locations ?? []).map((loc) => ({
    id: loc.id,
    name: loc.name,
    type: loc.type,
    latitude: loc.latitude,
    longitude: loc.longitude,
    radius_meters: loc.radius_meters,
    is_primary: primaryMap.get(loc.id) ?? false,
  }));

  return NextResponse.json(
    { locations: result, requestId: auth.requestId },
    { headers: { "cache-control": "no-store", "x-request-id": auth.requestId } }
  );
}
