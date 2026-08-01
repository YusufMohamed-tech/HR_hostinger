import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { productCommercialTermsCommandSchema } from "@/lib/product-inventory/schemas";
import { requireProductInventoryManagerAccess } from "@/lib/server/product-inventory-auth";
import {
  executeProductCommercialTermsCommand,
  productInventoryDb,
  productInventoryError,
} from "@/lib/server/product-inventory-api";

type RouteContext = { params: Promise<{ receiptId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireProductInventoryManagerAccess(request);
  if ("error" in auth) return auth.error;
  const { receiptId } = await context.params;
  if (!z.string().uuid().safeParse(receiptId).success) {
    return NextResponse.json({ message: "معرف سند الاستلام غير صالح." }, { status: 400 });
  }
  try {
    const db = productInventoryDb(auth.admin);
    const [receipt, lines, history] = await Promise.all([
      db.from("product_receipts").select("id, receipt_no, status, version, currency")
        .eq("organization_id", auth.orgId).eq("id", receiptId).maybeSingle(),
      db.from("product_receipt_lines").select("*")
        .eq("organization_id", auth.orgId).eq("receipt_id", receiptId).order("line_no"),
      db.from("product_inventory_commercial_terms").select("*")
        .eq("organization_id", auth.orgId).eq("receipt_id", receiptId)
        .order("receipt_line_id").order("revision", { ascending: false }),
    ]);
    const error = receipt.error || lines.error || history.error;
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    if (!receipt.data) return NextResponse.json({ message: "سند الاستلام غير موجود." }, { status: 404 });
    return NextResponse.json({ data: { receipt: receipt.data, lines: lines.data ?? [], history: history.data ?? [] } });
  } catch (error) {
    return productInventoryError(error, "تعذر تحميل التسعير والعمولة.");
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireProductInventoryManagerAccess(request);
  if ("error" in auth) return auth.error;
  const { receiptId } = await context.params;
  if (!z.string().uuid().safeParse(receiptId).success) {
    return NextResponse.json({ message: "معرف سند الاستلام غير صالح." }, { status: 400 });
  }
  const parsed = productCommercialTermsCommandSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ message: parsed.error.issues[0]?.message || "بيانات التسعير غير صالحة." }, { status: 400 });
  }
  try {
    const result = await executeProductCommercialTermsCommand(auth.admin, {
      orgId: auth.orgId,
      actorUserId: auth.user.id,
      requestId: auth.requestId,
      commandId: parsed.data.command_id,
      receiptId,
      expectedVersion: parsed.data.expected_version,
      terms: parsed.data.terms,
    });
    return NextResponse.json({ data: result });
  } catch (error) {
    return productInventoryError(error, "تعذر اعتماد التسعير والعمولة.");
  }
}
