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
  | "onground_agent_manager"
  | "inventory_receiver"
  | "promoter"
  | "field_agent"
  | "merchant"
  | "finance_manager"
  | "accountant"
  | "finance_viewer"
  | "supervisor";

export const ALL_ROLES: Role[] = [
  "Superadmin",
  "Admin",
  "HR_Admin",
  "HR_Recruitment",
  "Training_Manager",
  "Sales",
  "Sales_Manager",
  "Onground_Agent_Manager",
  "Inventory_Receiver",
  "Promoter",
  "Field_Agent",
  "Merchant",
  "Finance_Manager",
  "Accountant",
  "Finance_Viewer",
  "Supervisor",
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
  if (role === "onground_agent_manager") return "Onground_Agent_Manager";
  if (role === "inventory_receiver") return "Inventory_Receiver";
  if (role === "promoter") return "Promoter";
  if (role === "field_agent") return "Field_Agent";
  if (role === "merchant") return "Merchant";
  if (role === "finance_manager") return "Finance_Manager";
  if (role === "accountant") return "Accountant";
  if (role === "finance_viewer") return "Finance_Viewer";
  if (role === "supervisor") return "Supervisor";
  if (role === "account_manager") return "Account_Manager";
  if (role === "employee") return "Employee";
  return null;
}

export function getDefaultPathForRole(role: Role): string {
  if (role === "Superadmin") return "/superadmin";
  if (role === "HR_Recruitment") return "/recruitment";
  if (role === "Sales") return "/sales/dashboard";
  if (role === "Sales_Manager") return "/sales/dashboard";
  if (role === "Onground_Agent_Manager") return "/sales/agents";
  if (role === "Inventory_Receiver") return "/notifications";
  if (role === "Promoter") return "/promoter";
  if (role === "Field_Agent") return "/agent";
  if (role === "Merchant") return "/merchant";
  if (role === "Supervisor") return "/supervisor";
  if (role === "Account_Manager") return "/chat";
  if (["Finance_Manager", "Accountant", "Finance_Viewer"].includes(role)) return "/accounting";
  return "/";
}

