"use client";

import { useState, useRef } from "react";
import { Upload, CheckCircle, AlertCircle, Loader2 } from "lucide-react";

interface ImportResult {
  importId: string;
  totalRows: number;
  newRows: number;
  duplicateRows: number;
  matchedRows: number;
  unmatchedRows: number;
  unmatchedCodes: string[];
  dateRangeStart: string;
  dateRangeEnd: string;
}

export function ImportUploader({ onSuccess }: { onSuccess?: (result: ImportResult) => void }) {
  const [state, setState] = useState<"idle" | "uploading" | "success" | "error">("idle");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      setErrorMsg("Only .xlsx workbooks are accepted.");
      setState("error");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setErrorMsg("The workbook exceeds the 10 MB limit.");
      setState("error");
      return;
    }
    setState("uploading");
    setErrorMsg("");
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch("/api/sales/carrier-import", { method: "POST", body: form });
      const json = await res.json() as { data?: ImportResult; message?: string };
      if (!res.ok) throw new Error(json.message ?? "Upload failed");
      setResult(json.data!);
      setState("success");
      onSuccess?.(json.data!);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Upload failed");
      setState("error");
    }
  }

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    upload(files[0]);
  }

  return (
    <div className="space-y-4">
      <div
        className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
          dragging ? "border-blue-500 bg-blue-950/20" : "border-[#1e4080] hover:border-blue-600"
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        {state === "uploading" ? (
          <div className="flex flex-col items-center gap-2 text-[#94a3b8]">
            <Loader2 className="w-8 h-8 animate-spin" />
            <span>Processing Excel file…</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-[#94a3b8]">
            <Upload className="w-8 h-8" />
            <span className="text-sm">Drop Excel file here or click to browse</span>
            <span className="text-xs">Accepts: Sales-Alharthi DD-M.xlsx</span>
          </div>
        )}
      </div>

      {state === "success" && result && (
        <div className="bg-green-950/30 border border-green-800 rounded-lg p-4 space-y-2">
          <div className="flex items-center gap-2 text-green-400 font-medium">
            <CheckCircle className="w-4 h-4" />
            Import completed
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <Stat label="Total rows" value={result.totalRows} />
            <Stat label="New rows" value={result.newRows} color="text-green-400" />
            <Stat label="Duplicates" value={result.duplicateRows} color="text-[#94a3b8]" />
            <Stat label="Matched" value={result.matchedRows} color="text-blue-400" />
          </div>
          {result.unmatchedRows > 0 && (
            <div className="mt-2 p-3 bg-yellow-950/30 border border-yellow-800 rounded text-sm">
              <div className="text-yellow-400 font-medium mb-1">
                {result.unmatchedRows} unmatched rows — assign dealer codes in Settings
              </div>
              <div className="text-[#94a3b8] text-xs">
                Codes: {result.unmatchedCodes.slice(0, 10).join(", ")}
                {result.unmatchedCodes.length > 10 && ` +${result.unmatchedCodes.length - 10} more`}
              </div>
            </div>
          )}
          <div className="text-xs text-[#94a3b8]">
            Date range: {result.dateRangeStart} → {result.dateRangeEnd}
          </div>
        </div>
      )}

      {state === "error" && (
        <div className="bg-red-950/30 border border-red-800 rounded-lg p-4 flex items-center gap-2 text-red-400">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="text-sm">{errorMsg}</span>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color = "text-white" }: { label: string; value: number; color?: string }) {
  return (
    <div>
      <div className="text-xs text-[#94a3b8]">{label}</div>
      <div className={`text-lg font-bold tabular-nums ${color}`}>{value.toLocaleString()}</div>
    </div>
  );
}
