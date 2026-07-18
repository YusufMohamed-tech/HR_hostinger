import { NextRequest, NextResponse } from "next/server";
import { requireSalesAccess } from "@/lib/server/sales-auth";
import { processCarrierExcel } from "@/lib/services/carrier-import";

export async function POST(request: NextRequest) {
  const auth = await requireSalesAccess({ managerOnly: true });
  if ("error" in auth) return auth.error;

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ message: "No file provided" }, { status: 400 });
  }

  const allowedTypes = [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
  ];
  if (!allowedTypes.includes(file.type) && !file.name.endsWith(".xlsx") && !file.name.endsWith(".xls")) {
    return NextResponse.json({ message: "Only Excel files (.xlsx, .xls) are accepted" }, { status: 400 });
  }

  try {
    const buffer = await file.arrayBuffer();
    const result = await processCarrierExcel(buffer, file.name, auth.orgId, auth.user.id);
    return NextResponse.json({ data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Import failed";
    return NextResponse.json({ message }, { status: 500 });
  }
}

export async function GET(_request: NextRequest) {
  const auth = await requireSalesAccess({ managerOnly: true });
  if ("error" in auth) return auth.error;

  const { getImportHistory } = await import("@/lib/services/carrier-dashboard");
  try {
    const history = await getImportHistory(auth.orgId);
    return NextResponse.json({ data: history });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load import history";
    return NextResponse.json({ message }, { status: 500 });
  }
}
