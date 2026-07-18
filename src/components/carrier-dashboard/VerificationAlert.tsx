"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, X, ChevronDown, ChevronUp } from "lucide-react";

interface DiscrepancyRow {
  id: string;
  verification_date: string;
  carrier_fpe: number;
  logged_fpe: number;
  fpe_difference: number;
  discrepancy_type: string | null;
  employee_note: string | null;
  seen_by_employee: boolean;
  status: string;
}

export function VerificationAlert() {
  const [rows, setRows] = useState<DiscrepancyRow[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [note, setNote] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch("/api/sales/carrier-verifications?my=true")
      .then((r) => r.json() as Promise<{ data?: DiscrepancyRow[] }>)
      .then((j) => setRows(j.data ?? []))
      .catch(() => {});
  }, []);

  const unseen = rows.filter((r) => !r.seen_by_employee);

  if (dismissed || rows.length === 0) return null;

  async function markSeen(id: string) {
    setSaving((s) => ({ ...s, [id]: true }));
    await fetch(`/api/sales/carrier-verifications?id=${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seen_by_employee: true }),
    });
    setRows((prev) => prev.map((r) => r.id === id ? { ...r, seen_by_employee: true } : r));
    setSaving((s) => ({ ...s, [id]: false }));
  }

  async function saveNote(id: string) {
    setSaving((s) => ({ ...s, [`note_${id}`]: true }));
    await fetch(`/api/sales/carrier-verifications?id=${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employee_note: note[id] ?? "", seen_by_employee: true }),
    });
    setRows((prev) => prev.map((r) => r.id === id ? { ...r, employee_note: note[id] ?? "", seen_by_employee: true } : r));
    setSaving((s) => ({ ...s, [`note_${id}`]: false }));
  }

  const TYPE_LABEL: Record<string, string> = {
    over_reported: "Logged more than carrier",
    under_reported: "Logged less than carrier",
    missing_log: "No log found for this day",
    extra_log: "Log exists but carrier shows 0",
  };

  return (
    <div className="mb-4 rounded-lg border border-amber-700 bg-amber-950/40">
      <div className="flex items-center justify-between px-4 py-3">
        <button
          onClick={() => setExpanded((e) => !e)}
          className="flex items-center gap-2 text-amber-400 font-medium text-sm"
        >
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            {unseen.length > 0
              ? `${unseen.length} day${unseen.length > 1 ? "s" : ""} with sales differences — tap to review`
              : `${rows.length} resolved sales difference${rows.length > 1 ? "s" : ""}`}
          </span>
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        <button onClick={() => setDismissed(true)} className="text-amber-600 hover:text-amber-400 p-1">
          <X className="w-4 h-4" />
        </button>
      </div>

      {expanded && (
        <div className="border-t border-amber-800 divide-y divide-amber-900/50">
          {rows.map((row) => (
            <div key={row.id} className="px-4 py-3 space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="text-sm text-white font-medium">
                  {new Date(row.verification_date).toLocaleDateString("en-GB", {
                    day: "2-digit", month: "short", year: "numeric",
                  })}
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-slate-400">
                    Carrier: <span className="text-white font-bold">{row.carrier_fpe}</span>
                  </span>
                  <span className="text-slate-400">
                    Logged: <span className="text-white font-bold">{row.logged_fpe}</span>
                  </span>
                  <span className={`font-bold ${row.fpe_difference > 0 ? "text-red-400" : "text-amber-400"}`}>
                    {row.fpe_difference > 0 ? `+${row.fpe_difference}` : row.fpe_difference}
                  </span>
                </div>
              </div>

              {row.discrepancy_type && (
                <p className="text-xs text-amber-400">{TYPE_LABEL[row.discrepancy_type] ?? row.discrepancy_type}</p>
              )}

              {row.employee_note && (
                <p className="text-xs text-slate-400 italic">&ldquo;{row.employee_note}&rdquo;</p>
              )}

              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="text"
                  placeholder="Add a note (optional)…"
                  value={note[row.id] ?? row.employee_note ?? ""}
                  onChange={(e) => setNote((n) => ({ ...n, [row.id]: e.target.value }))}
                  className="flex-1 min-w-0 bg-amber-950/60 border border-amber-800 rounded px-2 py-1 text-xs text-white placeholder-amber-700 focus:outline-none focus:border-amber-500"
                />
                <button
                  onClick={() => saveNote(row.id)}
                  disabled={saving[`note_${row.id}`]}
                  className="text-xs bg-amber-700 hover:bg-amber-600 text-white px-2 py-1 rounded disabled:opacity-50"
                >
                  Save
                </button>
                {!row.seen_by_employee && (
                  <button
                    onClick={() => markSeen(row.id)}
                    disabled={saving[row.id]}
                    className="text-xs text-amber-400 hover:text-amber-300 border border-amber-700 px-2 py-1 rounded disabled:opacity-50"
                  >
                    Acknowledge
                  </button>
                )}
                {row.seen_by_employee && (
                  <span className="text-xs text-green-500">✓ Acknowledged</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
