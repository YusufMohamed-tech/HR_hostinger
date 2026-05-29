import type { Role } from "@/types";

export type OrgRole =
  | "super_admin"
  | "admin"
  | "employee"
  | "hr_admin"
  | "hr_recruitment"
  | "training_manager";

export const ALL_ROLES: Role[] = [
  "Superadmin",
  "Admin",
  "HR_Admin",
  "HR_Recruitment",
  "Training_Manager",
  "Employee",
];

export function roleFromOrgRole(role: string | null | undefined): Role | null {
  if (role === "super_admin") return "Superadmin";
  if (role === "admin") return "Admin";
  if (role === "hr_admin") return "HR_Admin";
  if (role === "hr_recruitment") return "HR_Recruitment";
  if (role === "training_manager") return "Training_Manager";
  if (role === "employee") return "Employee";
  return null;
}

export function getDefaultPathForRole(role: Role): string {
  if (role === "Superadmin") return "/superadmin";
  if (role === "HR_Recruitment") return "/recruitment";
  return "/";
}

export function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname === "/suspended" ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/apply/") ||
    pathname === "/candidate/applications"
  );
}

export function isCandidatePath(pathname: string): boolean {
  return pathname.startsWith("/apply/") || pathname === "/candidate/applications";
}

export function canAccessPath(role: Role, pathname: string): boolean {
  const normalizedPath = normalizePath(pathname);

  if (role === "Superadmin") {
    return normalizedPath.startsWith("/superadmin") || normalizedPath.startsWith("/api/superadmin");
  }

  if (normalizedPath.startsWith("/superadmin") || normalizedPath.startsWith("/api/superadmin")) {
    return false;
  }

  if (normalizedPath === "/") {
    return role !== "HR_Recruitment";
  }

  if (normalizedPath.startsWith("/api/hr")) {
    return ["Admin", "HR_Admin"].includes(role);
  }

  if (normalizedPath.startsWith("/recruitment")) {
    return ["Admin", "HR_Recruitment"].includes(role);
  }

  if (
    normalizedPath.startsWith("/employees") ||
    normalizedPath.startsWith("/departments") ||
    normalizedPath.startsWith("/personnel") ||
    normalizedPath.startsWith("/payroll")
  ) {
    return ["Admin", "HR_Admin"].includes(role);
  }

  if (normalizedPath.startsWith("/balances") || normalizedPath.startsWith("/assets")) {
    return ["Admin", "HR_Admin", "Employee"].includes(role);
  }

  if (
    normalizedPath.startsWith("/attendance") ||
    normalizedPath.startsWith("/tasks") ||
    normalizedPath.startsWith("/leave") ||
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
