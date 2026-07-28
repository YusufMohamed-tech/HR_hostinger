import type {
  ManualReceiptInput,
  ProductInventoryCompany,
  ProductInventoryProduct,
  ProductInventoryStockRow,
  ProductInventoryWarehouse,
  ProductReceipt,
} from "@/types/product-inventory";

type ApiResult<T> = { data: T | null; error: string | null };

async function apiFetch<T>(path: string, options?: RequestInit): Promise<ApiResult<T>> {
  try {
    const response = await fetch(path, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
    });
    const payload = await response.json().catch(() => ({})) as {
      data?: T;
      message?: string;
      error?: string;
    };
    if (!response.ok) {
      return { data: null, error: payload.message || payload.error || "تعذر تنفيذ طلب المخزون." };
    }
    return { data: payload.data ?? null, error: null };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : "تعذر الاتصال بالخادم." };
  }
}

export function newInventoryCommandId() {
  return crypto.randomUUID();
}

export function getProductInventorySetup() {
  return apiFetch<{
    companies: ProductInventoryCompany[];
    warehouses: ProductInventoryWarehouse[];
    products: ProductInventoryProduct[];
  }>("/api/sales/inventory/setup");
}

export function getProductReceipts() {
  return apiFetch<ProductReceipt[]>("/api/sales/inventory/receipts");
}

export function getProductReceipt(receiptId: string) {
  return apiFetch<ProductReceipt>(`/api/sales/inventory/receipts/${receiptId}`);
}

export function saveManualReceipt(input: ManualReceiptInput & { command_id: string }) {
  return apiFetch<ProductReceipt>("/api/sales/inventory/receipts", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function confirmProductReceipt(receiptId: string, expectedVersion: number, commandId: string) {
  return apiFetch<ProductReceipt>(`/api/sales/inventory/receipts/${receiptId}/confirm`, {
    method: "POST",
    body: JSON.stringify({ expected_version: expectedVersion, command_id: commandId }),
  });
}

export function cancelProductReceipt(receiptId: string, expectedVersion: number, reason: string, commandId: string) {
  return apiFetch<ProductReceipt>(`/api/sales/inventory/receipts/${receiptId}/cancel`, {
    method: "POST",
    body: JSON.stringify({ expected_version: expectedVersion, reason, command_id: commandId }),
  });
}

export function getProductStock() {
  return apiFetch<{ rows: ProductInventoryStockRow[]; totals: { units: number; cost: number; expectedSales: number; margin: number } }>(
    "/api/sales/inventory/stock"
  );
}

export function getFinanceProductInventory() {
  return apiFetch<{
    receipts: ProductReceipt[];
    totals: { units: number; cost: number; expectedSales: number; margin: number };
  }>("/api/accounting/inventory");
}
