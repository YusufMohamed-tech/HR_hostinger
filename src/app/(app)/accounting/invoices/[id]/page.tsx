import { AccountingDetailPage } from "@/components/accounting/AccountingScreens";

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AccountingDetailPage entity="invoices" id={id} />;
}
