"use client";

import { AccountingPage } from "@/components/accounting/AccountingScreens";
import { Phase2AnnouncementBanner } from "@/components/accounting/Phase2AnnouncementBanner";

export default function AccountingDashboardPage() {
  return (
    <>
      <Phase2AnnouncementBanner />
      <AccountingPage view="dashboard" />
    </>
  );
}
