"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRoleContext } from "@/providers/RoleProvider";
import {
  Bell,
  Briefcase,
  Calculator,
  CalendarDays,
  CheckSquare,
  ClipboardList,
  Clock,
  FileText,
  Layers,
  LayoutDashboard,
  MapPin,
  Network,
  Package,
  Settings,
  Users,
  WalletCards,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function SidebarContent() {
  const pathname = usePathname();
  const { currentUser } = useRoleContext();

  const getSections = () => {
    const role = currentUser?.role ?? "Employee";
    const isSuperAdmin = role === "Superadmin";
    const isAdmin = role === "Admin" || isSuperAdmin;
    const isHRAdmin = role === "HR_Admin";

    const taskLinks = (isAdmin || isHRAdmin)
      ? [
          { name: "إسناد المهام", href: "/tasks", icon: CheckSquare },
          { name: "مهامي", href: "/tasks/mine", icon: CheckSquare, indent: true },
        ]
      : [{ name: "مهامي", href: "/tasks", icon: CheckSquare }];

    const core = [
      { name: "لوحة التحكم", href: "/", icon: LayoutDashboard },
      { name: "الحضور", href: "/attendance", icon: Clock },
      ...taskLinks,
      { name: "الإجازات", href: "/leave", icon: ClipboardList },
      { name: "الجداول", href: "/schedule", icon: CalendarDays },
      { name: "المواقع", href: "/locations", icon: MapPin },
      { name: "الإشعارات", href: "/notifications", icon: Bell },
    ];

    const fullAdminOps = [
      { name: "الموظفون", href: "/employees", icon: Users },
      { name: "الأقسام", href: "/departments", icon: Layers },
      { name: "ملفات الموظفين", href: "/personnel", icon: FileText },
      { name: "الرواتب", href: "/payroll", icon: Calculator },
      { name: "التوظيف", href: "/recruitment", icon: Briefcase },
      { name: "الأرصدة والعهد", href: "/balances", icon: WalletCards },
      { name: "الأصول", href: "/assets", icon: Package },
    ];
    const hrAdminOps = fullAdminOps.filter((link) => link.href !== "/recruitment");

    const recruitmentOps = [
      { name: "التوظيف", href: "/recruitment", icon: Briefcase },
      { name: "الإشعارات", href: "/notifications", icon: Bell },
    ];

    const system = [{ name: "الإعدادات", href: "/settings", icon: Settings }];

    if (role === "HR_Recruitment") {
      return [
        { title: "التوظيف", links: recruitmentOps },
        { title: "النظام", links: system },
      ];
    }

    return [
      { title: "الأساسي", links: core },
      { title: "الإدارة", links: isAdmin ? fullAdminOps : isHRAdmin ? hrAdminOps : [] },
      { title: "النظام", links: system },
    ];
  };

  const sections = getSections();

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-slate-900 border-l border-slate-800">
      <div className="flex h-16 shrink-0 items-center px-6 gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-white shadow-sm">
          <Network className="h-5 w-5" />
        </div>
        <span className="font-bold text-xl tracking-tight text-white">تطوير تالنت</span>
      </div>
      <div className="flex-1 py-6">
        <nav className="grid items-start px-4 text-sm font-medium gap-4">
          {sections.map((section) => (
            section.links.length > 0 ? (
              <div key={section.title} className="grid gap-1">
                <p className="px-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 mb-1">
                  {section.title}
                </p>
                {section.links.map((link) => {
                  const Icon = link.icon;
                  const isActive = pathname === link.href;
                  const indent = (link as Record<string, unknown>).indent === true;
                  return (
                    <Link
                      key={link.name}
                      href={link.href}
                      className={cn(
                        "flex items-center gap-3 rounded-lg py-2 transition-all duration-150",
                        indent ? "px-5 text-[13px]" : "px-3 py-2.5",
                        isActive
                          ? "bg-brand text-white shadow-sm font-medium"
                          : "text-slate-300 hover:bg-slate-800 hover:text-white"
                      )}
                    >
                      <Icon className={cn("h-4 w-4", indent && "h-3.5 w-3.5")} />
                      {link.name}
                    </Link>
                  );
                })}
              </div>
            ) : null
          ))}
        </nav>
      </div>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden lg:flex w-[240px] flex-col h-screen fixed right-0 top-0 z-30">
      <SidebarContent />
    </aside>
  );
}
