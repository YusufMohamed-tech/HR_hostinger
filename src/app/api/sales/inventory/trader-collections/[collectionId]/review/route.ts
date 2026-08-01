import { NextRequest,NextResponse } from "next/server";
import { reviewProductTraderCollectionSchema } from "@/lib/product-trader/schemas";
import { requireProductTraderParticipantAccess } from "@/lib/server/product-inventory-auth";
import { productInventoryError } from "@/lib/server/product-inventory-api";
import { executeProductTraderSettlementCommand } from "@/lib/server/product-trader";
type Context={params:Promise<{collectionId:string}>};
export async function POST(request:NextRequest,context:Context){const auth=await requireProductTraderParticipantAccess(request);if("error" in auth)return auth.error;if(!["field_agent","admin","finance_manager"].includes(auth.role))return NextResponse.json({message:"لا تملك صلاحية تأكيد الدفعة."},{status:403});const parsed=reviewProductTraderCollectionSchema.safeParse(await request.json().catch(()=>({})));if(!parsed.success)return NextResponse.json({message:parsed.error.issues[0]?.message},{status:400});const{collectionId}=await context.params;const{command_id:commandId,...input}=parsed.data;try{return NextResponse.json({data:await executeProductTraderSettlementCommand(auth.admin,{orgId:auth.orgId,actorUserId:auth.user.id,requestId:auth.requestId,commandId,action:"collection_review",payload:{collection_id:collectionId,...input}})});}catch(error){return productInventoryError(error);}}