export function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/api/health" ||
    pathname === "/api/ready" ||
    pathname === "/api/internal/outbox" ||
    pathname === "/api/internal/compliance" ||
    pathname === "/api/internal/file-retention" ||
    pathname.startsWith("/api/auth/") ||
    pathname === "/login" ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password" ||
    pathname === "/suspended" ||
    pathname.startsWith("/ocr/tesseract/") ||
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
    return !["HR_Recruitment", "Sales", "Sales_Manager", "Onground_Agent_Manager", "Inventory_Receiver", "Promoter", "Field_Agent", "Merchant", "Supervisor", "Finance_Manager", "Accountant", "Finance_Viewer", "Account_Manager"].includes(role);
  }

  if (role === "Inventory_Receiver") {
    return (
      normalizedPath.startsWith("/notifications") ||
      normalizedPath.startsWith("/settings")
    );
  }

  if (role === "Onground_Agent_Manager") {
    return (
      normalizedPath.startsWith("/sales/agents") ||
      normalizedPath.startsWith("/sales/stock") ||
      normalizedPath.startsWith("/sales/inventory") ||
      normalizedPath.startsWith("/sales/traders") ||
      normalizedPath.startsWith("/sales/trader-sales") ||
      normalizedPath.startsWith("/api/sales/agents") ||
      normalizedPath.startsWith("/api/sales/merchants") ||
      normalizedPath.startsWith("/api/sales/inventory") ||
      normalizedPath.startsWith("/notifications") ||
      normalizedPath.startsWith("/settings")
    );
  }

  if (role === "Promoter") {
    return (
      normalizedPath.startsWith("/promoter") ||
      normalizedPath.startsWith("/attendance") ||
      normalizedPath.startsWith("/api/attendance") ||
      normalizedPath.startsWith("/sales/leads") ||
      normalizedPath.startsWith("/api/sales/promoter") ||
      normalizedPath.startsWith("/notifications") ||
      normalizedPath.startsWith("/settings")
    );
  }

  if (role === "Field_Agent") {
    const productInventoryAgentApi =
      normalizedPath.startsWith("/api/sales/inventory/me") ||
      normalizedPath.startsWith("/api/sales/inventory/handovers/") ||
      normalizedPath.startsWith("/api/sales/inventory/returns") ||
      normalizedPath.startsWith("/api/sales/inventory/agent-sales") ||
      normalizedPath.startsWith("/api/sales/inventory/price-overrides");
    return (
      normalizedPath.startsWith("/agent") ||
      normalizedPath.startsWith("/api/sales/agents") ||
      normalizedPath.startsWith("/api/sales/merchants") ||
      productInventoryAgentApi ||
      normalizedPath.startsWith("/attendance") ||
      normalizedPath.startsWith("/api/attendance") ||
      normalizedPath.startsWith("/notifications") ||
      normalizedPath.startsWith("/settings")
    );
  }

  if (role === "Supervisor") {
    return (
      normalizedPath.startsWith("/supervisor") ||
      normalizedPath.startsWith("/api/supervisor") ||
      normalizedPath.startsWith("/attendance") ||
      normalizedPath.startsWith("/api/attendance") ||
      normalizedPath.startsWith("/tasks") ||
      normalizedPath.startsWith("/api/tasks") ||
      normalizedPath.startsWith("/leave") ||
      normalizedPath.startsWith("/api/leave") ||
      normalizedPath.startsWith("/notifications") ||
      normalizedPath.startsWith("/settings") ||
      normalizedPath.startsWith("/chat") ||
      normalizedPath.startsWith("/api/chat")
    );
  }

  if (role === "Account_Manager") {
    return (
      normalizedPath.startsWith("/chat") ||
      normalizedPath.startsWith("/api/chat") ||
      normalizedPath.startsWith("/notifications") ||
      normalizedPath.startsWith("/settings")
    );
  }

  if (role === "Merchant") {
    return (
      normalizedPath.startsWith("/merchant") ||
      normalizedPath.startsWith("/api/sales/merchants") ||
      normalizedPath.startsWith("/notifications") ||
      normalizedPath.startsWith("/settings")
    );
  }

  if (["Finance_Manager", "Accountant", "Finance_Viewer"].includes(role)) {
    if (
      role === "Finance_Manager"
      && (
        normalizedPath.startsWith("/sales/inventory")
        || normalizedPath.startsWith("/api/sales/inventory")
      )
    ) {
      return true;
    }
    if (normalizedPath.startsWith("/accounting/settings")) {
      return role === "Finance_Manager";
    }
    if (normalizedPath.startsWith("/accounting/team")) {
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
      normalizedPath.startsWith("/lms") ||
      normalizedPath.startsWith("/api/lms") ||
      normalizedPath.startsWith("/learn") ||
      normalizedPath.startsWith("/api/learn") ||
      normalizedPath.startsWith("/payroll") ||
      normalizedPath.startsWith("/balances") ||
      normalizedPath.startsWith("/api/advance-requests") ||
      normalizedPath.startsWith("/notifications") ||
      normalizedPath.startsWith("/settings") ||
      normalizedPath.startsWith("/chat") ||
      normalizedPath.startsWith("/api/chat")
    );
  }

  if (normalizedPath.startsWith("/api/supervisor/evaluations") && normalizedPath.includes("/review")) {
    return ["Admin", "HR_Admin"].includes(role);
  }

  if (normalizedPath.startsWith("/evaluations")) {
    return ["Admin", "HR_Admin"].includes(role);
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
    if (normalizedPath.startsWith("/api/sales/inventory")) {
      return ["Admin", "Sales_Manager", "Onground_Agent_Manager", "Inventory_Receiver"].includes(role);
    }
    if (normalizedPath.startsWith("/api/sales/agents")) {
      return ["Admin", "Sales_Manager", "Onground_Agent_Manager", "Field_Agent"].includes(role);
    }
    if (normalizedPath.startsWith("/api/sales/merchants")) {
      return ["Admin", "Sales_Manager", "Onground_Agent_Manager", "Field_Agent", "Merchant"].includes(role);
    }
    if (normalizedPath.startsWith("/api/sales/promoter") || normalizedPath.startsWith("/api/sales/leads")) {
      return ["Admin", "HR_Admin", "Sales", "Sales_Manager", "Promoter"].includes(role);
    }
    return ["Admin", "HR_Admin", "Sales", "Sales_Manager"].includes(role);
  }

  if (normalizedPath.startsWith("/api/accounting")) {
    return ["Admin", "HR_Admin", "Sales_Manager", "Finance_Manager", "Accountant", "Finance_Viewer"].includes(role);
  }

  if (normalizedPath.startsWith("/api/lms")) {
    return ALL_ROLES.includes(role);
  }

  if (normalizedPath.startsWith("/api/learn")) {
    return ALL_ROLES.includes(role);
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
    if (normalizedPath.startsWith("/sales/inventory")) {
      return ["Sales_Manager", "Admin", "Onground_Agent_Manager", "Inventory_Receiver"].includes(role);
    }
    if (
      normalizedPath.startsWith("/sales/agents") ||
      normalizedPath.startsWith("/sales/stock") ||
      normalizedPath.startsWith("/sales/traders") ||
      normalizedPath.startsWith("/sales/trader-sales")
    ) {
      return ["Sales_Manager", "Admin", "Onground_Agent_Manager"].includes(role);
    }
    if (normalizedPath.startsWith("/sales/leads")) {
      return ["Promoter", "Sales", "Sales_Manager", "Admin", "HR_Admin"].includes(role);
    }
    if (normalizedPath.startsWith("/sales/promoter")) {
      return ["Sales_Manager", "Admin", "HR_Admin"].includes(role);
    }
    return ["Sales_Manager", "Admin", "HR_Admin"].includes(role);
  }

  if (normalizedPath.startsWith("/accounting/reports")) {
    return ["Finance_Manager", "Accountant", "Finance_Viewer"].includes(role);
  }

  if (normalizedPath.startsWith("/accounting/team")) {
    return ["Admin", "HR_Admin", "Finance_Manager"].includes(role);
  }

  if (normalizedPath.startsWith("/accounting")) {
    return ["Finance_Manager", "Accountant", "Finance_Viewer"].includes(role);
  }

  if (normalizedPath.startsWith("/lms")) {
    return ALL_ROLES.includes(role);
  }

  if (normalizedPath.startsWith("/learn")) {
    return ALL_ROLES.includes(role);
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
