import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateReceiptTotals,
  normalizeSerial,
  parseSerialNumbers,
} from "../src/lib/product-inventory/normalization";
import { manualReceiptSchema } from "../src/lib/product-inventory/schemas";
import {
  buildInventoryImportCsv,
  parseCsvRows,
  parseProductInventoryWorkbookRows,
} from "../src/lib/product-inventory/workbook";
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

test("inventory receiver and finance routes follow least-privilege role boundaries", () => {
  assert.equal(roleFromOrgRole("inventory_receiver"), "Inventory_Receiver");
  assert.equal(getDefaultPathForRole("Inventory_Receiver"), "/sales/inventory");
  assert.equal(canAccessPath("Inventory_Receiver", "/sales/inventory/receipts/new"), true);
  assert.equal(canAccessPath("Inventory_Receiver", "/sales/inventory/receipts/import"), true);
  assert.equal(canAccessPath("Inventory_Receiver", "/api/sales/inventory/stock"), true);
  assert.equal(canAccessPath("Inventory_Receiver", "/sales/products"), false);
  assert.equal(canAccessPath("Inventory_Receiver", "/accounting/inventory"), false);
  assert.equal(canAccessPath("Accountant", "/accounting/inventory"), true);
  assert.equal(canAccessPath("Accountant", "/sales/inventory"), false);
});
