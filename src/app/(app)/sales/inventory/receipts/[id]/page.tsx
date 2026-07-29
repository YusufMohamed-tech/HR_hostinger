import { ProductReceiptDetailScreen } from "@/components/product-inventory/ProductInventoryScreens";

export default async function ProductReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProductReceiptDetailScreen receiptId={id} />;
}
