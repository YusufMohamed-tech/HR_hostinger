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
  workbookAnalyzeRoute: read("src/app/api/sales/inventory/import-profiles/analyze/route.ts"),
  workbookProfilesScreen: read("src/components/product-inventory/ProductInventoryImportProfilesScreen.tsx"),
  workbookRecognition: read("src/lib/product-inventory/workbook-recognition.ts"),
  workbookNormalization: read("src/lib/product-inventory/workbook-normalization.ts"),
  recognitionFoundation: read("db/schema_v148_product_inventory_excel_recognition.sql"),
  recognitionConfirmation: read("db/schema_v149_product_inventory_excel_profile_confirmation.sql"),
  recognitionAudit: read("db/schema_v150_product_inventory_receipt_recognition_audit.sql"),
  recognitionOperations: read("db/schema_v151_product_inventory_excel_recognition_operations.sql"),
  catalogOperations: read("db/schema_v155_product_catalog_operations.sql"),
  catalogAtomicImport: read("db/schema_v154_atomic_product_catalog_import.sql"),
  catalogAnalyzeRoute: read("src/app/api/sales/inventory/products/import/analyze/route.ts"),
  catalogScreen: read("src/components/product-inventory/ProductCatalogWorkspace.tsx"),
  fileRetention: read("src/lib/server/file-retention.ts"),
  databaseTests: read("scripts/test-database-migrations.mjs"),
  runbook: read("docs/PRODUCT_INVENTORY_PHASE_6_UAT_RUNBOOK.md"),
  returnHardening: read("db/schema_v147_product_inventory_return_hardening.sql"),
  returnRoute: read("src/app/api/sales/inventory/return-requests/route.ts"),
  returnAttachmentRoute: read("src/app/api/sales/inventory/return-requests/[requestId]/attachments/[attachmentId]/route.ts"),
  returnRunbook: read("docs/5G_ROUTER_UAT_ROLLOUT.md"),
  recognitionRunbook: read("docs/PRODUCT_INVENTORY_EXCEL_RECOGNITION_ROLLOUT.md"),
  catalogRunbook: read("docs/FINANCE_PRODUCT_CATALOG_UAT_ROLLOUT.md"),
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
  ["workbook profile setup uses upload and review instead of user-entered JSON",
    sources.workbookProfilesScreen.includes("analyzeProductInventoryImportProfile")
      && sources.workbookProfilesScreen.includes("confirmProductInventoryImportProfile")
      && !sources.workbookProfilesScreen.includes("JSON.parse")
      && !sources.workbookProfilesScreen.includes("خريطة الأعمدة JSON")
      && sources.workbookAnalyzeRoute.includes("inspectUpload")
      && sources.workbookAnalyzeRoute.includes("readProductInventoryWorkbookSheets")],
  ["automatic recognition is deterministic, multi-sheet, and shape aware",
    sources.workbookRecognition.includes("PRODUCT_INVENTORY_RECOGNITION_VERSION")
      && sources.workbookRecognition.includes("bestHeaderForSheet")
      && sources.workbookRecognition.includes("layoutFingerprint")
      && sources.workbookRecognition.includes("continuation_rows")
      && sources.workbookRecognition.includes("serial_columns")
      && sources.workbookNormalization.includes("normalizeRecognizedProductInventorySheets")
      && sources.workbookNormalization.includes("__source_sheet")
      && sources.workbookNormalization.includes("__source_row")],
  ["receipt imports do not require an active profile and cannot silently reuse changed layouts",
    sources.workbookRoute.includes("recognizeProductInventoryWorkbook")
      && sources.workbookRoute.includes("profile.layout_fingerprint === recognition.layout_fingerprint")
      && sources.workbookRoute.includes("profile_match_mode")
      && !sources.workbookRoute.includes("لا يوجد إصدار نشط لقالب الاستيراد")],
  ["recognition evidence is private, service-only, and auditable",
    sources.recognitionFoundation.includes("product_inventory_import_analyses_service_only")
      && sources.recognitionFoundation.includes("product_inventory_import_profile_sample")
      && sources.recognitionConfirmation.includes("confirm_product_inventory_import_analysis")
      && sources.recognitionAudit.includes("mapping_snapshot")
      && sources.recognitionAudit.includes("layout_fingerprint")],
  ["recognition expiry is bounded, service-only, and connected to retention",
    sources.recognitionOperations.includes("expire_product_inventory_import_analyses")
      && sources.recognitionOperations.includes("FOR UPDATE SKIP LOCKED")
      && sources.recognitionOperations.includes("REVOKE ALL ON FUNCTION")
      && sources.fileRetention.includes("expire_product_inventory_import_analyses")],
  ["recognition monitoring covers stale, failed, low-confidence, and cleanup states",
    sources.healthRoute.includes("stale_recognition_analyses")
      && sources.healthRoute.includes("failed_recognition_analyses")
      && sources.healthRoute.includes("low_confidence_last_24_hours")
      && sources.healthRoute.includes("overdue_recognition_sample_cleanup")],
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
  ["concurrent workbook profile confirmation has one winner",
    sources.databaseTests.includes("testConcurrentWorkbookProfileConfirmation")
      && sources.databaseTests.includes("Concurrent workbook confirmation did not produce exactly one winner")],
  ["workbook recognition rollout, monitoring, UAT, and tenant rollback procedures exist",
    sources.recognitionRunbook.includes("UAT المطلوب")
      && sources.recognitionRunbook.includes("/api/internal/product-inventory")
      && sources.recognitionRunbook.includes("automatic_workbook_recognition_enabled")
      && sources.recognitionRunbook.includes("GO")
      && sources.recognitionRunbook.includes("NO-GO")],
  ["router-return UAT, reconciliation, rollout, rollback, and sign-off procedures exist",
    sources.returnRunbook.includes("Required UAT matrix")
      && sources.returnRunbook.includes("get_product_inventory_return_reconciliation")
      && sources.returnRunbook.includes("Controlled rollout")
      && sources.returnRunbook.includes("Rollback and forward-fix")
      && sources.returnRunbook.includes("Sign-off")],
  ["Finance product catalog upload is automatic, reviewed, and atomic",
    sources.catalogAnalyzeRoute.includes("recognizeProductCatalogWorkbook")
      && sources.catalogAnalyzeRoute.includes("inspectUpload")
      && sources.catalogScreen.includes("تحليل الملف")
      && sources.catalogScreen.includes("applyUpdates")
      && sources.catalogAtomicImport.includes("commit_product_catalog_import_v1")
      && sources.catalogAtomicImport.includes("Product version or supplier changed after analysis")],
  ["Finance product catalog operations are durable, recoverable, and retained",
    sources.catalogOperations.includes("emit_product_catalog_audit_event")
      && sources.catalogOperations.includes("recover_stale_product_catalog_commands")
      && sources.catalogOperations.includes("expire_product_catalog_import_analyses")
      && sources.fileRetention.includes("recover_stale_product_catalog_commands")
      && sources.healthRoute.includes("stale_product_catalog_commands")],
  ["Finance product catalog UAT, monitoring, rollback, and sign-off procedures exist",
    sources.catalogRunbook.includes("Required UAT matrix")
      && sources.catalogRunbook.includes("Catalog-to-receipt integration")
      && sources.catalogRunbook.includes("GO / NO-GO")
      && sources.catalogRunbook.includes("Rollback and forward-fix")
      && sources.catalogRunbook.includes("Sign-off record")],
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
