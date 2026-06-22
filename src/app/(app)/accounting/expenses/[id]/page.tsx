import { AccountingDetailPage } from "@/components/accounting/AccountingScreens";

export default function ExpenseDetailPage({ params }: { params: { id: string } }) {
  return <AccountingDetailPage entity="expenses" id={params.id} />;
}
