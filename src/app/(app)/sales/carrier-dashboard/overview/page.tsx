"use client";

import { useEffect, useState, useCallback } from "react";
import { CarrierKPICard } from "@/components/carrier-dashboard/CarrierKPICard";
import { CarrierGaugeChart } from "@/components/carrier-dashboard/CarrierGaugeChart";
import { HorizontalBarChart } from "@/components/carrier-dashboard/HorizontalBarChart";
import { formatCarrierNumber } from "@/lib/utils/carrier-kpi";
import type { CarrierKPIs, SupervisorRow } from "@/lib/services/carrier-dashboard";

function getDefaultMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

type RankTab = "fpe" | "ibr" | "employees";

export default function OverviewPage() {
  const [month, setMonth] = useState(getDefaultMonth);
  const [kpis, setKpis] = useState<CarrierKPIs | null>(null);
  const [supervisors, setSupervisors] = useState<SupervisorRow[]>([]);
  const [rankTab, setRankTab] = useState<RankTab>("fpe");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const qp = new URLSearchParams({ month });
      const [kpisRes, svRes] = await Promise.all([
        fetch(`/api/sales/carrier-dashboard/kpis?${qp}`),
        fetch(`/api/sales/carrier-dashboard/supervisors?${qp}`),
      ]);
      const [kpisJson, svJson] = await Promise.all([
        kpisRes.json() as Promise<{ data?: CarrierKPIs }>,
        svRes.json() as Promise<{ data?: SupervisorRow[] }>,
      ]);
      setKpis(kpisJson.data ?? null);
      setSupervisors(svJson.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { load(); }, [load]);

  const rankData = supervisors.map((sv) => ({
    label: sv.supervisorName,
    value: rankTab === "fpe" ? sv.fpe : rankTab === "ibr" ? sv.ibr : sv.employeeCount,
    color: "#3b82f6",
  })).sort((a, b) => b.value - a.value);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-lg font-bold text-white">KSA Overview</h1>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="bg-[#0f3460] text-white border border-[#1e4080] rounded px-2 py-1.5 text-sm focus:outline-none"
        />
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {loading ? (
        <p className="text-[#94a3b8] text-sm animate-pulse">Loading…</p>
      ) : kpis ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <CarrierKPICard label="Total FPE" value={formatCarrierNumber(kpis.fpe)} accentColor="#ef4444" />
            <CarrierKPICard label="Total IBR" value={formatCarrierNumber(kpis.ibr)} accentColor="#8b5cf6" />
            <CarrierKPICard label="Supervisors" value={supervisors.length.toString()} accentColor="#f59e0b" />
            <CarrierKPICard label="Employees" value={kpis.employees.toLocaleString()} accentColor="#22c55e" />
            <CarrierKPICard label="Users" value={kpis.users.toLocaleString()} accentColor="#06b6d4" />
          </div>

          <div className="flex gap-6 justify-center flex-wrap">
            <CarrierGaugeChart
              value={kpis.fpe}
              target={Math.max(kpis.fpe, 1)}
              label="Total KSA FPE"
              sublabel={`${kpis.fpe.toLocaleString()} achieved`}
              size={160}
            />
            <CarrierGaugeChart
              value={kpis.ibr}
              target={Math.max(kpis.ibr, 1)}
              label="Total KSA Revenue"
              sublabel={`${formatCarrierNumber(kpis.ibr)} SAR`}
              size={160}
            />
          </div>

          <div className="bg-[#16213e] rounded-lg p-4">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm text-[#94a3b8]">Supervisor Rankings</span>
              <div className="flex gap-1 bg-[#0f3460] rounded p-0.5">
                {(["fpe", "ibr", "employees"] as RankTab[]).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setRankTab(tab)}
                    className={`px-3 py-1 text-xs rounded capitalize transition-colors ${
                      rankTab === tab ? "bg-blue-600 text-white" : "text-[#94a3b8] hover:text-white"
                    }`}
                  >
                    {tab === "ibr" ? "Revenue" : tab === "fpe" ? "FPE" : "Employees"}
                  </button>
                ))}
              </div>
            </div>
            <HorizontalBarChart
              data={rankData}
              formatValue={(v) => rankTab === "ibr" ? formatCarrierNumber(v) : v.toLocaleString()}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}
