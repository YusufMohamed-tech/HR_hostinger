import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateReceiptTotals,
  normalizeSerial,
  parseSerialNumbers,
} from "../src/lib/product-inventory/normalization";
import { manualReceiptSchema } from "../src/lib/product-inventory/schemas";
import { canAccessPath, getDefaultPathForRole, roleFromOrgRole } from "../src/lib/rbac";

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

test("inventory receiver and finance routes follow least-privilege role boundaries", () => {
  assert.equal(roleFromOrgRole("inventory_receiver"), "Inventory_Receiver");
  assert.equal(getDefaultPathForRole("Inventory_Receiver"), "/sales/inventory");
  assert.equal(canAccessPath("Inventory_Receiver", "/sales/inventory/receipts/new"), true);
  assert.equal(canAccessPath("Inventory_Receiver", "/api/sales/inventory/stock"), true);
  assert.equal(canAccessPath("Inventory_Receiver", "/sales/products"), false);
  assert.equal(canAccessPath("Inventory_Receiver", "/accounting/inventory"), false);
  assert.equal(canAccessPath("Accountant", "/accounting/inventory"), true);
  assert.equal(canAccessPath("Accountant", "/sales/inventory"), false);
});
