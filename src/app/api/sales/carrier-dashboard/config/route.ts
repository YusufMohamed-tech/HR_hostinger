import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSalesAccess } from "@/lib/server/sales-auth";

export async function POST(request: NextRequest) {
  const auth = await requireSalesAccess({ managerOnly: true });
  if ("error" in auth) return auth.error;

  const { config_key, config_value } = await request.json() as { config_key?: string; config_value?: string };
  if (!config_key || config_value === undefined) {
    return NextResponse.json({ message: "config_key and config_value are required" }, { status: 400 });
  }

  const ALLOWED_KEYS = new Set([
    "shift_morning_start",
    "shift_night_start",
    "verification_tolerance_percent",
    "location_active_threshold",
    "location_acceptable_threshold",
    "location_warning_threshold",
  ]);
  if (!ALLOWED_KEYS.has(config_key)) {
    return NextResponse.json({ message: "Unknown config key" }, { status: 400 });
  }

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any).from("carrier_dashboard_config").upsert(
    {
      organization_id: auth.orgId,
      config_key,
      config_value: String(config_value),
      updated_by: auth.user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,config_key" }
  );

  if (error) return NextResponse.json({ message: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
