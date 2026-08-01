import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

const sources = {
  migration: read("db/schema_v128_product_inventory_hardening.sql"),
  commerce: read("src/lib/server/product-inventory-commerce.ts"),
  stockRoute: read("src/app/api/sales/inventory/stock/route.ts"),
  movementRoute: read("src/app/api/sales/inventory/movements/route.ts"),
  receiptRoute: read("src/app/api/sales/inventory/receipts/route.ts"),
  healthRoute: read("src/app/api/internal/product-inventory/route.ts"),
  photoRoute: read("src/app/api/sales/inventory/receipts/[receiptId]/photo-preview/route.ts"),
  photoExtraction: read("src/lib/product-inventory/photo-extraction.ts"),
  localTesseract: read("src/lib/ocr/local-tesseract.ts"),
  prepareOcrAssets: read("scripts/prepare-ocr-assets.mjs"),
  packageJson: read("package.json"),
  workbookRoute: read("src/app/api/sales/inventory/receipts/[receiptId]/excel-preview/route.ts"),
  databaseTests: read("scripts/test-database-migrations.mjs"),
  runbook: read("docs/PRODUCT_INVENTORY_PHASE_6_UAT_RUNBOOK.md"),
  returnHardening: read("db/schema_v147_product_inventory_return_hardening.sql"),
  returnRoute: read("src/app/api/sales/inventory/return-requests/route.ts"),
  returnAttachmentRoute: read("src/app/api/sales/inventory/return-requests/[requestId]/attachments/[attachmentId]/route.ts"),
  returnRunbook: read("docs/5G_ROUTER_UAT_ROLLOUT.md"),
};

const agentDashboardSource = sources.commerce.split(
  "export async function loadProductAgentDashboard"
)[1] || "";

const checks = [
  ["stock summary is exact and service-only",
    sources.migration.includes("get_product_inventory_stock_summary")
      && sources.migration.includes("REVOKE ALL ON FUNCTION")
      && sources.stockRoute.includes("get_product_inventory_stock_summary")],
  ["finance summary is exact and uncapped",
    sources.migration.includes("get_product_inventory_finance_summary")
      && sources.migration.includes("inventoryGlBalance")],
  ["agent balances are server-side aggregates",
    sources.migration.includes("get_product_inventory_agent_balances")
      && sources.commerce.includes("get_product_inventory_agent_balances")],
  ["agent DTO omits cost and profit fields",
    !agentDashboardSource.includes("unit_cost_snapshot")
      && !agentDashboardSource.includes("gross_profit")
      && !agentDashboardSource.includes("custody_cost")],
  ["unit, movement, and receipt feeds are paginated",
    sources.stockRoute.includes(".range(paging.from, paging.to)")
      && sources.movementRoute.includes(".range(paging.from, paging.to)")
      && sources.receiptRoute.includes(".range(paging.from, paging.to)")],
  ["large-feed indexes are present",
    sources.migration.includes("product_inventory_units_org_created_idx")
      && sources.migration.includes("product_inventory_movements_org_date_idx")
      && sources.migration.includes("product_receipts_org_created_idx")],
  ["inventory monitoring is authenticated and thresholded",
    sources.healthRoute.includes("timingSafeEqual")
      && sources.healthRoute.includes("OUTBOX_WORKER_SECRET")
      && sources.healthRoute.includes("stale_commands")
      && sources.healthRoute.includes("failed_accounting_postings")
      && sources.healthRoute.includes("overdue_accounting_postings")],
  ["workbook upload remains bounded and inspected",
    sources.workbookRoute.includes("inspectUpload")
      && sources.workbookRoute.includes("PRODUCT_INVENTORY_IMPORT_MAX_ROWS")
      && sources.workbookRoute.includes("10000")],
  ["photo upload remains bounded and inspected",
    sources.photoRoute.includes("inspectUpload")
      && sources.photoRoute.includes("maxTotalBytes")
      && sources.photoRoute.includes("manifestSchema")],
  ["browser OCR is packaged and loaded from the application origin",
    sources.photoExtraction.includes("createLocalEnglishOcrWorker")
      && sources.localTesseract.includes('workerPath: "/ocr/tesseract/worker.min.js"')
      && sources.localTesseract.includes("workerBlobURL: false")
      && sources.prepareOcrAssets.includes("eng.traineddata.gz")
      && sources.packageJson.includes('"prebuild": "npm run prepare:ocr"')],
  ["receipt and sale rollback drills are executable",
    sources.databaseTests.includes("Injected Phase 6 product outbox failure")
      && sources.databaseTests.includes("receipt_failure_observed")
      && sources.databaseTests.includes("sale_failure_observed")],
  ["concurrent receipt confirmation has one winner",
    sources.databaseTests.includes("testConcurrentProductReceiptConfirmation")
      && sources.databaseTests.includes("Concurrent receipt confirmation did not produce exactly one winner")],
  ["return evidence upload is private, bounded, inspected, and cleaned up",
    sources.returnRoute.includes("inspectUpload")
      && sources.returnRoute.includes("maxTotalBytes")
      && sources.returnRoute.includes("removeObjects")
      && sources.returnAttachmentRoute.includes("downloadObject")
      && sources.returnAttachmentRoute.includes('"cache-control": "private, no-store"')],
  ["return reconciliation is service-only with tenant-key constraints",
    sources.returnHardening.includes("get_product_inventory_return_reconciliation")
      && sources.returnHardening.includes("'balanced'")
      && sources.returnHardening.includes("REVOKE ALL ON FUNCTION")
      && sources.returnHardening.includes("product_return_request_lines_request_org_fk")
      && sources.returnHardening.includes("product_return_request_lines_unit_org_fk")],
  ["return monitoring covers approval, delivery, custody, and damage accounting",
    sources.healthRoute.includes("overdue_return_approvals")
      && sources.healthRoute.includes("overdue_return_deliveries")
      && sources.healthRoute.includes("failed_return_damage_accounting")
      && sources.healthRoute.includes("staleCustodyCommands")],
  ["concurrent return review has one winner",
    sources.databaseTests.includes("testConcurrentProductReturnReview")
      && sources.databaseTests.includes("Concurrent return approval did not produce exactly one winner")],
  ["router-return UAT, reconciliation, rollout, rollback, and sign-off procedures exist",
    sources.returnRunbook.includes("Required UAT matrix")
      && sources.returnRunbook.includes("get_product_inventory_return_reconciliation")
      && sources.returnRunbook.includes("Controlled rollout")
      && sources.returnRunbook.includes("Rollback and forward-fix")
      && sources.returnRunbook.includes("Sign-off")],
  ["support, rollback, monitoring, pilot, and sign-off procedures exist",
    sources.runbook.includes("Rollback and forward-fix")
      && sources.runbook.includes("Controlled pilot")
      && sources.runbook.includes("UAT sign-off")
      && sources.runbook.includes("/api/internal/product-inventory")],
];

let failed = 0;
for (const [name, passed] of checks) {
  if (passed) {
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL ${name}`);
  }
}

if (failed > 0) {
  throw new Error(`${failed} product inventory hardening contract check(s) failed.`);
}

console.log("Product inventory Phase 6 hardening contract passed.");
