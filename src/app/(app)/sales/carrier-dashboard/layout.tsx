"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { FilterSidebar } from "@/components/carrier-dashboard/FilterSidebar";
import type { CarrierFilters } from "@/components/carrier-dashboard/FilterSidebar";

const NAV = [
  { href: "/sales/carrier-dashboard", label: "Performance", short: "P1" },
  { href: "/sales/carrier-dashboard/analysis", label: "Analysis", short: "P2" },
  { href: "/sales/carrier-dashboard/supervisors", label: "Supervisors", short: "P3" },
  { href: "/sales/carrier-dashboard/overview", label: "KSA Overview", short: "P4" },
  { href: "/sales/carrier-dashboard/bundles", label: "Bundles", short: "P5" },
  { href: "/sales/carrier-dashboard/shifts", label: "Shifts", short: "P6" },
  { href: "/sales/carrier-dashboard/locations", label: "Locations", short: "P7" },
  { href: "/sales/carrier-dashboard/executive", label: "Executive", short: "P8" },
  { href: "/sales/carrier-dashboard/momentum", label: "Momentum", short: "P9" },
  { href: "/sales/carrier-dashboard/verification", label: "Verification", short: "VR" },
  { href: "/sales/carrier-dashboard/settings", label: "Settings", short: "S" },
];

function getDefaultMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default function CarrierDashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [filters, setFilters] = useState<CarrierFilters>({
    month: getDefaultMonth(),
    region: "",
    channel: "",
    supervisorId: "",
    segmentBrand: "",
    selectedDates: [],
  });

  return (
    <div className="flex flex-col h-full bg-[#1a1a2e] text-white" style={{ minHeight: "calc(100vh - 64px)" }}>
      {/* Tab bar */}
      <nav className="flex overflow-x-auto bg-[#16213e] border-b border-[#0f3460] shrink-0">
        {NAV.map((item) => {
          const active = pathname === item.href || (item.href !== "/sales/carrier-dashboard" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`px-4 py-2.5 text-sm whitespace-nowrap transition-colors border-b-2 ${
                active
                  ? "border-blue-500 text-white font-medium"
                  : "border-transparent text-[#94a3b8] hover:text-white hover:border-[#1e4080]"
              }`}
            >
              <span className="hidden lg:inline">{item.label}</span>
              <span className="lg:hidden">{item.short}</span>
            </Link>
          );
        })}
      </nav>

      {/* Body: sidebar + content */}
      <div className="flex flex-1 overflow-hidden">
        <FilterSidebar filters={filters} onChange={setFilters} />
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          {/* Pass filters down via a data attribute so child pages can read them via URL, or we use context */}
          {children}
        </main>
      </div>
    </div>
  );
}
