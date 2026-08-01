import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateReceiptTotals,
  normalizeSerial,
  parseSerialNumbers,
} from "../src/lib/product-inventory/normalization";
import {
  agentProductCollectionSchema,
  agentProductSaleSchema,
  productHandoverSchema,
  productPriceOverrideRequestSchema,
  productPriceOverrideReviewSchema,
  productInventoryLossSchema,
  productInventoryOperationalAssignmentSchema,
  productEmployeeHandoverSchema,
  productEmployeeHandoverAcceptSchema,
  manualReceiptSchema,
  workbookCommitSchema,
} from "../src/lib/product-inventory/schemas";
import {
  buildProductCollectionAccountingLines,
  buildProductLossAccountingLines,
  buildProductReceiptAccountingLines,
  buildProductSaleAccountingLines,
  productAccountingBalance,
} from "../src/lib/product-inventory/accounting";
import {
  buildInventoryImportCsv,
  parseCsvRows,
  parseProductInventoryWorkbookRows,
} from "../src/lib/product-inventory/workbook";
import {
  parseProductPhotoExtraction,
  PRODUCT_PHOTO_EXTRACTION_VERSION,
  type ProductPhotoRawExtraction,
} from "../src/lib/product-inventory/photo-extraction";
import { LOCAL_TESSERACT_ASSET_PATHS } from "../src/lib/ocr/local-tesseract";
import {
  canAccessPath,
  getDefaultPathForRole,
  isPublicPath,
  roleFromOrgRole,
} from "../src/lib/rbac";
import type { ProductInventoryProduct } from "../src/types/product-inventory";

test("serial normalization groups formatting variants and removes duplicates", () => {
  assert.equal(normalizeSerial(" vg-123 45 "), "VG12345");
  assert.deepEqual(
    parseSerialNumbers("vg-123\nVG123\nSN-002, SN-003;SN-002"),
    ["vg-123", "SN-002", "SN-003"]
  );
});

test("receipt totals derive counts, cost, selling value, and margin from serials", () => {
  assert.deepEqual(
    calculateReceiptTotals([
      { unit_cost: 60, planned_sale_price: 100, serial_numbers: ["A", "B"] },
      { unit_cost: 25.5, planned_sale_price: 40, serial_numbers: ["C"] },
    ]),
    { units: 3, cost: 145.5, expectedSales: 240, margin: 94.5 }
  );
});

test("manual receipt validation requires positive group prices and unique serials", () => {
  const base = {
    receipt_id: "10000000-0000-4000-8000-000000000001",
    expected_version: 0,
    supplier_company_id: "10000000-0000-4000-8000-000000000002",
    warehouse_id: "10000000-0000-4000-8000-000000000003",
    ownership_type: "purchased",
    receipt_date: "2026-07-28",
    currency: "SAR",
    command_id: "10000000-0000-4000-8000-000000000004",
  };
  const valid = manualReceiptSchema.safeParse({
    ...base,
    groups: [{
      product_id: "10000000-0000-4000-8000-000000000005",
      unit_cost: 60,
      planned_sale_price: 100,
      currency: "SAR",
      tax_included: true,
      condition: "new",
      serial_numbers: ["VG-1", "VG-2"],
    }],
  });
  assert.equal(valid.success, true);

  const invalid = manualReceiptSchema.safeParse({
    ...base,
    groups: [{
      product_id: "10000000-0000-4000-8000-000000000005",
      unit_cost: 0,
      planned_sale_price: 100,
      currency: "SAR",
      tax_included: true,
      condition: "new",
      serial_numbers: ["VG-1", "VG1"],
    }],
  });
  assert.equal(invalid.success, false);
});

test("Finance commercial terms enforce price ranges and commission caps", () => {
  const base = {
    receipt_id: "10000000-0000-4000-8000-000000000011",
    expected_version: 0,
    supplier_company_id: "10000000-0000-4000-8000-000000000012",
    warehouse_id: "10000000-0000-4000-8000-000000000013",
    ownership_type: "purchased",
    receipt_date: "2026-08-01",
    currency: "SAR",
    command_id: "10000000-0000-4000-8000-000000000014",
    groups: [{
      product_id: "10000000-0000-4000-8000-000000000015",
      unit_cost: 60,
      planned_sale_price: 100,
      minimum_sale_price: 90,
      maximum_sale_price: 120,
      commission_type: "percentage",
      commission_value: 12.5,
      commission_base: "net_amount",
      currency: "SAR",
      tax_included: true,
      condition: "new",
      serial_numbers: ["COMM-1"],
    }],
  };
  assert.equal(manualReceiptSchema.safeParse(base).success, true);
  assert.equal(manualReceiptSchema.safeParse({
    ...base,
    groups: [{ ...base.groups[0], minimum_sale_price: 110, commission_value: 101 }],
  }).success, false);
});

