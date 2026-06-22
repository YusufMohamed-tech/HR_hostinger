import { AccountingDetailPage } from "@/components/accounting/AccountingScreens";

export default function JournalEntryDetailPage({ params }: { params: { id: string } }) {
  return <AccountingDetailPage entity="journal-entries" id={params.id} />;
}
