import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canAccessPath } from "../src/lib/rbac";
import {
  createProductTraderSaleSchema,
  issueProductTraderHandoverSchema,
  reportProductTraderLossSchema,
  reviewProductTraderCollectionSchema,
} from "../src/lib/product-trader/schemas";

const id=(value:number)=>`00000000-0000-4000-8000-${String(value).padStart(12,"0")}`;

test("trader handovers reject duplicate serialized units",()=>{
  assert.equal(issueProductTraderHandoverSchema.safeParse({handover_id:id(1),command_id:id(2),merchant_id:id(3),unit_ids:[id(4),id(4)]}).success,false);
  assert.equal(issueProductTraderHandoverSchema.safeParse({handover_id:id(1),command_id:id(2),merchant_id:id(3),unit_ids:[id(4)]}).success,true);
});

test("trader sales require a positive price and supported payment",()=>{
  assert.equal(createProductTraderSaleSchema.safeParse({sale_id:id(1),command_id:id(2),unit_id:id(3),sale_price:0,payment_method:"cash"}).success,false);
  assert.equal(createProductTraderSaleSchema.safeParse({sale_id:id(1),command_id:id(2),unit_id:id(3),sale_price:500,payment_method:"cash"}).success,true);
});

test("loss reports require evidence and collection rejection requires a reason",()=>{
  assert.equal(reportProductTraderLossSchema.safeParse({loss_id:id(1),command_id:id(2),unit_id:id(3),loss_type:"missing",reason:"missing device",evidence_path:""}).success,false);
  assert.equal(reviewProductTraderCollectionSchema.safeParse({command_id:id(1),expected_version:1,decision:"rejected"}).success,false);
});

test("role routing exposes only the intended trader product surfaces",()=>{
  assert.equal(canAccessPath("Field_Agent","/api/sales/inventory/trader-handovers"),true);
  assert.equal(canAccessPath("Field_Agent","/sales/inventory"),false);
  assert.equal(canAccessPath("Merchant","/api/merchant/products/dashboard"),true);
  assert.equal(canAccessPath("Onground_Agent_Manager","/sales/trader-products"),true);
  assert.equal(canAccessPath("Onground_Agent_Manager","/sales/inventory/products"),false);
});

test("field-agent queries use the native sales identity without a phantom employee relation",()=>{
  const source=readFileSync(new URL("../src/lib/server/product-trader.ts",import.meta.url),"utf8");
  assert.equal(source.includes('employee:employee_id(full_name)'),false);
  assert.equal(source.includes('select("id, agent_code'),false);
  assert.match(source,/source_agent:source_agent_id\(id, full_name\)/);
});
