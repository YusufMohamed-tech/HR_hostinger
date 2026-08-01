import { NextRequest, NextResponse } from "next/server";
import { submitProductTraderCollectionSchema } from "@/lib/product-trader/schemas";
import { requireProductTraderParticipantAccess } from "@/lib/server/product-inventory-auth";
import { productInventoryError } from "@/lib/server/product-inventory-api";
import { executeProductTraderSettlementCommand } from "@/lib/server/product-trader";

export async function POST(request:NextRequest){
  const auth=await requireProductTraderParticipantAccess(request);if("error" in auth)return auth.error;
  if(auth.role!=="merchant")return NextResponse.json({message:"فقط التاجر يمكنه إرسال دفعة."},{status:403});
  const parsed=submitProductTraderCollectionSchema.safeParse(await request.json().catch(()=>({})));if(!parsed.success)return NextResponse.json({message:parsed.error.issues[0]?.message},{status:400});
  const {command_id:commandId,...payload}=parsed.data;
  try{return NextResponse.json({data:await executeProductTraderSettlementCommand(auth.admin,{orgId:auth.orgId,actorUserId:auth.user.id,requestId:auth.requestId,commandId,action:"collection_submit",payload})},{status:201});}
  catch(error){return productInventoryError(error,"تعذر إرسال الدفعة.");}
}
