"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { FilterSidebar } from "@/components/carrier-dashboard/FilterSidebar";
import type { CarrierFilters } from "@/components/carrier-dashboard/FilterSidebar";
import { CarrierKPICard } from "@/components/carrier-dashboard/CarrierKPICard";
import { DailyTrendChart } from "@/components/carrier-dashboard/DailyTrendChart";
import { HorizontalBarChart } from "@/components/carrier-dashboard/HorizontalBarChart";
import { formatCarrierNumber, computeTargetKPIs } from "@/lib/utils/carrier-kpi";
import type { CarrierKPIs, BundleBreakdownRow, DailyDataPoint } from "@/lib/services/carrier-dashboard";

interface EmployeeTarget {
  employee_id: string;
  employee?: { id: string; full_name: string };
  fpe_target: number;
  friendi_target: number;
  virgin_target: number;
  postpaid_target: number;
  hbb_target: number;
  revenue_target: number;
  working_days: number;
}

const NAV = [
  { id: "performance", label: "Performance", short: "P1" },
  { id: "analysis", label: "Analysis", short: "P2" },
  { id: "supervisors", label: "Supervisors", short: "P3" },
  { id: "overview", label: "KSA Overview", short: "P4" },
  { id: "bundles", label: "Bundles", short: "P5" },
  { id: "shifts", label: "Shifts", short: "P6" },
  { id: "locations", label: "Locations", short: "P7" },
  { id: "executive", label: "Executive", short: "P8" },
  { id: "momentum", label: "Momentum", short: "P9" },
  { id: "verification", label: "Verification", short: "VR" },
  { id: "settings", label: "Settings", short: "S" },
];

function getDefaultMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function daysElapsedInMonth(month: string) {
  const now = new Date();
  const [y, m] = month.split("-").map(Number);
  if (now.getFullYear() === y && now.getMonth() + 1 === m) {
    return now.getDate();
  }
  return new Date(y, m, 0).getDate();
}

export default function CarrierDashboardEmbed() {
  const [activeSubTab, setActiveSubTab] = useState("performance");
  const [filters, setFilters] = useState<CarrierFilters>({
    month: getDefaultMonth(),
    region: "",
    channel: "",
    supervisorId: "",
    segmentBrand: "",
    selectedDates: [],
  });

  return (
    <div className="flex flex-col flex-1 bg-[#1a1a2e] text-white" style={{ minHeight: "calc(100vh - 130px)" }}>
      {/* Sub-tab bar */}
      <nav className="flex overflow-x-auto bg-[#16213e] border-b border-[#0f3460] shrink-0">
        {NAV.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveSubTab(item.id)}
            className={`px-4 py-2.5 text-sm whitespace-nowrap transition-colors border-b-2 ${
              activeSubTab === item.id
                ? "border-blue-500 text-white font-medium"
                : "border-transparent text-[#94a3b8] hover:text-white hover:border-[#1e4080]"
            }`}
          >
            <span className="hidden lg:inline">{item.label}</span>
            <span className="lg:hidden">{item.short}</span>
          </button>
        ))}
      </nav>

      {/* Body: sidebar + content */}
      <div className="flex flex-1 overflow-hidden">
        <FilterSidebar filters={filters} onChange={setFilters} />
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          {activeSubTab === "performance" && <PerformanceView filters={filters} />}
          {activeSubTab !== "performance" && (
            <SubPageRedirect subPage={activeSubTab} />
          )}
        </main>
      </div>
    </div>
  );
}

function SubPageRedirect({ subPage }: { subPage: string }) {
  const path = subPage === "settings" ? "/sales/carrier-dashboard/settings" : `/sales/carrier-dashboard/${subPage}`;
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-12">
      <p className="text-[#94a3b8] text-sm">هذه الصفحة تفتح في العرض الكامل</p>
      <Link
        href={path}
        className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
      >
        فتح {NAV.find((n) => n.id === subPage)?.label}
      </Link>
    </div>
  );
}

