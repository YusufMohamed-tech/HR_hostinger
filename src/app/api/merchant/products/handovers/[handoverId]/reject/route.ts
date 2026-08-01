import { NextRequest, NextResponse } from "next/server";
import { rejectProductTraderHandoverSchema } from "@/lib/product-trader/schemas";
import { requireProductTraderParticipantAccess } from "@/lib/server/product-inventory-auth";
import { productInventoryError } from "@/lib/server/product-inventory-api";
import { executeProductTraderCommand } from "@/lib/server/product-trader";

type Context = { params: Promise<{ handoverId: string }> };

export async function POST(request: NextRequest, context: Context) {
  const auth = await requireProductTraderParticipantAccess(request);
  if ("error" in auth) return auth.error;
  if (auth.role !== "merchant") return NextResponse.json({ message: "فقط التاجر المستلم يمكنه الرفض." }, { status: 403 });
  const parsed = rejectProductTraderHandoverSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message }, { status: 400 });
  const { handoverId } = await context.params;
  const { command_id: commandId, ...input } = parsed.data;
  try {
    const data = await executeProductTraderCommand(auth.admin, {
      orgId: auth.orgId, actorUserId: auth.user.id, requestId: auth.requestId,
      commandId, action: "trader_handover_reject", payload: { handover_id: handoverId, ...input },
    });
    return NextResponse.json({ data });
  } catch (error) {
    return productInventoryError(error, "تعذر رفض التسليم.");
  }
}
