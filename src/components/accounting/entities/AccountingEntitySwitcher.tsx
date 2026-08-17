"use client";

import { useAccountingEntity } from "@/providers/AccountingEntityProvider";
import { useRouter } from "next/navigation";
import { Building2, Check, ChevronDown, Plus } from "lucide-react";
import { useState, useRef, useEffect } from "react";

export function AccountingEntitySwitcher() {
  const { currentEntity, allowedEntities, switchEntity, isLoading } = useAccountingEntity();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (isLoading || allowedEntities.length === 0) return null;

  const filtered = allowedEntities.filter((e) =>
    !search || e.name_ar.includes(search) || (e.name_en || "").toLowerCase().includes(search.toLowerCase()) || e.code.includes(search)
  );

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <Building2 className="h-4 w-4 text-muted-foreground" />
        <span className="max-w-[140px] truncate font-medium">
          {currentEntity?.name_ar || currentEntity?.code}
        </span>
        <span className="text-xs text-muted-foreground">{currentEntity?.functional_currency_code}</span>
        <ChevronDown className="h-3 w-3 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute start-0 top-full z-50 mt-1 min-w-[240px] rounded-md border bg-popover p-1 shadow-md">
          {allowedEntities.length > 3 && (
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث..."
              className="mb-1 w-full rounded-sm border-0 bg-muted px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              autoFocus
            />
          )}
          <ul role="listbox" className="max-h-[200px] overflow-y-auto">
            {filtered.map((entity) => {
              const isSelected = entity.id === currentEntity?.id;
              return (
                <li key={entity.id} role="option" aria-selected={isSelected}>
                  <button
                    onClick={() => {
                      switchEntity(entity.id);
                      setOpen(false);
                      setSearch("");
                    }}
                    className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 ${
                      isSelected ? "bg-gray-50 dark:bg-gray-900 font-medium" : ""
                    }`}
                  >
                    <Check className={`h-3.5 w-3.5 shrink-0 ${isSelected ? "text-emerald-600" : "invisible"}`} />
                    <span className="flex-1 truncate text-start">{entity.name_ar}</span>
                    <span className="text-xs text-muted-foreground">{entity.functional_currency_code}</span>
                    {entity.is_default && (
                      <span className="text-[10px] text-muted-foreground">(افتراضي)</span>
                    )}
                  </button>
                </li>
              );
            })}
            {filtered.length === 0 && (
              <li className="px-2 py-1.5 text-sm text-muted-foreground">لا توجد نتائج</li>
            )}
          </ul>
          <div className="border-t mt-1 pt-1">
            <button
              onClick={() => {
                setOpen(false);
                router.push("/accounting/entity-setup");
              }}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-muted-foreground hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>إدارة الكيانات</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
