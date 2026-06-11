"use client";

import React from "react";
import { usePathname, useRouter } from "next/navigation";
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
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Menu, LogOut, Shield, Network } from "lucide-react";
import { PlatformSidebarContent } from "./PlatformSidebar";

const PAGE_META: Record<string, { title: string; description: string }> = {
  "/superadmin": {
    title: "لوحة المنصة",
    description: "نظرة عامة على الجهات، المستخدمين، ونشاط المنصة على المستوى المركزي.",
  },
  "/superadmin/organizations": {
    title: "إدارة المنظمات",
    description: "إنشاء الجهات ومراجعة حالتها ومتابعة توزيع مستخدميها من مركز تحكم موحد.",
  },
  "/superadmin/approvals": {
    title: "اعتمادات HR والمهام",
    description: "مراجعة إجازات HR وRecruiters وإسناد مهام مباشرة لهم عبر المنظمات.",
  },
  "/superadmin/settings": {
    title: "إعدادات المنصة",
    description: "إدارة حساب المشرف العام وجلسة الدخول من مساحة المنصة المستقلة.",
  },
  "/superadmin/audit": {
    title: "سجل تدقيق المنصة",
    description: "مراجعة عمليات المشرف العام على المنظمات والمستخدمين.",
  },
};

export function PlatformHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { currentUser, logout } = useRoleContext();

  const pageMeta = pathname.startsWith("/superadmin/organizations/")
    ? {
        title: "تفاصيل المنظمة",
        description: "إدارة مستخدمي وصلاحيات منظمة محددة من مركز تحكم المشرف العام.",
      }
    : PAGE_META[pathname] ?? PAGE_META["/superadmin"];

  if (!currentUser) {
    return null;
  }

  const handleLogout = async () => {
    await logout();
    router.replace("/login");
  };

  return (
    <header className="relative z-20 flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6 shadow-[0_1px_2px_0_rgba(0,0,0,0.03)]">
      <div className="flex items-center gap-4 lg:hidden">
        <Sheet>
          <SheetTrigger render={<Button variant="ghost" size="icon" className="-ml-2 shrink-0 hover:bg-slate-100" />}>
            <Menu className="h-5 w-5" />
            <span className="sr-only">فتح أو إغلاق قائمة المنصة</span>
          </SheetTrigger>
          <SheetContent side="right" className="w-[280px] border-r-0 p-0">
            <SheetTitle className="sr-only">قائمة المنصة</SheetTitle>
            <PlatformSidebarContent />
          </SheetContent>
        </Sheet>

        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-brand text-white">
            <Network className="h-4 w-4" />
          </div>
          <span className="hidden text-lg font-bold tracking-tight text-slate-900 sm:inline-flex">منصة تطوير</span>
        </div>
      </div>

      <div className="hidden lg:flex lg:flex-col">
        <h1 className="text-lg font-semibold text-slate-950">{pageMeta.title}</h1>
        <p className="text-sm text-slate-500">{pageMeta.description}</p>
      </div>

      <div className="flex items-center gap-4">
        <div className="hidden items-center sm:flex">
          <span className="rounded-full bg-brand-light px-2.5 py-1 text-xs font-semibold tracking-wider text-brand-dark">
            {currentUser.name || "Dr. Amr Naiem"}
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
                  <p className="text-xs leading-none text-muted-foreground">{currentUser.email}</p>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="cursor-default text-slate-600 focus:bg-slate-50 focus:text-slate-600">
              <Shield className="ml-2 h-4 w-4" />
              المشرف العام
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="cursor-pointer text-red-600">
              <LogOut className="ml-2 h-4 w-4" />
              تسجيل الخروج
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
