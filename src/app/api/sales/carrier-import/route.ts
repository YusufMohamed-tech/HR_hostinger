import { NextRequest, NextResponse } from "next/server";
import { requireSalesAccess } from "@/lib/server/sales-auth";
import { MAX_CARRIER_IMPORT_BYTES, processCarrierExcel } from "@/lib/services/carrier-import";

export async function POST(request: NextRequest) {
  const auth = await requireSalesAccess({ managerOnly: true }, request);
  if ("error" in auth) return auth.error;

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ message: "No file provided" }, { status: 400 });
  }

  const normalizedName = file.name.toLowerCase();
  const allowedTypes = ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/octet-stream", ""];
  if (!normalizedName.endsWith(".xlsx") || !allowedTypes.includes(file.type)) {
    return NextResponse.json({ message: "Only Excel .xlsx files are accepted" }, { status: 400 });
  }
  if (file.size <= 0 || file.size > MAX_CARRIER_IMPORT_BYTES) {
    return NextResponse.json({ message: `File must be between 1 byte and ${MAX_CARRIER_IMPORT_BYTES / 1024 / 1024} MB` }, { status: 413 });
  }

  try {
    const buffer = await file.arrayBuffer();
    const suppliedCommand = request.headers.get("idempotency-key")?.trim();
    const commandId = suppliedCommand && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(suppliedCommand)
      ? suppliedCommand : crypto.randomUUID();
    const result = await processCarrierExcel(buffer, file.name, auth.orgId, auth.user.id, {
      commandId,
      requestId: auth.requestId,
    });
    return NextResponse.json({ data: result, requestId: auth.requestId }, { status: result.status === "failed" ? 422 : 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Import failed";
    return NextResponse.json({ message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireSalesAccess({ managerOnly: true }, request);
  if ("error" in auth) return auth.error;

  const rejectionImportId = request.nextUrl.searchParams.get("rejections_for")?.trim();
  if (rejectionImportId) {
    const result = await auth.admin.from("carrier_import_rejections")
      .select("row_number, source_row_hash, validation_errors, payload")
      .eq("organization_id", auth.orgId).eq("import_id", rejectionImportId)
      .order("row_number", { ascending: true }).limit(50000);
    if (result.error) return NextResponse.json({ message: result.error.message }, { status: 500 });
    if (request.nextUrl.searchParams.get("format") === "csv") {
      const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
      const lines = ["row_number,source_row_hash,validation_errors,payload", ...(result.data || []).map((row: Record<string, unknown>) => [
        row.row_number, row.source_row_hash, JSON.stringify(row.validation_errors), JSON.stringify(row.payload),
      ].map(escape).join(","))];
      return new NextResponse(lines.join("\n"), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="carrier-rejections-${rejectionImportId}.csv"`,
          "x-request-id": auth.requestId,
        },
      });
    }
    return NextResponse.json({ data: result.data || [], requestId: auth.requestId });
  }
  const { getImportHistory } = await import("@/lib/services/carrier-dashboard");
  try {
    const history = await getImportHistory(auth.orgId);
    return NextResponse.json({ data: history });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load import history";
    return NextResponse.json({ message }, { status: 500 });
  }
}
