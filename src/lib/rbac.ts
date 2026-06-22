import type { Role } from "@/types";

export type OrgRole =
  | "super_admin"
  | "admin"
  | "employee"
  | "hr_admin"
  | "hr_recruitment"
  | "training_manager"
  | "sales"
  | "sales_manager"
  | "finance_manager"
  | "accountant"
  | "finance_viewer";

export const ALL_ROLES: Role[] = [
  "Superadmin",
  "Admin",
  "HR_Admin",
  "HR_Recruitment",
  "Training_Manager",
  "Sales",
  "Sales_Manager",
  "Finance_Manager",
  "Accountant",
  "Finance_Viewer",
  "Employee",
];

export function roleFromOrgRole(role: string | null | undefined): Role | null {
  if (role === "super_admin") return "Superadmin";
  if (role === "admin") return "Admin";
  if (role === "hr_admin") return "HR_Admin";
  if (role === "hr_recruitment") return "HR_Recruitment";
  if (role === "training_manager") return "Training_Manager";
  if (role === "sales") return "Sales";
  if (role === "sales_manager") return "Sales_Manager";
  if (role === "finance_manager") return "Finance_Manager";
  if (role === "accountant") return "Accountant";
  if (role === "finance_viewer") return "Finance_Viewer";
  if (role === "employee") return "Employee";
  return null;
}

export function getDefaultPathForRole(role: Role): string {
  if (role === "Superadmin") return "/superadmin";
  if (role === "HR_Recruitment") return "/recruitment";
  if (role === "Sales") return "/sales/dashboard";
  if (role === "Sales_Manager") return "/sales/dashboard";
  if (["Finance_Manager", "Accountant", "Finance_Viewer"].includes(role)) return "/accounting";
  return "/";
}

export function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname === "/suspended" ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/apply/") ||
    pathname.startsWith("/candidate/login") ||
    pathname.startsWith("/candidate/register") ||
    pathname === "/candidate/applications" ||
    // Public posting lookup (no auth needed)
    pathname === "/api/candidate/posting" ||
    pathname === "/api/candidate/apply"
  );
}

export function isCandidatePath(pathname: string): boolean {
  return (
    pathname.startsWith("/apply/") ||
    pathname.startsWith("/candidate/")
  );
}

export function canAccessPath(role: Role, pathname: string): boolean {
  const normalizedPath = normalizePath(pathname);

  if (role === "Superadmin") {
    return true;
  }

  if (normalizedPath.startsWith("/superadmin") || normalizedPath.startsWith("/api/superadmin")) {
    return false;
  }

  if (normalizedPath === "/") {
    return !["HR_Recruitment", "Sales", "Sales_Manager", "Finance_Manager", "Accountant", "Finance_Viewer"].includes(role);
  }

  if (["Finance_Manager", "Accountant", "Finance_Viewer"].includes(role)) {
    if (normalizedPath.startsWith("/accounting/settings")) {
      return role === "Finance_Manager";
    }
    if (
      role === "Finance_Viewer" &&
      (
        normalizedPath === "/accounting/journal-entries/new" ||
        normalizedPath === "/accounting/expenses/new" ||
        normalizedPath === "/accounting/invoices/new"
      )
    ) {
      return false;
    }
    return (
      normalizedPath.startsWith("/accounting") ||
      normalizedPath.startsWith("/api/accounting") ||
      normalizedPath.startsWith("/payroll") ||
      normalizedPath.startsWith("/notifications") ||
      normalizedPath.startsWith("/settings")
    );
  }

  if (normalizedPath.startsWith("/api/hr")) {
    return ["Admin", "HR_Admin"].includes(role);
  }

  if (normalizedPath.startsWith("/api/manager")) {
    return role === "Training_Manager";
  }

  if (normalizedPath.startsWith("/api/recruitment")) {
    return ["Admin", "HR_Admin", "HR_Recruitment"].includes(role);
  }

  if (normalizedPath.startsWith("/api/sales")) {
    return ["Admin", "HR_Admin", "Sales", "Sales_Manager"].includes(role);
  }

  if (normalizedPath.startsWith("/api/accounting")) {
    return ["Admin", "HR_Admin", "Sales_Manager", "Finance_Manager", "Accountant", "Finance_Viewer"].includes(role);
  }

  // /api/candidate/* — authenticated candidates (no role) go through middleware
  // but these routes use admin client and do their own auth check
  if (normalizedPath.startsWith("/api/candidate")) {
    return true;
  }

  if (normalizedPath.startsWith("/recruitment")) {
    return ["Admin", "HR_Recruitment"].includes(role);
  }

  if (
    normalizedPath.startsWith("/sales/dashboard") ||
    normalizedPath.startsWith("/sales/log") ||
    normalizedPath.startsWith("/sales/history")
  ) {
    return ["Sales", "Sales_Manager", "Admin", "HR_Admin"].includes(role);
  }

  if (normalizedPath.startsWith("/sales")) {
    return ["Sales_Manager", "Admin", "HR_Admin"].includes(role);
  }

  if (normalizedPath.startsWith("/accounting")) {
    return ["Admin", "Finance_Manager", "Accountant", "Finance_Viewer"].includes(role);
  }

  if (normalizedPath.startsWith("/attendance") || normalizedPath.startsWith("/api/attendance")) {
    return role !== "HR_Recruitment";
  }

  if (
    normalizedPath.startsWith("/employees") ||
    normalizedPath.startsWith("/departments") ||
    normalizedPath.startsWith("/personnel") ||
    normalizedPath.startsWith("/payroll")
  ) {
    if (normalizedPath.startsWith("/employees")) {
      return ["Admin", "HR_Admin", "Training_Manager"].includes(role);
    }
    return ["Admin", "HR_Admin"].includes(role);
  }

  if (normalizedPath.startsWith("/balances") || normalizedPath.startsWith("/assets")) {
    return ["Admin", "HR_Admin", "Employee"].includes(role);
  }

  if (normalizedPath.startsWith("/tasks") || normalizedPath.startsWith("/leave")) {
    return true;
  }

  if (
    normalizedPath.startsWith("/schedule") ||
    normalizedPath.startsWith("/locations") ||
    normalizedPath.startsWith("/notifications") ||
    normalizedPath.startsWith("/settings")
  ) {
    return role !== "HR_Recruitment" || normalizedPath.startsWith("/notifications") || normalizedPath.startsWith("/settings");
  }

  return ALL_ROLES.includes(role);
}

function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}
