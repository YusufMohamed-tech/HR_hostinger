"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRoleContext } from "@/providers/RoleProvider";
import { 
  Activity,
  Banknote,
  Building2,
  CalendarDays,
  FileText,
  GraduationCap,
  LayoutDashboard,
  Layers,
  MapPin,
  Network,
  Radar,
  Settings,
  Sparkles,
  Users,
  Workflow,
  LineChart
} from "lucide-react";
import { cn } from "@/lib/utils";

export function SidebarContent() {
  const pathname = usePathname();
  const { currentUser } = useRoleContext();

  const getSections = () => {
    const role = currentUser?.role ?? "Employee";
    const isAdmin = role === "Admin" || role === "Super Admin";
    const isLeader = role === "Team Leader" || isAdmin;

    const core = [
      { name: "Dashboard", href: "/", icon: LayoutDashboard },
      { name: "Schedule", href: "/schedule", icon: CalendarDays },
      { name: "Learning", href: "/learning", icon: GraduationCap },
    ];

    const org = role === "Super Admin"
      ? [{ name: "Organizations", href: "/organizations", icon: Building2 }]
      : [];

    const hrOps = isAdmin
      ? [
          { name: "Employees", href: "/employees", icon: Users },
          { name: "Departments", href: "/departments", icon: Layers },
          { name: "Locations", href: "/locations", icon: MapPin },
          { name: "Contracts", href: "/contracts", icon: FileText },
          { name: "Hierarchy", href: "/hierarchy", icon: Workflow },
        ]
      : [];

    const operations = isLeader
      ? [{ name: "Events", href: "/events", icon: Activity }]
      : [];

    const insights = isLeader
      ? [
          { name: "Analytics", href: "/analytics", icon: LineChart },
          { name: "Payroll", href: "/payroll", icon: Banknote },
          { name: "Tracking", href: "/tracking", icon: Radar },
          { name: "AI Insights", href: "/ai-insights", icon: Sparkles },
          { name: "Audit Logs", href: "/audit-logs", icon: FileText },
        ]
      : [];

    const system = isAdmin
      ? [{ name: "Settings", href: "/settings", icon: Settings }]
      : [];

    return [
      { title: "Core", links: core },
      { title: "Organizations", links: org },
      { title: "HR Ops", links: hrOps },
      { title: "Operations", links: operations },
      { title: "Insights", links: insights },
      { title: "System", links: system },
    ];
  };

  const sections = getSections();

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-slate-900 border-r border-slate-800">
      <div className="flex h-16 shrink-0 items-center px-6 gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-white shadow-sm">
          <Network className="h-5 w-5" />
        </div>
        <span className="font-bold text-xl tracking-tight text-white">Tatwir Talent</span>
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
                  return (
                    <Link
                      key={link.name}
                      href={link.href}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-3 py-2.5 transition-all duration-150",
                        isActive
                          ? "bg-brand text-white shadow-sm font-medium"
                          : "text-slate-300 hover:bg-slate-800 hover:text-white"
                      )}
                    >
                      <Icon className="h-4 w-4" />
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
    <aside className="hidden lg:flex w-[240px] flex-col h-screen fixed left-0 top-0 z-30">
      <SidebarContent />
    </aside>
  );
}
