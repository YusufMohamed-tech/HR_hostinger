import { Suspense } from "react";
import { ManualProductReceiptScreen } from "@/components/product-inventory/ProductInventoryScreens";
import { PageSkeleton } from "@/components/Skeletons";

export default function NewProductReceiptPage() {
  return <Suspense fallback={<PageSkeleton />}><ManualProductReceiptScreen /></Suspense>;
}
