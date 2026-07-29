export function normalizeSerial(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function parseSerialNumbers(value: string) {
  const seen = new Set<string>();
  return value
    .split(/[\n,;\t]+/)
    .map((serial) => serial.trim())
    .filter((serial) => {
      const normalized = normalizeSerial(serial);
      if (!normalized || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
}

export function calculateReceiptTotals(
  groups: Array<{ unit_cost: number; planned_sale_price: number; serial_numbers: string[] }>
) {
  return groups.reduce(
    (totals, group) => {
      const quantity = group.serial_numbers.length;
      totals.units += quantity;
      totals.cost += quantity * group.unit_cost;
      totals.expectedSales += quantity * group.planned_sale_price;
      totals.margin += quantity * (group.planned_sale_price - group.unit_cost);
      return totals;
    },
    { units: 0, cost: 0, expectedSales: 0, margin: 0 }
  );
}
