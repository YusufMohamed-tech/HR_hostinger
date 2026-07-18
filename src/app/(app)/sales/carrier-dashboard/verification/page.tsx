"use client";

import { useEffect, useState, useCallback } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { CarrierKPICard } from "@/components/carrier-dashboard/CarrierKPICard";

interface VerificationRow {
  id: string;
  employee_id: string;
  verification_date: string;
  has_discrepancy: boolean;
  discrepancy_type: string | null;
  carrier_fpe: number;
  logged_fpe: number;
  fpe_difference: number;
  ibr_difference: number;
  status: string;
  seen_by_employee: boolean;
  seen_by_hr: boolean;
  employee_note: string | null;
  employee?: { id: string; full_name: string };
}

export default function VerificationPage() {
  const [rows, setRows] = useState<VerificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "discrepancy">("discrepancy");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const qp = new URLSearchParams();
      if (filter === "discrepancy") qp.set("has_discrepancy", "true");
      const res = await fetch(`/api/sales/carrier-verifications?${qp}`);
      const json = await res.json() as { data?: VerificationRow[]; message?: string };
      if (!res.ok) throw new Error(json.message);
      setRows(json.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  async function markSeen(id: string) {
    await fetch(`/api/sales/carrier-verifications?id=${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seen_by_hr: true }),
    });
    load();
  }

  const discrepancyCount = rows.filter((r) => r.has_discrepancy).length;
  const unseenCount = rows.filter((r) => r.has_discrepancy && !r.seen_by_hr).length;
  const employeesAffected = new Set(rows.filter((r) => r.has_discrepancy).map((r) => r.employee_id)).size;
  const discrepancyRate = rows.length > 0 ? ((discrepancyCount / rows.length) * 100).toFixed(1) : "0";

  const DISC_TYPE_LABELS: Record<string, string> = {
    over_reported: "Over-reported",
    under_reported: "Under-reported",
    missing_log: "Missing Log",
    extra_log: "Extra Log",
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-lg font-bold text-white">Verification Dashboard</h1>
        <div className="flex gap-2 items-center">
          <div className="flex gap-1 bg-[#0f3460] rounded p-0.5">
            {(["discrepancy", "all"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 text-xs rounded capitalize transition-colors ${
                  filter === f ? "bg-blue-600 text-white" : "text-[#94a3b8] hover:text-white"
                }`}
              >
                {f === "discrepancy" ? "Discrepancies" : "All"}
              </button>
            ))}
          </div>
          <button onClick={load} className="p-2 text-[#94a3b8] hover:text-white">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <CarrierKPICard label="Total Checks" value={rows.length.toLocaleString()} accentColor="#3b82f6" />
        <CarrierKPICard label="Discrepancies" value={discrepancyCount.toLocaleString()} accentColor="#ef4444" />
        <CarrierKPICard label="Employees Affected" value={employeesAffected.toLocaleString()} accentColor="#f59e0b" />
        <CarrierKPICard label="Discrepancy Rate" value={`${discrepancyRate}%`} accentColor="#8b5cf6" />
      </div>

      {unseenCount > 0 && (
        <div className="flex items-center gap-2 bg-yellow-950/30 border border-yellow-800 rounded-lg p-3 text-yellow-400 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {unseenCount} unseen discrepancies
        </div>
      )}

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {loading ? (
        <p className="text-[#94a3b8] text-sm animate-pulse">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[#0f3460]">
          <table className="w-full text-sm">
            <thead className="bg-[#0f3460]">
              <tr>
                {["Employee", "Date", "Carrier FPE", "Logged FPE", "Diff", "Type", "Status", "Seen (HR)", ""].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-xs text-[#94a3b8] font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#0f3460]">
              {rows.length === 0 ? (
                <tr><td colSpan={9} className="px-3 py-4 text-center text-[#94a3b8]">No records</td></tr>
              ) : rows.map((row) => (
                <tr key={row.id} className="bg-[#16213e] hover:bg-[#1e3a5f] transition-colors">
                  <td className="px-3 py-2 text-white">{row.employee?.full_name ?? row.employee_id}</td>
                  <td className="px-3 py-2 text-[#94a3b8]">{row.verification_date}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-white">{row.carrier_fpe}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-white">{row.logged_fpe}</td>
                  <td className={`px-3 py-2 text-right tabular-nums font-medium ${row.fpe_difference > 0 ? "text-red-400" : row.fpe_difference < 0 ? "text-yellow-400" : "text-[#94a3b8]"}`}>
                    {row.fpe_difference > 0 ? `+${row.fpe_difference}` : row.fpe_difference}
                  </td>
                  <td className="px-3 py-2 text-xs text-[#94a3b8]">
                    {row.discrepancy_type ? DISC_TYPE_LABELS[row.discrepancy_type] ?? row.discrepancy_type : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${
                      row.status === "resolved" ? "bg-green-950 text-green-400" :
                      row.status === "acknowledged" ? "bg-blue-950 text-blue-400" :
                      "bg-yellow-950 text-yellow-400"
                    }`}>
                      {row.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center">
                    {row.seen_by_hr
                      ? <span className="text-green-400 text-xs">✓</span>
                      : <span className="text-[#64748b] text-xs">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    {!row.seen_by_hr && (
                      <button
                        onClick={() => markSeen(row.id)}
                        className="text-xs text-blue-400 hover:underline"
                      >
                        Mark Seen
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
