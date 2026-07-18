"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/sales/carrier-dashboard/settings/dealer-codes", label: "Dealer Codes" },
  { href: "/sales/carrier-dashboard/settings/targets", label: "Targets" },
  { href: "/sales/carrier-dashboard/settings/config", label: "Configuration" },
];

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-white">Settings</h1>
      <div className="grid sm:grid-cols-3 gap-4">
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className="bg-[#16213e] rounded-lg p-6 text-center text-white font-medium hover:bg-[#1e3a5f] transition-colors border border-[#0f3460]"
          >
            {tab.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
