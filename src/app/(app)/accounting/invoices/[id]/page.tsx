import { AccountingDetailPage } from "@/components/accounting/AccountingScreens";

export default function InvoiceDetailPage({ params }: { params: { id: string } }) {
  return <AccountingDetailPage entity="invoices" id={params.id} />;
}
