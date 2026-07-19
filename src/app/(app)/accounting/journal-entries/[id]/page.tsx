import { AccountingDetailPage } from "@/components/accounting/AccountingScreens";

export default async function JournalEntryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AccountingDetailPage entity="journal-entries" id={id} />;
}
