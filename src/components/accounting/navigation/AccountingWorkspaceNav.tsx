"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { FINANCE_NAVIGATION, type NavGroup } from "./finance-navigation";

function isGroupActive(group: NavGroup, pathname: string): boolean {
  return group.items.some((item) => pathname === item.path || pathname.startsWith(item.path + "/"));
}

function GroupDropdown({ group, isActive }: { group: NavGroup; isActive: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  if (group.items.length === 1) {
    const item = group.items[0];
    return (
      <Link
        href={item.path}
        className={`whitespace-nowrap px-3 py-2 text-sm font-medium rounded-md transition-colors ${
          isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted"
        }`}
      >
        {group.label_ar}
      </Link>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1 whitespace-nowrap px-3 py-2 text-sm font-medium rounded-md transition-colors ${
          isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted"
        }`}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        {group.label_ar}
        <ChevronDown className="h-3 w-3" />
      </button>

      {open && (
        <div
          className="absolute start-0 top-full z-50 mt-1 min-w-[180px] rounded-md border bg-popover p-1 shadow-md"
          role="menu"
        >
          {group.items.map((item) => {
            const itemActive = pathname === item.path || pathname.startsWith(item.path + "/");
            return (
              <Link
                key={item.id}
                href={item.path}
                role="menuitem"
                onClick={() => setOpen(false)}
                className={`block rounded-sm px-3 py-1.5 text-sm transition-colors ${
                  itemActive ? "bg-accent font-medium" : "hover:bg-accent"
                }`}
              >
                {item.label_ar}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function AccountingWorkspaceNav() {
  const pathname = usePathname();
  const isFinanceRoute = pathname.startsWith("/accounting") || pathname.startsWith("/banking");

  if (!isFinanceRoute) return null;

  return (
    <nav
      className="relative z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60"
      aria-label="Finance workspace navigation"
    >
      <div className="flex items-center gap-1 px-4 py-1 flex-wrap">
        {FINANCE_NAVIGATION.map((group) => (
          <GroupDropdown
            key={group.id}
            group={group}
            isActive={isGroupActive(group, pathname)}
          />
        ))}
      </div>
    </nav>
  );
}
