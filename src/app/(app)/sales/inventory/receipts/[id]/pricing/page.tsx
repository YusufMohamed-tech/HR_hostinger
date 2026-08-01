import { ProductInventoryPricingScreen } from "@/components/product-inventory/ProductInventoryPricingScreen";

export default async function ProductInventoryPricingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProductInventoryPricingScreen receiptId={id} />;
}