const workbookProducts: ProductInventoryProduct[] = [{
  id: "10000000-0000-4000-8000-000000000101",
  company_id: "10000000-0000-4000-8000-000000000102",
  name: "Virgin Home Router",
  sku: "VHR-5G",
  barcode: "6280000000001",
  model: "V5",
  price: 100,
  default_cost: 60,
}];

test("versioned workbook mapping accepts client-specific headers and commission proposals", () => {
  const parsed = parseProductInventoryWorkbookRows([
    ["Router Code", "Client Serial", "Client Cost", "Client Sale", "Commission Kind", "Commission Value"],
    ["VHR-5G", "00012345", 60, 100, "percentage", 10],
  ], {
    products: workbookProducts,
    headerMapping: {
      "Router Code": "product_sku",
      "Client Serial": "serial_number",
      "Client Cost": "unit_cost",
      "Client Sale": "planned_sale_price",
      "Commission Kind": "commission_type",
      "Commission Value": "commission_value",
    },
  });
  assert.equal(parsed.rows[0]?.serial_number, "00012345");
  assert.equal(parsed.rows[0]?.commission_type, "percentage");
  assert.equal(parsed.rows[0]?.commission_value, 10);
  assert.equal(parsed.rows[0]?.minimum_sale_price, 100);
  assert.equal(parsed.rows[0]?.status, "valid");
});

function photoExtraction(
  rawText: string,
  barcodeValues: string[] = [],
  ocrConfidence = 96
): ProductPhotoRawExtraction {
  return {
    raw_text: rawText,
    ocr_confidence: ocrConfidence,
    barcode_values: barcodeValues,
    bounding_boxes: [],
    engine: "tesseract-zxing-local",
    version: PRODUCT_PHOTO_EXTRACTION_VERSION,
  };
}

test("workbook parser accepts Arabic headers and preserves text serial leading zeros", () => {
  const parsed = parseProductInventoryWorkbookRows([
    ["كود المنتج", "الرقم التسلسلي", "تكلفة الوحدة", "سعر البيع", "العملة", "حالة المنتج"],
    ["VHR-5G", "00001234", 60, 100, "sar", "مفتوح"],
  ], { products: workbookProducts });

  assert.equal(parsed.rows[0]?.status, "valid");
  assert.equal(parsed.rows[0]?.serial_number, "00001234");
  assert.equal(parsed.rows[0]?.normalized_serial, "00001234");
  assert.equal(parsed.rows[0]?.product_id, workbookProducts[0]?.id);
  assert.equal(parsed.rows[0]?.condition, "open_box");
  assert.equal(parsed.rows[0]?.currency, "SAR");
  assert.equal(parsed.rows[0]?.row_number, 2);
});

test("workbook parser flags duplicate, numeric, unmatched, and formula-like rows", () => {
  const parsed = parseProductInventoryWorkbookRows([
    ["product_sku", "serial_number", "unit_cost", "planned_sale_price", "currency"],
    ["VHR-5G", "VG-0001", 60, 100, "SAR"],
    ["VHR-5G", "vg 0001", 60, 100, "SAR"],
    ["VHR-5G", 1234, 60, 100, "SAR"],
    ["UNKNOWN", "=1+1", 60, 100, "SAR"],
  ], { products: workbookProducts });

  assert.equal(parsed.rows[0]?.status, "valid");
  assert.equal(parsed.rows[1]?.status, "duplicate");
  assert.match(parsed.rows[2]?.validation_errors.join(" ") || "", /formatted as text/u);
  assert.equal(parsed.rows[3]?.status, "unmatched");
  assert.match(parsed.rows[3]?.validation_errors.join(" ") || "", /missing or invalid/u);
});

