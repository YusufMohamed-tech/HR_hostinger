import { AccountingDetailPage } from "@/components/accounting/AccountingScreens";

export default async function ExpenseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AccountingDetailPage entity="expenses" id={id} />;
}
