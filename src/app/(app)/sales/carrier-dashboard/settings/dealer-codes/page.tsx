"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Pencil, Trash2, RefreshCw, AlertCircle } from "lucide-react";
import { ImportUploader } from "@/components/carrier-dashboard/ImportUploader";

interface DealerCodeRow {
  id: string;
  dealer_code: string;
  employee_id: string;
  dealer_name: string | null;
  channel: string | null;
  region: string | null;
  city: string | null;
  location_name: string | null;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
  notes: string | null;
  employee?: { id: string; full_name: string };
}

interface Employee {
  id: string;
  full_name: string;
}

interface FormState {
  employee_id: string;
  dealer_code: string;
  start_date: string;
  end_date: string;
  channel: string;
  region: string;
  city: string;
  location_name: string;
  notes: string;
}

const emptyForm: FormState = {
  employee_id: "",
  dealer_code: "",
  start_date: new Date().toISOString().slice(0, 10),
  end_date: "",
  channel: "",
  region: "",
  city: "",
  location_name: "",
  notes: "",
};

export default function DealerCodesPage() {
  const [rows, setRows] = useState<DealerCodeRow[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [unmatchedCodes, setUnmatchedCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [activeTab, setActiveTab] = useState<"assignments" | "import">("assignments");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [codesRes, unmatchedRes] = await Promise.all([
        fetch("/api/sales/dealer-codes"),
        fetch("/api/sales/dealer-codes/unmatched"),
      ]);
      const [codesJson, unmatchedJson] = await Promise.all([
        codesRes.json() as Promise<{ data?: DealerCodeRow[]; message?: string }>,
        unmatchedRes.json() as Promise<{ data?: string[]; message?: string }>,
      ]);
      if (!codesRes.ok) throw new Error(codesJson.message);
      setRows(codesJson.data ?? []);
      setUnmatchedCodes(unmatchedJson.data ?? []);

      // Derive employees list from existing assignments
      const empSet = new Map<string, string>();
      for (const r of codesJson.data ?? []) {
        if (r.employee) empSet.set(r.employee.id, r.employee.full_name);
      }
      setEmployees([...empSet.entries()].map(([id, full_name]) => ({ id, full_name })));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!form.employee_id || !form.dealer_code || !form.start_date) {
      setSaveError("Employee, dealer code, and start date are required");
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      const res = await fetch("/api/sales/dealer-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: form.employee_id,
          dealer_code: form.dealer_code,
          start_date: form.start_date,
          end_date: form.end_date || undefined,
          channel: form.channel || undefined,
          region: form.region || undefined,
          city: form.city || undefined,
          location_name: form.location_name || undefined,
          notes: form.notes || undefined,
        }),
      });
      const json = await res.json() as { message?: string };
      if (!res.ok) throw new Error(json.message);
      setShowForm(false);
      setForm(emptyForm);
      load();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(id: string) {
    if (!confirm("End this assignment?")) return;
    await fetch(`/api/sales/dealer-codes?id=${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: false, end_date: new Date().toISOString().slice(0, 10) }),
    });
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-white">Dealer Code Assignments</h2>
        <div className="flex gap-2">
          <button onClick={load} className="p-2 text-[#94a3b8] hover:text-white">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => { setShowForm(!showForm); setForm(emptyForm); setSaveError(""); }}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm px-3 py-1.5 rounded"
          >
            <Plus className="w-4 h-4" />
            Add Assignment
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[#0f3460] rounded-lg p-1 w-fit">
        {(["assignments", "import"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-1 text-sm rounded capitalize transition-colors ${
              activeTab === tab ? "bg-blue-600 text-white" : "text-[#94a3b8] hover:text-white"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "import" && (
        <div className="space-y-4">
          <p className="text-sm text-[#94a3b8]">Upload the daily Excel file from Virgin/FRiENDi to import activations.</p>
          <ImportUploader onSuccess={() => load()} />
        </div>
      )}

      {activeTab === "assignments" && (
        <>
          {unmatchedCodes.length > 0 && (
            <div className="bg-yellow-950/30 border border-yellow-800 rounded-lg p-3">
              <div className="flex items-center gap-2 text-yellow-400 text-sm font-medium mb-1">
                <AlertCircle className="w-4 h-4" />
                {unmatchedCodes.length} unmatched dealer codes — activations exist but no assignment
              </div>
              <div className="text-xs text-[#94a3b8]">{unmatchedCodes.join(", ")}</div>
            </div>
          )}

          {showForm && (
            <div className="bg-[#16213e] border border-[#0f3460] rounded-lg p-4 space-y-3">
              <h3 className="text-sm font-medium text-white">New Assignment</h3>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <Field label="Employee *">
                  <select
                    value={form.employee_id}
                    onChange={(e) => setForm((f) => ({ ...f, employee_id: e.target.value }))}
                    className="carrier-input"
                  >
                    <option value="">Select employee</option>
                    {employees.map((e) => (
                      <option key={e.id} value={e.id}>{e.full_name}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Dealer Code *">
                  <input
                    value={form.dealer_code}
                    onChange={(e) => setForm((f) => ({ ...f, dealer_code: e.target.value.toUpperCase() }))}
                    placeholder="DIR-05577"
                    className="carrier-input"
                  />
                </Field>
                <Field label="Start Date *">
                  <input
                    type="date"
                    value={form.start_date}
                    onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
                    className="carrier-input"
                  />
                </Field>
                <Field label="End Date">
                  <input
                    type="date"
                    value={form.end_date}
                    onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
                    className="carrier-input"
                  />
                </Field>
                <Field label="Channel">
                  <select
                    value={form.channel}
                    onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value }))}
                    className="carrier-input"
                  >
                    <option value="">—</option>
                    <option>Direct Sales</option>
                    <option>Modern trade</option>
                  </select>
                </Field>
                <Field label="Region">
                  <select
                    value={form.region}
                    onChange={(e) => setForm((f) => ({ ...f, region: e.target.value }))}
                    className="carrier-input"
                  >
                    <option value="">—</option>
                    <option>Central</option>
                    <option>Eastern</option>
                    <option>Southern</option>
                    <option>Western</option>
                  </select>
                </Field>
                <Field label="City">
                  <input
                    value={form.city}
                    onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                    className="carrier-input"
                  />
                </Field>
                <Field label="Location Name">
                  <input
                    value={form.location_name}
                    onChange={(e) => setForm((f) => ({ ...f, location_name: e.target.value }))}
                    className="carrier-input"
                  />
                </Field>
                <Field label="Notes">
                  <input
                    value={form.notes}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                    className="carrier-input"
                  />
                </Field>
              </div>
              {saveError && <p className="text-red-400 text-sm">{saveError}</p>}
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setShowForm(false)}
                  className="px-3 py-1.5 text-sm text-[#94a3b8] hover:text-white border border-[#0f3460] rounded"
                >
                  Cancel
                </button>
                <button
                  onClick={save}
                  disabled={saving}
                  className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          )}

          {error && <p className="text-red-400 text-sm">{error}</p>}

          {loading ? (
            <p className="text-[#94a3b8] text-sm">Loading…</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-[#0f3460]">
              <table className="w-full text-sm">
                <thead className="bg-[#0f3460] text-[#94a3b8]">
                  <tr>
                    {["Code", "Employee", "Channel", "Region", "Location", "Start", "End", "Status", ""].map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-xs font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#0f3460]">
                  {rows.length === 0 ? (
                    <tr><td colSpan={9} className="px-3 py-4 text-center text-[#94a3b8]">No assignments yet</td></tr>
                  ) : rows.map((row) => (
                    <tr key={row.id} className="bg-[#16213e] hover:bg-[#1e3a5f] transition-colors">
                      <td className="px-3 py-2 font-mono text-blue-400">{row.dealer_code}</td>
                      <td className="px-3 py-2 text-white">{row.employee?.full_name ?? "—"}</td>
                      <td className="px-3 py-2 text-[#94a3b8]">{row.channel ?? "—"}</td>
                      <td className="px-3 py-2 text-[#94a3b8]">{row.region ?? "—"}</td>
                      <td className="px-3 py-2 text-[#94a3b8] max-w-xs truncate">{row.location_name ?? "—"}</td>
                      <td className="px-3 py-2 text-[#94a3b8]">{row.start_date}</td>
                      <td className="px-3 py-2 text-[#94a3b8]">{row.end_date ?? "—"}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${
                          row.is_active ? "bg-green-950 text-green-400" : "bg-[#0f3460] text-[#94a3b8]"
                        }`}>
                          {row.is_active ? "Active" : "Ended"}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {row.is_active && (
                          <button onClick={() => deactivate(row.id)} className="text-[#94a3b8] hover:text-red-400">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <style jsx global>{`
        .carrier-input {
          width: 100%;
          background: #0f3460;
          color: white;
          border: 1px solid #1e4080;
          border-radius: 4px;
          padding: 6px 8px;
          font-size: 13px;
        }
        .carrier-input:focus { outline: none; border-color: #3b82f6; }
        .carrier-input option { background: #0f3460; }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-[#94a3b8]">{label}</label>
      {children}
    </div>
  );
}
