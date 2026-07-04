"use client";

import React from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useRoleContext } from "@/providers/RoleProvider";
import { useNotifications } from "@/hooks/use-data";
import {
  BarChart3,
  Bell,
  BookOpen,
  Boxes,
  Briefcase,
  Calculator,
  CalendarDays,
  CheckSquare,
  ClipboardList,
  Clock,
  FileText,
  Landmark,
  Layers,
  LayoutDashboard,
  GraduationCap,
  MapPin,
  Megaphone,
  MessageCircle,
  Network,
  Package,
  Receipt,
  Settings,
  Smartphone,
  ShoppingCart,
  Store,
  Users,
  WalletCards,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavLink = {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  indent?: boolean;
  match?: string;
};

type NavSection = {
  title: string;
  links: NavLink[];
};

export function SidebarContent() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { currentUser } = useRoleContext();
  const { data: notifications } = useNotifications();
  const leaveView = searchParams.get("view");
  const unreadNotifications = notifications.filter((note) => !note.is_read).length;

  const getSections = (): NavSection[] => {
    const role = currentUser?.role ?? "Employee";
    const isSuperAdmin = role === "Superadmin";
    const isOrgAdmin = role === "Admin";
    const isAdmin = isOrgAdmin || isSuperAdmin;
    const isHRAdmin = role === "HR_Admin";
    const isFinance = ["Finance_Manager", "Accountant", "Finance_Viewer"].includes(role);
    const canSeeFullAccounting = isSuperAdmin || isFinance;
    const canSeeFinanceTeam = isSuperAdmin || isOrgAdmin || isHRAdmin || role === "Finance_Manager";

    const taskLinks: NavLink[] = (isAdmin || isHRAdmin)
      ? [
          { name: "إسناد المهام", href: "/tasks", icon: CheckSquare },
          { name: "مهامي", href: "/tasks/mine", icon: CheckSquare, indent: true },
        ]
      : [{ name: "مهامي", href: "/tasks/mine", icon: CheckSquare }];

    const leaveLinks: NavLink[] = isHRAdmin
      ? [
          { name: "إدارة الإجازات", href: "/leave", icon: ClipboardList, match: "leave-manage" },
          { name: "طلب إجازتي", href: "/leave?view=mine", icon: ClipboardList, indent: true, match: "leave-mine" },
        ]
      : [{ name: "الإجازات", href: "/leave", icon: ClipboardList }];

    const lmsLearnerOps: NavLink[] = [
      { name: "\u0642\u0627\u0639\u0629 \u0627\u0644\u062a\u0639\u0644\u0645", href: "/learn", icon: GraduationCap },
      { name: "\u0644\u0648\u062d\u0629 \u0627\u0644\u0645\u062f\u0631\u0628", href: "/lms/instructor", icon: Users, indent: true },
      { name: "\u062a\u0639\u0644\u0645\u064a", href: "/lms/my", icon: BookOpen, indent: true },
      { name: "\u0643\u062a\u0627\u0644\u0648\u062c \u0627\u0644\u062f\u0648\u0631\u0627\u062a", href: "/lms/catalog", icon: BookOpen, indent: true },
    ];

    const lmsManagementOps: NavLink[] = [
      { name: "\u0625\u062f\u0627\u0631\u0629 \u0627\u0644\u062a\u0639\u0644\u0645", href: "/lms/courses", icon: BookOpen },
      { name: "\u0625\u0646\u0634\u0627\u0621 \u062f\u0648\u0631\u0629", href: "/lms/courses/new", icon: BookOpen, indent: true },
      { name: "\u0627\u0644\u062a\u0643\u0644\u064a\u0641\u0627\u062a", href: "/lms/assignments", icon: ClipboardList, indent: true },
      { name: "\u0627\u0644\u062a\u0642\u0627\u0631\u064a\u0631", href: "/lms/reports", icon: ClipboardList, indent: true },
      { name: "\u0627\u0644\u0634\u0647\u0627\u062f\u0627\u062a", href: "/lms/certificates", icon: FileText, indent: true },
    ];

    const core: NavLink[] = [
      { name: "لوحة التحكم", href: "/", icon: LayoutDashboard },
      { name: "الحضور", href: "/attendance", icon: Clock },
      ...taskLinks,
      ...leaveLinks,
      ...lmsLearnerOps,
      { name: "الجداول", href: "/schedule", icon: CalendarDays },
      { name: "المواقع", href: "/locations", icon: MapPin },
      { name: "الشات", href: "/chat", icon: MessageCircle },
      { name: "الإشعارات", href: "/notifications", icon: Bell },
    ];
    const financeCore: NavLink[] = [
      ...lmsLearnerOps,
      { name: "الشات", href: "/chat", icon: MessageCircle },
      { name: "الإشعارات", href: "/notifications", icon: Bell },
    ];

    const fullAdminOps: NavLink[] = [
      { name: "الموظفون", href: "/employees", icon: Users },
      { name: "الأقسام", href: "/departments", icon: Layers },
      { name: "ملفات الموظفين", href: "/personnel", icon: FileText },
      { name: "الرواتب", href: "/payroll", icon: Calculator },
      { name: "التوظيف", href: "/recruitment", icon: Briefcase },
      { name: "الأرصدة والعهد", href: "/balances", icon: WalletCards },
      { name: "الأصول", href: "/assets", icon: Package },
    ];
    const hrAdminOps = fullAdminOps.filter((link) => link.href !== "/recruitment");

    const employeeSelfOps: NavLink[] = [
      { name: "الأرصدة والسلف", href: "/balances", icon: WalletCards },
      { name: "العهد المستلمة", href: "/assets", icon: Package },
    ];

    const recruitmentOps: NavLink[] = [
      { name: "التوظيف", href: "/recruitment", icon: Briefcase },
      { name: "الشات", href: "/chat", icon: MessageCircle },
      { name: "مهامي", href: "/tasks/mine", icon: CheckSquare },
      { name: "إجازاتي", href: "/leave", icon: ClipboardList },
      { name: "الإشعارات", href: "/notifications", icon: Bell },
    ];

    const salesManagementOps: NavLink[] = [
      { name: "لوحة المبيعات", href: "/sales/dashboard", icon: BarChart3 },
      { name: "عملاء الترويج", href: "/sales/leads", icon: Users },
      { name: "إدارة الترويج", href: "/sales/promoter", icon: Megaphone },
      { name: "المندوبون", href: "/sales/agents", icon: Users },
      { name: "إدارة المخزون", href: "/sales/stock", icon: Boxes },
      { name: "التقارير", href: "/sales/reports", icon: ClipboardList },
      { name: "المنتجات", href: "/sales/products", icon: Boxes },
      { name: "فريق المبيعات", href: "/sales/team", icon: Users },
    ];

    const accountingOps: NavLink[] = [
      { name: "لوحة المحاسبة", href: "/accounting", icon: BarChart3 },
      { name: "دليل الحسابات", href: "/accounting/chart-of-accounts", icon: BookOpen },
      { name: "القيود اليومية", href: "/accounting/journal-entries", icon: Landmark },
      { name: "المصروفات", href: "/accounting/expenses", icon: Receipt },
      { name: "الموردون", href: "/accounting/vendors", icon: Users },
      { name: "العملاء", href: "/accounting/customers", icon: Users },
      { name: "الفواتير", href: "/accounting/invoices", icon: FileText },
      { name: "المدفوعات", href: "/accounting/payments", icon: WalletCards },
      { name: "مراكز التكلفة", href: "/accounting/cost-centers", icon: Layers },
      { name: "التقارير", href: "/accounting/reports", icon: ClipboardList },
      { name: "فريق المالية", href: "/accounting/team", icon: Users },
      { name: "الإعدادات", href: "/accounting/settings", icon: Settings },
    ].filter((link) => {
      if (link.href === "/accounting/settings") return isSuperAdmin || role === "Finance_Manager";
      if (link.href === "/accounting/team") return canSeeFinanceTeam;
      return true;
    });
    const accountingTeamOps: NavLink[] = [
      { name: "فريق المالية", href: "/accounting/team", icon: Users },
    ];

    const system: NavLink[] = [{ name: "الإعدادات", href: "/settings", icon: Settings }];

    if (role === "HR_Recruitment") {
      return [
        { title: "التوظيف", links: [...recruitmentOps, ...lmsLearnerOps] },
        { title: "النظام", links: system },
      ];
    }

    if (role === "Sales") {
      return [
        {
          title: "المبيعات",
          links: [
            { name: "لوحة المبيعات", href: "/sales/dashboard", icon: BarChart3 },
            { name: "الحضور", href: "/attendance", icon: Clock },
            { name: "ورديتي", href: "/schedule", icon: CalendarDays },
            { name: "تسجيل اليوم", href: "/sales/log", icon: ShoppingCart },
            { name: "سجل المبيعات", href: "/sales/history", icon: ClipboardList },
            { name: "عملاء الترويج", href: "/sales/leads", icon: Users },
            { name: "طلب إجازتي", href: "/leave?view=mine", icon: ClipboardList, match: "leave-mine" },
            ...lmsLearnerOps,
            { name: "الشات", href: "/chat", icon: MessageCircle },
            { name: "الإشعارات", href: "/notifications", icon: Bell },
          ],
        },
        { title: "النظام", links: system },
      ];
    }

    if (role === "Sales_Manager") {
      return [
        {
          title: "إدارة المبيعات",
          links: [
            ...salesManagementOps,
            { name: "الحضور", href: "/attendance", icon: Clock },
            { name: "الجداول", href: "/schedule", icon: CalendarDays },
            { name: "تسجيل اليوم", href: "/sales/log", icon: ShoppingCart },
            { name: "سجل مبيعاتي", href: "/sales/history", icon: ClipboardList },
            { name: "عملاء الترويج", href: "/sales/leads", icon: Users },
            { name: "طلب إجازتي", href: "/leave?view=mine", icon: ClipboardList, match: "leave-mine" },
            ...lmsLearnerOps,
            { name: "الشات", href: "/chat", icon: MessageCircle },
            { name: "الإشعارات", href: "/notifications", icon: Bell },
          ],
        },
        { title: "النظام", links: system },
      ];
    }

    if (role === "Promoter") {
      return [
        {
          title: "الترويج",
          links: [
            { name: "كشك العملاء", href: "/promoter", icon: Smartphone },
            { name: "عملائي", href: "/sales/leads", icon: Users },
            { name: "الحضور", href: "/attendance", icon: Clock },
            { name: "الإشعارات", href: "/notifications", icon: Bell },
          ],
        },
        { title: "النظام", links: system },
      ];
    }

    if (role === "Field_Agent") {
      return [
        {
          title: "المندوب",
          links: [
            { name: "الرئيسية", href: "/agent", icon: LayoutDashboard },
            { name: "شرائحي", href: "/agent/sims", icon: Smartphone },
            { name: "تسجيل مبيعة", href: "/agent/sell", icon: ShoppingCart },
            { name: "التجار", href: "/agent/merchants", icon: Store },
            { name: "طلب شرائح", href: "/agent/requests", icon: Package },
            { name: "رصيدي", href: "/agent/balance", icon: WalletCards },
            { name: "عمولاتي", href: "/agent/commissions", icon: Receipt },
            { name: "الحضور", href: "/attendance", icon: Clock },
            { name: "الإشعارات", href: "/notifications", icon: Bell },
          ],
        },
        { title: "النظام", links: system },
      ];
    }

    if (role === "Merchant") {
      return [
        {
          title: "التاجر",
          links: [
            { name: "الرئيسية", href: "/merchant", icon: LayoutDashboard },
            { name: "شرائحي", href: "/merchant/sims", icon: Smartphone },
            { name: "تسجيل بيع", href: "/merchant/sell", icon: ShoppingCart },
            { name: "طلب شرائح", href: "/merchant/requests", icon: Package },
            { name: "حسابي", href: "/merchant/balance", icon: WalletCards },
            { name: "الإشعارات", href: "/notifications", icon: Bell },
          ],
        },
        { title: "النظام", links: system },
      ];
    }

    return [
      { title: "الأساسي", links: isFinance ? financeCore : core },
      {
        title: "الإدارة",
        links: isAdmin
          ? [...fullAdminOps, ...lmsManagementOps]
          : isHRAdmin
            ? [...hrAdminOps, ...lmsManagementOps]
            : role === "Training_Manager"
              ? lmsManagementOps
              : role === "Employee"
                ? employeeSelfOps
                : [],
      },
      { title: "المبيعات", links: isAdmin || isHRAdmin ? salesManagementOps : [] },
      { title: "المالية والمحاسبة", links: canSeeFullAccounting ? accountingOps : canSeeFinanceTeam ? accountingTeamOps : [] },
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
          {sections.map((section) =>
            section.links.length > 0 ? (
              <div key={section.title} className="grid gap-1">
                <p className="px-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 mb-1">
                  {section.title}
                </p>
                {section.links.map((link) => {
                  const Icon = link.icon;
                  const isActive = link.match === "leave-mine"
                    ? pathname === "/leave" && leaveView === "mine"
                    : link.match === "leave-manage"
                      ? pathname === "/leave" && leaveView !== "mine"
                      : pathname === link.href;
                  const isNotificationsLink = link.href === "/notifications";
                  return (
                    <Link
                      key={link.name}
                      href={link.href}
                      className={cn(
                        "flex items-center gap-3 rounded-lg py-2 transition-all duration-150",
                        link.indent ? "px-5 text-[13px]" : "px-3 py-2.5",
                        isActive
                          ? "bg-brand text-white shadow-sm font-medium"
                          : "text-slate-300 hover:bg-slate-800 hover:text-white"
                      )}
                    >
                      <Icon className={cn("h-4 w-4", link.indent && "h-3.5 w-3.5")} />
                      <span className="min-w-0 flex-1">{link.name}</span>
                      {isNotificationsLink && unreadNotifications > 0 && (
                        <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-[11px] font-bold leading-5 text-white">
                          {unreadNotifications > 99 ? "99+" : unreadNotifications}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            ) : null
          )}
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
