"use client";

import { AccountingPageHeader } from "@/components/accounting/AccountingPrimitives";
import { PartyNettingWorkbench } from "@/components/accounting/netting/PartyNettingWorkbench";

export default function NettingPage() {
  return (
    <div className="grid gap-6">
      <AccountingPageHeader title="تسوية العملاء/الموردين" description="تسوية الذمم المدينة والدائنة لنفس الطرف" />
      <PartyNettingWorkbench />
    </div>
  );
}
