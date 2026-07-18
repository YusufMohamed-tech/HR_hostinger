"use client";

import { useEffect, useState, useCallback } from "react";
import { Save, Copy, RefreshCw } from "lucide-react";

interface TargetRow {
  id?: string;
  employee_id: string;
  employee?: { id: string; full_name: string };
  supervisor?: { id: string; full_name: string } | null;
  fpe_target: number;
  revenue_target: number;
  friendi_target: number;
  virgin_target: number;
  postpaid_target: number;
  hbb_target: number;
  working_days: number;
}

function getDefaultMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function prevMonth(m: string) {
  const [y, mo] = m.split("-").map(Number);
  if (mo === 1) return `${y - 1}-12`;
  return `${y}-${String(mo - 1).padStart(2, "0")}`;
}

export default function TargetsPage() {
  const [month, setMonth] = useState(getDefaultMonth);
  const [rows, setRows] = useState<TargetRow[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<TargetRow>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [copyingMonth, setCopyingMonth] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [targetsRes, perfRes] = await Promise.all([
        fetch(`/api/sales/carrier-targets?month=${month}`),
        fetch(`/api/sales/carrier-dashboard/employees?month=${month}`),
      ]);
      const targetsJson = await targetsRes.json() as { data?: TargetRow[]; message?: string };
      if (!targetsRes.ok) throw new Error(targetsJson.message);

      const existing = targetsJson.data ?? [];
      if (existing.length > 0) {
        setRows(existing);
      } else {
        // Seed zero-target rows from performance/employee list
        type PerfRow = { employeeId: string; employeeName: string };
        const perfJson = await perfRes.json() as { data?: PerfRow[] };
        const emps = perfJson.data ?? [];
        setRows(
          emps.map((e) => ({
            employee_id: e.employeeId,
            employee: { id: e.employeeId, full_name: e.employeeName },
            fpe_target: 0,
            revenue_target: 0,
            friendi_target: 0,
            virgin_target: 0,
            postpaid_target: 0,
            hbb_target: 0,
            working_days: 25,
          }))
        );
      }
      setEdits({});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { load(); }, [load]);

  function edit(employeeId: string, field: keyof TargetRow, value: number | string) {
    setEdits((prev) => ({
      ...prev,
      [employeeId]: { ...prev[employeeId], [field]: value },
    }));
  }

  async function saveRow(row: TargetRow) {
    const merged = { ...row, ...edits[row.employee_id] };
    setSaving((s) => ({ ...s, [row.employee_id]: true }));
    try {
      const res = await fetch("/api/sales/carrier-targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month,
          employee_id: row.employee_id,
          fpe_target: Number(merged.fpe_target),
          revenue_target: Number(merged.revenue_target),
          friendi_target: Number(merged.friendi_target),
          virgin_target: Number(merged.virgin_target),
          postpaid_target: Number(merged.postpaid_target),
          hbb_target: Number(merged.hbb_target),
          working_days: Number(merged.working_days),
        }),
      });
      const json = await res.json() as { message?: string };
      if (!res.ok) throw new Error(json.message);
      setEdits((e) => { const next = { ...e }; delete next[row.employee_id]; return next; });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving((s) => ({ ...s, [row.employee_id]: false }));
    }
  }

  async function copyFromPrev() {
    if (!confirm(`Copy targets from ${prevMonth(month)} to ${month}?`)) return;
    setCopyingMonth(true);
    try {
      const res = await fetch("/api/sales/carrier-targets/copy-month", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from_month: prevMonth(month), to_month: month }),
      });
      const json = await res.json() as { data?: { copied: number }; message?: string };
      if (!res.ok) throw new Error(json.message);
      alert(`Copied ${json.data?.copied} targets`);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Copy failed");
    } finally {
      setCopyingMonth(false);
    }
  }

  const NUM_FIELDS: { key: keyof TargetRow; label: string }[] = [
    { key: "fpe_target", label: "FPE" },
    { key: "friendi_target", label: "Friendi" },
    { key: "virgin_target", label: "Virgin" },
    { key: "postpaid_target", label: "Postpaid" },
    { key: "hbb_target", label: "HBB" },
    { key: "revenue_target", label: "Revenue" },
    { key: "working_days", label: "Days" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold text-white">Monthly Targets</h2>
        <div className="flex items-center gap-2">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="bg-[#0f3460] text-white border border-[#1e4080] rounded px-2 py-1.5 text-sm focus:outline-none"
          />
          <button
            onClick={copyFromPrev}
            disabled={copyingMonth}
            className="flex items-center gap-1.5 bg-[#0f3460] hover:bg-[#1e4080] text-white text-sm px-3 py-1.5 rounded border border-[#1e4080]"
          >
            <Copy className="w-3.5 h-3.5" />
            Copy from {prevMonth(month)}
          </button>
          <button onClick={load} className="p-2 text-[#94a3b8] hover:text-white">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {loading ? (
        <p className="text-[#94a3b8] text-sm">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[#0f3460]">
          <table className="w-full text-sm">
            <thead className="bg-[#0f3460]">
              <tr>
                <th className="px-3 py-2 text-left text-xs text-[#94a3b8] font-medium">Employee</th>
                <th className="px-3 py-2 text-left text-xs text-[#94a3b8] font-medium">Supervisor</th>
                {NUM_FIELDS.map((f) => (
                  <th key={f.key} className="px-3 py-2 text-right text-xs text-[#94a3b8] font-medium">{f.label}</th>
                ))}
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#0f3460]">
              {rows.map((row) => {
                const merged = { ...row, ...edits[row.employee_id] };
                const dirty = !!edits[row.employee_id];
                return (
                  <tr key={row.employee_id} className="bg-[#16213e] hover:bg-[#1e3a5f] transition-colors">
                    <td className="px-3 py-2 text-white">{row.employee?.full_name ?? row.employee_id}</td>
                    <td className="px-3 py-2 text-[#94a3b8]">{row.supervisor?.full_name ?? "—"}</td>
                    {NUM_FIELDS.map((f) => (
                      <td key={f.key} className="px-2 py-1">
                        <input
                          type="number"
                          min={0}
                          value={String(merged[f.key] ?? 0)}
                          onChange={(e) => edit(row.employee_id, f.key, Number(e.target.value))}
                          className="w-20 bg-[#0f3460] text-white text-right border border-transparent focus:border-blue-500 rounded px-1.5 py-1 text-sm focus:outline-none tabular-nums"
                        />
                      </td>
                    ))}
                    <td className="px-2 py-1">
                      {dirty && (
                        <button
                          onClick={() => saveRow(row)}
                          disabled={saving[row.employee_id]}
                          className="text-blue-400 hover:text-blue-300"
                          title="Save"
                        >
                          <Save className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
