"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRoleContext } from "@/providers/RoleProvider";
import { cn } from "@/lib/utils";
import {
  Building2,
  ClipboardCheck,
  History,
  LayoutDashboard,
  Network,
  Settings,
  Shield,
  Users,
} from "lucide-react";

const PLATFORM_SECTIONS = [
  {
    title: "المنصة",
    links: [
      { name: "لوحة المنصة", href: "/superadmin", icon: LayoutDashboard },
      { name: "المنظمات", href: "/superadmin/organizations", icon: Building2 },
      { name: "اليوزرات", href: "/superadmin/users", icon: Users },
      { name: "اعتمادات HR والمهام", href: "/superadmin/approvals", icon: ClipboardCheck },
      { name: "سجل التدقيق", href: "/superadmin/audit", icon: History },
    ],
  },
  {
    title: "الحساب",
    links: [
      { name: "إعدادات الحساب", href: "/superadmin/settings", icon: Settings },
    ],
  },
];

export function PlatformSidebarContent() {
  const pathname = usePathname();
  const { currentUser } = useRoleContext();

  if (!currentUser || currentUser.role !== "Superadmin") {
    return null;
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto border-l border-slate-800 bg-slate-950">
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-slate-800 px-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-white shadow-sm">
          <Network className="h-5 w-5" />
        </div>
        <div className="flex flex-col">
          <span className="font-bold text-lg tracking-tight text-white">منصة تطوير</span>
          <span className="text-[11px] text-slate-400">Superadmin Control Plane</span>
        </div>
      </div>

      <div className="px-6 py-4">
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
          <div className="flex items-center gap-2 text-slate-100">
            <Shield className="h-4 w-4 text-brand" />
            <span className="text-sm font-medium">المشرف العام</span>
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-400">
            إدارة المنصة والجهات والمستخدمين من سطح تحكم مستقل عن بيئة الموارد البشرية.
          </p>
        </div>
      </div>

      <div className="flex-1 py-2">
        <nav className="grid items-start gap-4 px-4 text-sm font-medium">
          {PLATFORM_SECTIONS.map((section) => (
            <div key={section.title} className="grid gap-1">
              <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                {section.title}
              </p>
              {section.links.map((link) => {
                const Icon = link.icon;
                const isActive = pathname === link.href || (link.href !== "/superadmin" && pathname.startsWith(`${link.href}/`));

                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2.5 transition-all duration-150",
                      isActive
                        ? "bg-brand text-white shadow-sm font-medium"
                        : "text-slate-300 hover:bg-slate-900 hover:text-white"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {link.name}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
      </div>
    </div>
  );
}

export function PlatformSidebar() {
  return (
    <aside className="fixed right-0 top-0 z-30 hidden h-screen w-[260px] flex-col lg:flex">
      <PlatformSidebarContent />
    </aside>
  );
}