function PerformanceView({ filters }: { filters: CarrierFilters }) {
  const [month, setMonth] = useState(filters.month || getDefaultMonth());
  const [kpis, setKpis] = useState<CarrierKPIs | null>(null);
  const [daily, setDaily] = useState<DailyDataPoint[]>([]);
  const [targets, setTargets] = useState<EmployeeTarget[]>([]);
  const [bundles, setBundles] = useState<BundleBreakdownRow[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const qp = new URLSearchParams({ month });
      if (selectedEmployeeId) qp.set("employee_id", selectedEmployeeId);
      if (filters.region) qp.set("region", filters.region);
      if (filters.channel) qp.set("channel", filters.channel);
      if (filters.supervisorId) qp.set("supervisor_id", filters.supervisorId);
      if (filters.segmentBrand) qp.set("segment_brand", filters.segmentBrand);

      const [kpisRes, dailyRes, targetsRes, bundlesRes] = await Promise.all([
        fetch(`/api/sales/carrier-dashboard/kpis?${qp}`),
        fetch(`/api/sales/carrier-dashboard/daily?${qp}`),
        fetch(`/api/sales/carrier-targets?month=${month}`),
        fetch(`/api/sales/carrier-dashboard/bundles?${qp}`),
      ]);

      const [kpisJson, dailyJson, targetsJson, bundlesJson] = await Promise.all([
        kpisRes.json() as Promise<{ data?: CarrierKPIs; message?: string }>,
        dailyRes.json() as Promise<{ data?: DailyDataPoint[]; message?: string }>,
        targetsRes.json() as Promise<{ data?: EmployeeTarget[]; message?: string }>,
        bundlesRes.json() as Promise<{ data?: BundleBreakdownRow[]; message?: string }>,
      ]);

      if (!kpisRes.ok) throw new Error(kpisJson.message);
      setKpis(kpisJson.data ?? null);
      setDaily(dailyJson.data ?? []);
      setTargets(targetsJson.data ?? []);
      setBundles(bundlesJson.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [month, selectedEmployeeId, filters.region, filters.channel, filters.supervisorId, filters.segmentBrand]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setMonth(filters.month || getDefaultMonth()); }, [filters.month]);

  const daysElapsed = daysElapsedInMonth(month);
  const target = selectedEmployeeId
    ? targets.find((t) => t.employee_id === selectedEmployeeId)
    : null;

  const friendiTargetVal = target?.friendi_target ?? 0;
  const virginTargetVal = target?.virgin_target ?? 0;
  const workingDays = target?.working_days ?? 25;

  const friendiKPIs = friendiTargetVal > 0
    ? computeTargetKPIs({ achieved: kpis?.fpeFriendi ?? 0, target: friendiTargetVal, daysElapsed, totalWorkingDays: workingDays })
    : null;
  const virginKPIs = virginTargetVal > 0
    ? computeTargetKPIs({ achieved: kpis?.fpeVirgin ?? 0, target: virginTargetVal, daysElapsed, totalWorkingDays: workingDays })
    : null;

  const trendData = daily.map((d) => ({
    date: d.date,
    value: d.fpe,
  }));

  const BUNDLE_COLORS: Record<string, string> = {
    "+90": "#3b82f6", "+70": "#6366f1", "+45": "#8b5cf6",
    "+30": "#a78bfa", "+20": "#c4b5fd", "+10": "#ddd6fe",
  };
  const bundleChartData = bundles.length > 0
    ? bundles.map((b) => ({
        label: b.bundleCategory ?? "Other",
        value: b.count ?? 0,
        color: BUNDLE_COLORS[b.bundleCategory ?? ""] ?? "#94a3b8",
      }))
    : [
        { label: "+90", value: 0, color: "#3b82f6" },
        { label: "+70", value: 0, color: "#6366f1" },
        { label: "+45", value: 0, color: "#8b5cf6" },
        { label: "+30", value: 0, color: "#a78bfa" },
        { label: "+20", value: 0, color: "#c4b5fd" },
        { label: "+10", value: 0, color: "#ddd6fe" },
      ];

  const employeeOptions = targets.map((t) => ({
    id: t.employee_id,
    name: t.employee?.full_name ?? t.employee_id,
  }));

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-lg font-bold text-white">Employee Performance</h1>
        <div className="flex items-center gap-2">
          <select
            value={selectedEmployeeId}
            onChange={(e) => setSelectedEmployeeId(e.target.value)}
            className="bg-[#0f3460] text-white border border-[#1e4080] rounded px-2 py-1.5 text-sm focus:outline-none"
          >
            <option value="">All Employees</option>
            {employeeOptions.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="bg-[#0f3460] text-white border border-[#1e4080] rounded px-2 py-1.5 text-sm focus:outline-none"
          />
        </div>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-[#16213e] rounded-lg h-40 animate-pulse" />
          ))}
        </div>
      ) : kpis ? (
        <>
          {/* KPI Cards row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <CarrierKPICard
              label="FRiENDi FPE"
              value={formatCarrierNumber(kpis.fpeFriendi)}
              target={friendiTargetVal > 0 ? friendiTargetVal : undefined}
              remaining={friendiKPIs ? formatCarrierNumber(friendiKPIs.remaining) : undefined}
              reqPerDay={friendiKPIs ? friendiKPIs.requiredDaily.toFixed(1) : undefined}
              average={friendiKPIs ? friendiKPIs.average.toFixed(1) : undefined}
              expected={friendiKPIs ? formatCarrierNumber(friendiKPIs.expected) : undefined}
              achievedPct={friendiKPIs?.excellentPct}
              accentColor="#3b82f6"
            />
            <CarrierKPICard
              label="Virgin FPE"
              value={formatCarrierNumber(kpis.fpeVirgin)}
              target={virginTargetVal > 0 ? virginTargetVal : undefined}
              remaining={virginKPIs ? formatCarrierNumber(virginKPIs.remaining) : undefined}
              reqPerDay={virginKPIs ? virginKPIs.requiredDaily.toFixed(1) : undefined}
              average={virginKPIs ? virginKPIs.average.toFixed(1) : undefined}
              expected={virginKPIs ? formatCarrierNumber(virginKPIs.expected) : undefined}
              achievedPct={virginKPIs?.excellentPct}
              accentColor="#ef4444"
            />
            <CarrierKPICard
              label="Postpaid"
              value={formatCarrierNumber(kpis.postpaid)}
              accentColor="#22c55e"
            />
          </div>

          {/* Second row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <CarrierKPICard label="Total FPE" value={formatCarrierNumber(kpis.fpe)} accentColor="#f59e0b" />
            <CarrierKPICard label="IBR" value={`${formatCarrierNumber(kpis.ibr)} SAR`} accentColor="#8b5cf6" />
            <CarrierKPICard label="HBB" value={kpis.hbb.toLocaleString()} accentColor="#06b6d4" />
            <CarrierKPICard label="Users" value={kpis.users.toLocaleString()} accentColor="#ec4899" />
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <DailyTrendChart data={trendData} label="FPE" />
            <div className="bg-[#16213e] rounded-lg p-4">
              <div className="text-sm text-[#94a3b8] mb-4">Bundle Quality Distribution</div>
              <HorizontalBarChart data={bundleChartData} formatValue={(v) => v.toLocaleString()} />
            </div>
          </div>

          {/* Link to full carrier dashboard */}
          <div className="flex justify-center pt-4">
            <Link
              href="/sales/carrier-dashboard"
              className="text-sm text-blue-400 hover:text-blue-300 underline underline-offset-4"
            >
              فتح لوحة Virgin & FRiENDi الكاملة مع جميع التحليلات
            </Link>
          </div>
        </>
      ) : null}
    </div>
  );
}
