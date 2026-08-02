import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canAccessPath } from "../src/lib/rbac";
import {
  createProductTraderSaleSchema,
  issueProductTraderHandoverSchema,
  recoverProductTraderLossSchema,
  reportProductTraderLossSchema,
  reviewProductTraderCollectionSchema,
} from "../src/lib/product-trader/schemas";
import { buildProductTraderSaleJournalLines } from "../src/lib/accounting/product-trader-posting";

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

test("loss recovery requires optimistic concurrency",()=>{
  assert.equal(recoverProductTraderLossSchema.safeParse({command_id:id(1),condition:"sellable"}).success,false);
  assert.equal(recoverProductTraderLossSchema.safeParse({command_id:id(1),expected_version:1,condition:"sellable"}).success,true);
});

test("netted merchant commission reconciles trader receivable and journal",()=>{
  const accounts={receivable:"receivable",revenue:"revenue",vatPayable:"vat",inventory:"inventory",cogs:"cogs",commissionExpense:"commission-expense",commissionPayable:"commission-payable"};
  const journal=buildProductTraderSaleJournalLines({saleNo:"TPS-1",total:100,net:100,vat:0,cost:60,organizationReceivable:90,merchantCommission:10,agentCommission:5,netMerchantCommission:true,accounts});
  const debit=journal.lines.reduce((sum,line)=>sum+Number(line.debit||0),0);
  const credit=journal.lines.reduce((sum,line)=>sum+Number(line.credit||0),0);
  assert.equal(debit,credit);
  assert.equal(journal.commissionExpenseAmount,15);
  assert.equal(journal.commissionPayableAmount,5);
  assert.equal(journal.lines.find((line)=>line.account_id==="receivable")?.debit,90);
});

test("gross settlement keeps merchant commission payable",()=>{
  const accounts={receivable:"receivable",revenue:"revenue",vatPayable:"vat",inventory:"inventory",cogs:"cogs",commissionExpense:"commission-expense",commissionPayable:"commission-payable"};
  const journal=buildProductTraderSaleJournalLines({saleNo:"TPS-2",total:100,net:100,vat:0,cost:60,organizationReceivable:100,merchantCommission:10,agentCommission:5,netMerchantCommission:false,accounts});
  assert.equal(journal.commissionPayableAmount,15);
  assert.equal(journal.lines.reduce((sum,line)=>sum+Number(line.debit||0),0),journal.lines.reduce((sum,line)=>sum+Number(line.credit||0),0));
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
