"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useRoleContext } from "@/providers/RoleProvider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { LogOut, Menu, Search, Network, Users, MapPin, Calendar, CheckSquare, Bell, ClipboardList, Layers, Briefcase, Settings, Calculator } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { SidebarContent } from "./Sidebar";

const ALL_SEARCH_ITEMS = [
  { label: "الموظفون", href: "/employees", icon: Users, keywords: ["staff", "people", "team", "workers", "موظف", "فريق"] },
  { label: "الأقسام", href: "/departments", icon: Layers, keywords: ["teams", "divisions", "groups", "قسم"] },
  { label: "الحضور", href: "/attendance", icon: Calendar, keywords: ["clock-in", "check-in", "presence", "حضور", "انصراف"] },
  { label: "المهام", href: "/tasks", icon: CheckSquare, keywords: ["work", "assignments", "todo", "مهمة"] },
  { label: "الإجازات", href: "/leave", icon: ClipboardList, keywords: ["vacation", "sick", "time off", "إجازة"] },
  { label: "المواقع", href: "/locations", icon: MapPin, keywords: ["sites", "branches", "geofence", "موقع", "فرع"] },
  { label: "الجداول", href: "/schedule", icon: Calendar, keywords: ["shifts", "roster", "timetable", "وردية", "جدول"] },
  { label: "التوظيف", href: "/recruitment", icon: Briefcase, keywords: ["recruitment", "jobs", "candidates", "توظيف", "وظائف", "مرشحين"] },
  { label: "الإشعارات", href: "/notifications", icon: Bell, keywords: ["alerts", "updates", "تنبيه"] },
  { label: "المالية والمحاسبة", href: "/accounting", icon: Calculator, keywords: ["finance", "accounting", "ledger", "invoice", "journal", "محاسبة", "مالية", "قيود", "فواتير"] },
  { label: "الإعدادات", href: "/settings", icon: Settings, keywords: ["profile", "preferences", "config", "إعدادات"] },
];

const RECRUITER_SEARCH_ITEMS = ALL_SEARCH_ITEMS.filter((item) =>
  ["/recruitment", "/notifications", "/settings"].includes(item.href)
);
const HR_ADMIN_SEARCH_ITEMS = ALL_SEARCH_ITEMS.filter((item) => item.href !== "/recruitment");
const FINANCE_SEARCH_ITEMS = ALL_SEARCH_ITEMS.filter((item) =>
  item.href.startsWith("/accounting") || item.href === "/notifications" || item.href === "/settings"
);

const ROLE_LABELS: Record<string, string> = {
  Superadmin: "المشرف العام",
  Admin: "مسؤول النظام",
  HR_Admin: "مسؤول الموارد البشرية",
  HR_Recruitment: "مسؤول التوظيف",
  Training_Manager: "مدير التدريب",
  Finance_Manager: "مدير المالية",
  Accountant: "محاسب",
  Finance_Viewer: "مطلع مالي",
  Sales: "المبيعات",
  Sales_Manager: "مدير المبيعات",
  Employee: "موظف",
};

export function Header() {
  const router = useRouter();
  const { currentUser, logout } = useRoleContext();
  const [query, setQuery] = useState("");
  const [showResults, setShowResults] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const searchItems = useMemo(() => {
    if (currentUser?.role === "HR_Recruitment") return RECRUITER_SEARCH_ITEMS;
    if (currentUser?.role === "HR_Admin") return HR_ADMIN_SEARCH_ITEMS;
    if (["Finance_Manager", "Accountant", "Finance_Viewer"].includes(currentUser?.role || "")) return FINANCE_SEARCH_ITEMS;
    if (currentUser?.role === "Employee") {
      return ALL_SEARCH_ITEMS.map((item) =>
        item.href === "/tasks" ? { ...item, label: "مهامي", href: "/tasks/mine" } : item
      );
    }
    return ALL_SEARCH_ITEMS;
  }, [currentUser?.role]);

  const filtered = query.trim().length > 0
    ? searchItems.filter((item) => {
        const q = query.toLowerCase();
        return item.label.toLowerCase().includes(q) || item.keywords.some((k) => k.includes(q));
      })
    : [];

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (href: string) => {
    setQuery("");
    setShowResults(false);
    router.push(href);
  };

  if (!currentUser) {
    return null;
  }

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-gray-200 px-6 bg-white shadow-[0_1px_2px_0_rgba(0,0,0,0.03)] z-20 relative">
      <div className="flex items-center gap-4 lg:hidden">
        <Sheet>
          <SheetTrigger render={<Button variant="ghost" size="icon" className="shrink-0 -ml-2 hover:bg-slate-100" />}>
            <Menu className="h-5 w-5" />
            <span className="sr-only">فتح أو إغلاق قائمة التنقل</span>
          </SheetTrigger>
          <SheetContent side="right" className="w-[280px] p-0 border-r-0">
            <SheetTitle className="sr-only">قائمة التنقل</SheetTitle>
            <SidebarContent />
          </SheetContent>
        </Sheet>

        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-brand text-white">
            <Network className="h-4 w-4" />
          </div>
          <span className="font-bold text-lg tracking-tight text-slate-900 hidden sm:inline-flex">تطوير تالنت</span>
        </div>
      </div>

      <div className="hidden lg:flex lg:flex-1" ref={searchRef}>
        <div className="relative w-full max-w-md">
          <Search className="absolute right-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            type="search"
            placeholder={
              currentUser.role === "HR_Recruitment"
                ? "ابحث في التوظيف أو الإشعارات..."
                : "ابحث عن موظفين أو أقسام أو ورديات..."
            }
            className="w-full bg-muted border-none shadow-none pr-9 py-2 hover:bg-gray-100 focus-visible:bg-gray-100 focus-visible:ring-1 focus-visible:ring-brand transition-colors h-9"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setShowResults(true); }}
            onFocus={() => setShowResults(true)}
          />
          {showResults && filtered.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 overflow-hidden">
              {filtered.map((item) => (
                <button
                  key={item.href}
                  className="flex items-center gap-3 w-full px-4 py-2.5 text-right text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                  onClick={() => handleSelect(item.href)}
                >
                  <item.icon className="h-4 w-4 text-gray-400" />
                  <span className="font-medium">{item.label}</span>
                  <span className="text-xs text-gray-400 mr-auto">{item.href}</span>
                </button>
              ))}
            </div>
          )}
          {showResults && query.trim().length > 0 && filtered.length === 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 p-4 text-center">
              <p className="text-sm text-gray-500">لا توجد نتائج لـ &ldquo;{query}&rdquo;</p>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4 mr-4">
        <div className="hidden sm:flex items-center mx-4">
          <span className="text-xs font-semibold tracking-wider text-brand bg-brand-light px-2.5 py-1 rounded-full">
            عرض {ROLE_LABELS[currentUser.role] || currentUser.role}
          </span>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" className="relative h-8 w-8 rounded-full" />}>
            <Avatar className="h-9 w-9">
              <AvatarFallback>{currentUser.name.charAt(0)}</AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="end">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium leading-none">{currentUser.name}</p>
                  <p className="text-xs leading-none text-muted-foreground">
                    {currentUser.email}
                  </p>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={logout} className="cursor-pointer text-red-600">
              <LogOut className="ml-2 h-4 w-4" />
              تسجيل الخروج
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