test("CSV parser handles quoted values and error export neutralizes spreadsheet formulas", () => {
  const csvRows = parseCsvRows('product_sku,serial_number,notes\r\nVHR-5G,"VG,0002","router ""box"""\r\n');
  assert.deepEqual(csvRows[1], ["VHR-5G", "VG,0002", 'router "box"']);

  const parsed = parseProductInventoryWorkbookRows([
    ["product_sku", "serial_number", "unit_cost", "planned_sale_price", "notes"],
    ["VHR-5G", "VG-0002", 60, 100, "=HYPERLINK(\"bad\")"],
  ], { products: workbookProducts });
  const exported = buildInventoryImportCsv(parsed.rows);
  assert.match(exported, /"'=HYPERLINK/u);
});

test("photo parser extracts labeled product, model, serials, and catalog prices", () => {
  const candidates = parseProductPhotoExtraction(
    photoExtraction(
      "Product Name: Virgin Home Router\nSKU: VHR-5G\nModel: V5\nS/N: VG-PHOTO-0001\nSerial No: VG-PHOTO-0002"
    ),
    {
      sourceId: "10000000-0000-4000-8000-000000000201",
      products: workbookProducts,
    }
  );

  assert.equal(candidates.length, 2);
  assert.deepEqual(candidates.map((candidate) => candidate.serial_number), [
    "VG-PHOTO-0001",
    "VG-PHOTO-0002",
  ]);
  assert.equal(candidates[0]?.product_id, workbookProducts[0]?.id);
  assert.equal(candidates[0]?.match_method, "sku");
  assert.equal(candidates[0]?.unit_cost, 60);
  assert.equal(candidates[0]?.planned_sale_price, 100);
  assert.equal(candidates[0]?.status, "valid");
  assert.ok((candidates[0]?.confidence ?? 0) >= 0.9);
});

test("photo parser uses barcode evidence and requires review for fallback or fuzzy matches", () => {
  const barcodeCandidates = parseProductPhotoExtraction(
    photoExtraction("", ["6280000000001", "VG-PHOTO-0003"], 80),
    {
      sourceId: "10000000-0000-4000-8000-000000000202",
      products: workbookProducts,
    }
  );
  assert.equal(barcodeCandidates[0]?.match_method, "barcode");
  assert.equal(barcodeCandidates[0]?.serial_number, "VG-PHOTO-0003");
  assert.equal(barcodeCandidates[0]?.status, "valid");

  const fuzzyCandidates = parseProductPhotoExtraction(
    photoExtraction("Product: Virgin Home Routr\nSerial: VG-PHOTO-0004", [], 88),
    {
      sourceId: "10000000-0000-4000-8000-000000000203",
      products: workbookProducts,
    }
  );
  assert.equal(fuzzyCandidates[0]?.match_method, "fuzzy");
  assert.equal(fuzzyCandidates[0]?.status, "warning");
  assert.match(fuzzyCandidates[0]?.validation_warnings.join(" ") || "", /similarity/u);
});

test("photo parser applies approved aliases and flags unresolved or duplicate serials", () => {
  const aliased = parseProductPhotoExtraction(
    photoExtraction("Product: Virgin 5G Box\nSerial: VG-PHOTO-0005", [], 94),
    {
      sourceId: "10000000-0000-4000-8000-000000000204",
      products: workbookProducts,
      aliases: [{
        product_id: workbookProducts[0]!.id,
        normalized_value: "virgin5gbox",
      }],
    }
  );
  assert.equal(aliased[0]?.match_method, "alias");
  assert.equal(aliased[0]?.status, "valid");

  const seen = new Set<string>();
  const existing = parseProductPhotoExtraction(
    photoExtraction("Product: Unknown Device\nS/N: VG-PHOTO-0006", [], 55),
    {
      sourceId: "10000000-0000-4000-8000-000000000205",
      products: workbookProducts,
      seenSerials: seen,
      existingSerials: new Set(["VGPHOTO0006"]),
    }
  );
  assert.equal(existing[0]?.status, "duplicate");
  assert.match(existing[0]?.validation_errors.join(" ") || "", /confirmed stock/u);

  const duplicated = parseProductPhotoExtraction(
    photoExtraction("Product: Unknown Device\nSerial: vg-photo-0006", [], 55),
    {
      sourceId: "10000000-0000-4000-8000-000000000207",
      products: workbookProducts,
      seenSerials: seen,
    }
  );
  assert.equal(duplicated[0]?.status, "duplicate");
  assert.match(duplicated[0]?.validation_errors.join(" ") || "", /selected photos/u);

  const unresolved = parseProductPhotoExtraction(
    photoExtraction("Product: Unknown Device", [], 90),
    {
      sourceId: "10000000-0000-4000-8000-000000000206",
      products: workbookProducts,
    }
  );
  assert.equal(unresolved[0]?.status, "unmatched");
  assert.match(unresolved[0]?.validation_errors.join(" ") || "", /Serial number/u);
});

test("finance manager owns receiving and legacy inventory receiver is retired", () => {
  assert.equal(roleFromOrgRole("inventory_receiver"), "Inventory_Receiver");
  assert.equal(getDefaultPathForRole("Inventory_Receiver"), "/notifications");
  assert.equal(canAccessPath("Inventory_Receiver", "/sales/inventory/receipts/new"), false);
  assert.equal(canAccessPath("Inventory_Receiver", "/api/sales/inventory/stock"), false);
  assert.equal(canAccessPath("Inventory_Receiver", "/notifications"), true);
  assert.equal(canAccessPath("Inventory_Receiver", "/api/sales/inventory/agent-collections"), false);
  assert.equal(canAccessPath("Inventory_Receiver", "/sales/products"), false);
  assert.equal(canAccessPath("Inventory_Receiver", "/accounting/inventory"), false);
  assert.equal(canAccessPath("Finance_Manager", "/sales/inventory/receipts/new"), true);
  assert.equal(canAccessPath("Finance_Manager", "/sales/inventory/assignments"), true);
  assert.equal(canAccessPath("Finance_Manager", "/api/sales/inventory/handovers"), true);
  assert.equal(canAccessPath("Finance_Manager", "/api/sales/inventory/price-overrides"), true);
  assert.equal(canAccessPath("Accountant", "/accounting/inventory"), true);
  assert.equal(canAccessPath("Accountant", "/sales/inventory"), false);
});

test("employee custody schemas enforce OG scope, unique serials, and image signatures", () => {
  const assignment = {
    employee_id: "10000000-0000-4000-8000-000000000021",
    project_id: "10000000-0000-4000-8000-000000000022",
    city: "القاهرة",
    position_code: "OGPM",
    responsibility: "project_manager",
    effective_from: "2026-08-01",
  };
  assert.equal(productInventoryOperationalAssignmentSchema.safeParse(assignment).success, true);
  assert.equal(productInventoryOperationalAssignmentSchema.safeParse({
    ...assignment,
    responsibility: "supervisor",
  }).success, false);

  const handover = {
    handover_id: "10000000-0000-4000-8000-000000000023",
    command_id: "10000000-0000-4000-8000-000000000024",
    warehouse_id: "10000000-0000-4000-8000-000000000025",
    assignment_id: "10000000-0000-4000-8000-000000000026",
    unit_ids: ["10000000-0000-4000-8000-000000000027"],
  };
  assert.equal(productEmployeeHandoverSchema.safeParse(handover).success, true);
  assert.equal(productEmployeeHandoverSchema.safeParse({
    ...handover,
    unit_ids: [handover.unit_ids[0], handover.unit_ids[0]],
  }).success, false);
  assert.equal(productEmployeeHandoverAcceptSchema.safeParse({
    command_id: handover.command_id,
    expected_version: 1,
    signature_data: "data:image/png;base64,abc",
  }).success, true);
  assert.equal(productEmployeeHandoverAcceptSchema.safeParse({
    command_id: handover.command_id,
    expected_version: 1,
    signature_data: "signed by name",
  }).success, false);
});

test("employee and supervisor can access only their own router custody surface", () => {
  assert.equal(canAccessPath("Employee", "/sales/inventory/custody"), true);
  assert.equal(canAccessPath("Employee", "/api/sales/inventory/custody"), true);
  assert.equal(canAccessPath("Employee", "/sales/inventory/employee-custody"), false);
  assert.equal(canAccessPath("Supervisor", "/sales/inventory/custody"), true);
  assert.equal(canAccessPath("Supervisor", "/api/sales/inventory/custody/handovers/abc/accept"), true);
  assert.equal(canAccessPath("Supervisor", "/api/sales/inventory/employee-handovers"), false);
  assert.equal(canAccessPath("Finance_Manager", "/sales/inventory/employee-custody"), true);
});

test("browser OCR assets stay on the application origin", () => {
  for (const assetPath of Object.values(LOCAL_TESSERACT_ASSET_PATHS)) {
    assert.match(assetPath, /^\/ocr\/tesseract\//u);
    assert.equal(assetPath.includes("cdn."), false);
  }
  assert.equal(isPublicPath("/ocr/tesseract/worker.min.js"), true);
  assert.equal(isPublicPath("/ocr/tesseract/lang/eng.traineddata.gz"), true);
});

test("Phase 4 commerce inputs enforce unique custody units, price ranges, and positive money", () => {
  const unitId = "10000000-0000-4000-8000-000000000301";
  const base = {
    handover_id: "10000000-0000-4000-8000-000000000302",
    command_id: "10000000-0000-4000-8000-000000000303",
    warehouse_id: "10000000-0000-4000-8000-000000000304",
    agent_id: "10000000-0000-4000-8000-000000000305",
  };
  assert.equal(productHandoverSchema.safeParse({
    ...base,
    units: [{ unit_id: unitId, minimum_sale_price: 90, maximum_sale_price: 110 }],
  }).success, true);
  assert.equal(productHandoverSchema.safeParse({
    ...base,
    units: [
      { unit_id: unitId, minimum_sale_price: 120, maximum_sale_price: 110 },
      { unit_id: unitId, minimum_sale_price: 90, maximum_sale_price: 110 },
    ],
  }).success, false);

  assert.equal(agentProductSaleSchema.safeParse({
    sale_id: "10000000-0000-4000-8000-000000000306",
    command_id: "10000000-0000-4000-8000-000000000307",
    unit_id: unitId,
    actual_sale_price: 100,
    sale_date: "2026-07-28",
    payment_method: "cash",
  }).success, true);
  assert.equal(agentProductCollectionSchema.safeParse({
    collection_id: "10000000-0000-4000-8000-000000000308",
    command_id: "10000000-0000-4000-8000-000000000309",
    agent_id: base.agent_id,
    amount: 0,
    payment_method: "cash",
    collection_date: "2026-07-28",
  }).success, false);
});

test("Phase 4 price exceptions require a reason and an explicit manager decision", () => {
  assert.equal(productPriceOverrideRequestSchema.safeParse({
    request_id: "10000000-0000-4000-8000-000000000310",
    command_id: "10000000-0000-4000-8000-000000000311",
    unit_id: "10000000-0000-4000-8000-000000000312",
    requested_price: 50,
    reason: "Client promotion approved in the field",
  }).success, true);
  assert.equal(productPriceOverrideRequestSchema.safeParse({
    request_id: "10000000-0000-4000-8000-000000000310",
    command_id: "10000000-0000-4000-8000-000000000311",
    unit_id: "10000000-0000-4000-8000-000000000312",
    requested_price: 50,
    reason: "no",
  }).success, false);
  assert.equal(productPriceOverrideReviewSchema.safeParse({
    command_id: "10000000-0000-4000-8000-000000000313",
    expected_version: 1,
    decision: "approved",
  }).success, true);
});

test("field agents receive only the Phase 4 self-service inventory routes", () => {
  assert.equal(canAccessPath("Field_Agent", "/agent/products"), true);
  assert.equal(canAccessPath("Field_Agent", "/api/sales/inventory/me/dashboard"), true);
  assert.equal(canAccessPath("Field_Agent", "/api/sales/inventory/agent-sales"), true);
  assert.equal(canAccessPath("Field_Agent", "/api/sales/inventory/price-overrides"), true);
  assert.equal(canAccessPath("Field_Agent", "/api/sales/inventory/stock"), false);
  assert.equal(canAccessPath("Field_Agent", "/api/sales/inventory/agent-collections"), false);
  assert.equal(canAccessPath("Onground_Agent_Manager", "/sales/inventory/assignments"), true);
});

test("Phase 5 receipt posting balances inventory against AP or GRNI by group", () => {
  const posting = buildProductReceiptAccountingLines({
    reference: "PRI-2026-000001",
    inventoryGroups: [
      { accountId: "inventory-router", cost: 120 },
      { accountId: "inventory-phone", cost: 80 },
    ],
    settlementAccountId: "grni",
    settlementDescription: "GRNI accrual PRI-2026-000001",
  });
  assert.equal(posting.totalCost, 200);
  assert.deepEqual(productAccountingBalance(posting.lines), {
    debit: 200,
    credit: 200,
    balanced: true,
  });
  assert.equal(posting.lines.find((line) => line.account_id === "grni")?.credit, 200);
});

test("Phase 5 sale posting balances agent receivable, revenue, VAT, COGS, and commission", () => {
  const posting = buildProductSaleAccountingLines({
    reference: "PS-2026-000001",
    receivableAccountId: "agent-ar",
    vatPayableAccountId: "vat-output",
    total: 115,
    vat: 15,
    saleLines: [{
      netAmount: 100,
      cost: 60,
      commission: 5,
      revenueAccountId: "revenue",
      cogsAccountId: "cogs",
      inventoryAccountId: "inventory",
    }],
    accrueCommission: true,
    commissionExpenseAccountId: "commission-expense",
    commissionPayableAccountId: "commission-payable",
  });
  assert.equal(posting.cost, 60);
  assert.equal(posting.revenue, 100);
  assert.equal(posting.commission, 5);
  assert.deepEqual(productAccountingBalance(posting.lines), {
    debit: 180,
    credit: 180,
    balanced: true,
  });
});

test("Phase 5 collection and loss postings are balanced and loss input is explicit", () => {
  const collection = buildProductCollectionAccountingLines({
    reference: "PC-2026-000001",
    receiptAccountId: "cash",
    receivableAccountId: "agent-ar",
    amount: 115,
  });
  const loss = buildProductLossAccountingLines({
    reference: "loss-1",
    shrinkageAccountId: "shrinkage",
    inventoryAccountId: "inventory",
    cost: 60,
  });
  assert.equal(productAccountingBalance(collection).balanced, true);
  assert.equal(productAccountingBalance(loss).balanced, true);
  assert.equal(productInventoryLossSchema.safeParse({
    loss_id: "10000000-0000-4000-8000-000000000401",
    command_id: "10000000-0000-4000-8000-000000000402",
    unit_id: "10000000-0000-4000-8000-000000000403",
    loss_type: "damage",
    reason: "Damaged during warehouse handling",
  }).success, true);
  assert.equal(productInventoryLossSchema.safeParse({
    loss_id: "10000000-0000-4000-8000-000000000401",
    command_id: "10000000-0000-4000-8000-000000000402",
    unit_id: "10000000-0000-4000-8000-000000000403",
    loss_type: "damage",
    reason: "bad",
  }).success, false);
});

test("Phase 6 validates and previews the 10,000-row workbook target without partial limits", {
  timeout: 15_000,
}, () => {
  const workbook = [
    ["product_sku", "serial_number", "unit_cost", "planned_sale_price", "currency"],
    ...Array.from({ length: 10_000 }, (_, index) => [
      "VHR-5G",
      `VG-PERF-${String(index + 1).padStart(6, "0")}`,
      60,
      100,
      "SAR",
    ]),
  ];
  const startedAt = performance.now();
  const parsed = parseProductInventoryWorkbookRows(workbook, {
    products: workbookProducts,
  });
  const elapsedMs = performance.now() - startedAt;
  assert.equal(parsed.rows.length, 10_000);
  assert.equal(parsed.rows.every((row) => row.status === "valid"), true);
  assert.ok(elapsedMs < 5_000, `10,000-row preview took ${elapsedMs.toFixed(1)}ms`);

  const command = {
    source_id: "10000000-0000-4000-8000-000000000501",
    expected_version: 1,
    command_id: "10000000-0000-4000-8000-000000000502",
    rows: parsed.rows,
  };
  assert.equal(workbookCommitSchema.safeParse(command).success, true);
  assert.equal(workbookCommitSchema.safeParse({
    ...command,
    rows: [...parsed.rows, parsed.rows[0]],
  }).success, false);
});

test("Phase 6 keeps handovers bounded to the documented 200-unit chunk", () => {
  const units = Array.from({ length: 201 }, (_, index) => ({
    unit_id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    minimum_sale_price: 90,
    maximum_sale_price: 110,
  }));
  const input = {
    handover_id: "10000000-0000-4000-8000-000000000601",
    command_id: "10000000-0000-4000-8000-000000000602",
    warehouse_id: "10000000-0000-4000-8000-000000000603",
    agent_id: "10000000-0000-4000-8000-000000000604",
    units,
  };
  assert.equal(productHandoverSchema.safeParse(input).success, false);
  assert.equal(productHandoverSchema.safeParse({
    ...input,
    units: units.slice(0, 200),
  }).success, true);
});
