"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import type { AccountingAccount } from "@/types/accounting";

interface AccountComboboxProps {
  value: string;
  onChange: (value: string) => void;
  accounts: AccountingAccount[];
  placeholder?: string;
  disabled?: boolean;
}

export function AccountCombobox({ value, onChange, accounts, placeholder = "اختر الحساب", disabled }: AccountComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const activeAccounts = useMemo(() => accounts.filter((a) => a.is_active), [accounts]);

  const filtered = useMemo(() => {
    if (!search) return activeAccounts;
    const lower = search.toLowerCase();
    return activeAccounts.filter(
      (a) =>
        a.code.startsWith(search) ||
        a.code.toLowerCase().startsWith(lower) ||
        a.name_ar.includes(search) ||
        (a.name_en && a.name_en.toLowerCase().includes(lower))
    );
  }, [activeAccounts, search]);

  const selected = useMemo(() => accounts.find((a) => a.id === value), [accounts, value]);

  useEffect(() => {
    setHighlightIndex(0);
  }, [filtered]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  const select = useCallback(
    (accountId: string) => {
      onChange(accountId);
      setOpen(false);
      setSearch("");
    },
    [onChange]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((i) => Math.min(i + 1, filtered.length - 1));
      scrollToHighlight();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
      scrollToHighlight();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[highlightIndex]) select(filtered[highlightIndex].id);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const scrollToHighlight = () => {
    requestAnimationFrame(() => {
      const el = listRef.current?.querySelector("[data-highlighted]");
      el?.scrollIntoView({ block: "nearest" });
    });
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className="flex h-10 w-full items-center justify-between rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className={selected ? "text-gray-900" : "text-gray-400"}>
          {selected ? `${selected.code} - ${selected.name_ar}` : placeholder}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[280px] rounded-lg border border-gray-200 bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-gray-100 p-2">
            <Search className="h-4 w-4 text-gray-400" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="ابحث بالاسم أو الرقم..."
              className="h-8 flex-1 bg-transparent text-sm outline-none placeholder:text-gray-400"
            />
            {search && (
              <button type="button" onClick={() => setSearch("")} className="text-gray-400 hover:text-gray-600">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div ref={listRef} className="max-h-[240px] overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <div className="p-3 text-center text-sm text-gray-400">لا توجد نتائج</div>
            ) : (
              filtered.map((account, index) => (
                <div
                  key={account.id}
                  data-highlighted={index === highlightIndex ? "" : undefined}
                  onClick={() => select(account.id)}
                  className={`flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                    index === highlightIndex ? "bg-brand/10 text-brand" : "hover:bg-gray-50"
                  } ${account.id === value ? "font-medium" : ""}`}
                >
                  <span className="font-mono text-xs text-gray-500">{account.code}</span>
                  <span className="truncate">{account.name_ar}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
