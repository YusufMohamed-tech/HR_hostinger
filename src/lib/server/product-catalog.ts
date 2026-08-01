import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import { productInventoryDb } from "@/lib/server/product-inventory-api";
import type { ProductCatalogProductInput } from "@/lib/product-catalog/schemas";

export async function productCatalogEnabled(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string
) {
  const { data, error } = await productInventoryDb(admin)
    .from("product_inventory_commerce_settings")
    .select("finance_product_catalog_enabled")
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return data?.finance_product_catalog_enabled !== false;
}
export async function executeProductCatalogProductCommand(
  admin: ReturnType<typeof createAdminClient>,
  values: {
    orgId: string;
    actorUserId: string;
    requestId: string;
    commandId: string;
    action: "create" | "update" | "set_active";
    payload: ProductCatalogProductInput | {
      product_id: string;
      expected_version: number;
      is_active: boolean;
    };
  }
) {
  const { data, error } = await productInventoryDb(admin).rpc(
    "execute_product_catalog_product_command",
    {
      p_org_id: values.orgId,
      p_actor_user_id: values.actorUserId,
      p_request_id: values.requestId,
      p_command_id: values.commandId,
      p_action: values.action,
      p_payload: values.payload,
    }
  );
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  const result = data as { product?: Record<string, unknown> } | null;
  if (!result?.product) throw new Error("Product catalog command returned no product.");
  return result.product;
}
