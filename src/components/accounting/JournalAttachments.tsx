"use client";

import React, { useCallback, useRef, useState } from "react";
import { FileText, Image as ImageIcon, Paperclip, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addJournalAttachment, deleteJournalAttachment } from "@/lib/services/accounting";

interface Attachment {
  id: string;
  file_name: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  description: string | null;
  uploaded_by: string;
  uploaded_at: string;
}

interface JournalAttachmentsProps {
  journalEntryId: string;
  attachments: Attachment[];
  canUpload: boolean;
  canDelete: boolean;
  onRefresh: () => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) return <ImageIcon className="h-5 w-5 text-blue-500" />;
  if (mimeType === "application/pdf") return <FileText className="h-5 w-5 text-red-500" />;
  return <Paperclip className="h-5 w-5 text-gray-500" />;
}

const ALLOWED_EXTENSIONS = ["pdf", "jpg", "jpeg", "png", "gif", "doc", "docx", "xls", "xlsx", "csv"];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export function JournalAttachments({ journalEntryId, attachments, canUpload, canDelete, onRefresh }: JournalAttachmentsProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError("");
    setUploading(true);

    for (const file of Array.from(files)) {
      const ext = file.name.split(".").pop()?.toLowerCase() || "";
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        setError(`نوع الملف غير مدعوم: .${ext}`);
        setUploading(false);
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        setError(`حجم الملف يتجاوز الحد الأقصى (10 ميجابايت): ${file.name}`);
        setUploading(false);
        return;
      }

      const filePath = `journal-attachments/${journalEntryId}/${crypto.randomUUID()}_${file.name}`;
      const result = await addJournalAttachment(journalEntryId, {
        file_name: file.name,
        file_path: filePath,
        file_size: file.size,
        mime_type: file.type || "application/octet-stream",
      });
      if (result.error) {
        setError(result.error);
        break;
      }
    }

    setUploading(false);
    onRefresh();
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [journalEntryId, onRefresh]);

  const handleDelete = useCallback(async (attachmentId: string) => {
    const result = await deleteJournalAttachment(journalEntryId, attachmentId);
    if (result.error) setError(result.error);
    else onRefresh();
  }, [journalEntryId, onRefresh]);

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <span>{error}</span>
          <button type="button" onClick={() => setError("")}><X className="h-4 w-4" /></button>
        </div>
      )}

      {canUpload && (
        <div className="flex items-center gap-3">
          <Input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(",")}
            onChange={(e) => handleUpload(e.target.files)}
            className="max-w-xs text-sm"
            disabled={uploading}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="ml-2 h-4 w-4" />
            {uploading ? "جاري الرفع..." : "رفع ملف"}
          </Button>
        </div>
      )}

      {attachments.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-400">
          <Paperclip className="mx-auto mb-2 h-8 w-8 text-gray-300" />
          <p>لا توجد مرفقات</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-100 rounded-lg border border-gray-200">
          {attachments.map((att) => (
            <div key={att.id} className="flex items-center gap-3 px-4 py-3">
              {fileIcon(att.mime_type)}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-900">{att.file_name}</p>
                <p className="text-xs text-gray-500">
                  {formatFileSize(att.file_size)} · {new Date(att.uploaded_at).toLocaleDateString("ar-SA")}
                </p>
              </div>
              {canDelete && (
                <Button variant="ghost" size="sm" onClick={() => handleDelete(att.id)} className="text-red-500 hover:text-red-700">
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
