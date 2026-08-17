"use client";

import { useState, useRef, useEffect } from "react";
import { Download, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import {
  type ExportFormat,
  getReportMeta,
  generateExportFilename,
} from "@/lib/accounting/reports/registry";
import { useAccountingEntity } from "@/providers/AccountingEntityProvider";

interface ReportExportMenuProps {
  reportId: string;
  params: Record<string, string>;
}

const FORMAT_ICONS: Record<ExportFormat, typeof FileText> = {
  csv: FileText,
  xlsx: FileSpreadsheet,
  pdf: FileText,
};

const FORMAT_LABELS: Record<ExportFormat, { ar: string; en: string }> = {
  csv: { ar: "CSV", en: "CSV" },
  xlsx: { ar: "Excel", en: "Excel" },
  pdf: { ar: "PDF", en: "PDF" },
};

export function ReportExportMenu({ reportId, params }: ReportExportMenuProps) {
  const meta = getReportMeta(reportId);
  const { entityHeader, currentEntity } = useAccountingEntity();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState<ExportFormat | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  if (!meta) return null;

  async function handleExport(format: ExportFormat) {
    setLoading(format);
    try {
      const queryParams = new URLSearchParams({ ...params, format });
      const headers: Record<string, string> = {};
      if (entityHeader) headers["X-Accounting-Entity-Id"] = entityHeader;

      const res = await fetch(
        `/api/accounting/reports/export/${reportId}?${queryParams}`,
        { headers }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Export failed" }));
        alert(err.message_ar || err.message || "فشل التصدير");
        return;
      }

      const blob = await res.blob();
      const filename = generateExportFilename(meta!, {
        entity: currentEntity?.code,
        from: params.date_from,
        to: params.date_to,
        date: params.date_to || params.as_of_date,
      }, format);

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setLoading(null);
      setOpen(false);
    }
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-accent transition-colors"
        aria-expanded={open}
        disabled={loading !== null}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Download className="h-4 w-4" />
        )}
        <span>تصدير</span>
      </button>

      {open && (
        <div className="absolute end-0 top-full z-50 mt-1 min-w-[140px] rounded-md border bg-popover p-1 shadow-md">
          {meta.supportedFormats.map((format) => {
            const Icon = FORMAT_ICONS[format];
            return (
              <button
                key={format}
                onClick={() => handleExport(format)}
                disabled={loading !== null}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent transition-colors disabled:opacity-50"
              >
                <Icon className="h-4 w-4 text-muted-foreground" />
                <span>{FORMAT_LABELS[format].ar}</span>
                {loading === format && <Loader2 className="h-3 w-3 animate-spin ms-auto" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
