"use client";

import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

interface ConfigEntry {
  config_key: string;
  config_value: string;
  label: string;
  description: string;
  type: "time" | "number" | "percent";
}

const CONFIG_DEFS: ConfigEntry[] = [
  { config_key: "shift_night_start", config_value: "16:00", label: "Night Shift Start Time", description: "Activations from this hour onwards are classified as night shift", type: "time" },
  { config_key: "shift_morning_start", config_value: "08:00", label: "Morning Shift Start Time", description: "Activations before night start are morning shift", type: "time" },
  { config_key: "verification_tolerance_percent", config_value: "5", label: "Verification Tolerance (%)", description: "Acceptable discrepancy % before flagging", type: "percent" },
  { config_key: "location_active_threshold", config_value: "100", label: "Active Coverage Threshold (%)", description: "Coverage % to be marked Active (نشط)", type: "percent" },
  { config_key: "location_acceptable_threshold", config_value: "85", label: "Acceptable Coverage Threshold (%)", description: "Coverage % to be marked Acceptable (مقبول)", type: "percent" },
  { config_key: "location_warning_threshold", config_value: "70", label: "Warning Coverage Threshold (%)", description: "Coverage % to be marked Warning (تنبيه)", type: "percent" },
];

export default function ConfigPage() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const { data } = await supabase.from("carrier_dashboard_config").select("config_key, config_value");
      const map: Record<string, string> = {};
      for (const def of CONFIG_DEFS) map[def.config_key] = def.config_value;
      for (const row of data ?? []) map[(row as { config_key: string }).config_key] = (row as { config_value: string }).config_value;
      setValues(map);
      setLoading(false);
    })();
  }, []);

  async function saveKey(key: string) {
    try {
      const res = await fetch("/api/sales/carrier-dashboard/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config_key: key, config_value: values[key] }),
      });
      if (!res.ok) throw new Error("Save failed");
      setSaved((s) => ({ ...s, [key]: true }));
      setTimeout(() => setSaved((s) => ({ ...s, [key]: false })), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    }
  }

  return (
    <div className="space-y-4 max-w-xl">
      <h2 className="text-lg font-bold text-white">Configuration</h2>
      {error && <p className="text-red-400 text-sm">{error}</p>}
      {loading ? (
        <p className="text-[#94a3b8] text-sm">Loading…</p>
      ) : (
        <div className="space-y-3">
          {CONFIG_DEFS.map((def) => (
            <div key={def.config_key} className="bg-[#16213e] border border-[#0f3460] rounded-lg p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white">{def.label}</div>
                  <div className="text-xs text-[#94a3b8] mt-0.5">{def.description}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <input
                    type={def.type === "time" ? "time" : "number"}
                    value={values[def.config_key] ?? def.config_value}
                    min={def.type !== "time" ? 0 : undefined}
                    max={def.type === "percent" ? 100 : undefined}
                    onChange={(e) => setValues((v) => ({ ...v, [def.config_key]: e.target.value }))}
                    className="bg-[#0f3460] text-white border border-[#1e4080] rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-500 w-24 text-center"
                  />
                  <button
                    onClick={() => saveKey(def.config_key)}
                    className={`p-1.5 rounded transition-colors ${saved[def.config_key] ? "text-green-400" : "text-blue-400 hover:text-blue-300"}`}
                  >
                    <Save className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
