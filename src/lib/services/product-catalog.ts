import type {
  ProductCatalogOptions,
  ProductCatalogProduct,
} from "@/types/product-catalog";
import type { ProductInventoryPagination } from "@/lib/services/product-inventory";

type ApiResult<T> = { data: T | null; error: string | null };

async function catalogFetch<T>(path: string, options?: RequestInit): Promise<ApiResult<T>> {
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
      return { data: null, error: payload.message || payload.error || "تعذر تنفيذ طلب كتالوج المنتجات." };
    }
    return { data: payload.data ?? null, error: null };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : "تعذر الاتصال بالخادم." };
  }
}

export type ProductCatalogFormValues = {
  company_id: string;
  name: string;
  description?: string | null;
  unit: string;
  category?: string | null;
  sku?: string | null;
  barcode?: string | null;
  model?: string | null;
  price: number;
  default_cost: number;
  commission_type: "none" | "flat" | "percentage";
  commission_value: number;
  revenue_account_id?: string | null;
  is_active: boolean;
};

export function getProductCatalog(options: {
  page?: number;
  pageSize?: number;
  search?: string;
  companyId?: string;
  status?: "active" | "inactive" | "all";
} = {}) {
  const params = new URLSearchParams({
    page: String(options.page || 1),
    page_size: String(options.pageSize || 25),
    status: options.status || "active",
  });
  if (options.search?.trim()) params.set("q", options.search.trim());
  if (options.companyId) params.set("company_id", options.companyId);
  return catalogFetch<{
    rows: ProductCatalogProduct[];
    pagination: ProductInventoryPagination;
  }>(`/api/sales/inventory/products?${params.toString()}`);
}

export function getProductCatalogOptions() {
  return catalogFetch<ProductCatalogOptions>("/api/sales/inventory/products/options");
}

export function createProductCatalogProduct(values: ProductCatalogFormValues, commandId: string) {
  return catalogFetch<ProductCatalogProduct>("/api/sales/inventory/products", {
    method: "POST",
    body: JSON.stringify({ ...values, command_id: commandId }),
  });
}

export function updateProductCatalogProduct(
  productId: string,
  values: ProductCatalogFormValues,
  expectedVersion: number,
  commandId: string
) {
  return catalogFetch<ProductCatalogProduct>(`/api/sales/inventory/products/${productId}`, {
    method: "PATCH",
    body: JSON.stringify({ ...values, expected_version: expectedVersion, command_id: commandId }),
  });
}

export function setProductCatalogStatus(
  productId: string,
  isActive: boolean,
  expectedVersion: number,
  commandId: string
) {
  return catalogFetch<ProductCatalogProduct>(`/api/sales/inventory/products/${productId}/status`, {
    method: "POST",
    body: JSON.stringify({ is_active: isActive, expected_version: expectedVersion, command_id: commandId }),
  });
}
