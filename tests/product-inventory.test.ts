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
  manualReceiptSchema,
} from "../src/lib/product-inventory/schemas";
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
import { canAccessPath, getDefaultPathForRole, roleFromOrgRole } from "../src/lib/rbac";
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

test("inventory receiver and finance routes follow least-privilege role boundaries", () => {
  assert.equal(roleFromOrgRole("inventory_receiver"), "Inventory_Receiver");
  assert.equal(getDefaultPathForRole("Inventory_Receiver"), "/sales/inventory");
  assert.equal(canAccessPath("Inventory_Receiver", "/sales/inventory/receipts/new"), true);
  assert.equal(canAccessPath("Inventory_Receiver", "/sales/inventory/receipts/import"), true);
  assert.equal(canAccessPath("Inventory_Receiver", "/sales/inventory/receipts/photo"), true);
  assert.equal(canAccessPath("Inventory_Receiver", "/api/sales/inventory/stock"), true);
  assert.equal(canAccessPath("Inventory_Receiver", "/sales/inventory/assignments"), false);
  assert.equal(canAccessPath("Inventory_Receiver", "/api/sales/inventory/handovers"), false);
  assert.equal(canAccessPath("Inventory_Receiver", "/sales/products"), false);
  assert.equal(canAccessPath("Inventory_Receiver", "/accounting/inventory"), false);
  assert.equal(canAccessPath("Accountant", "/accounting/inventory"), true);
  assert.equal(canAccessPath("Accountant", "/sales/inventory"), false);
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
