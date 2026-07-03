export type Role =
  | "Superadmin"
  | "Admin"
  | "Employee"
  | "HR_Admin"
  | "HR_Recruitment"
  | "Training_Manager"
  | "Sales"
  | "Sales_Manager"
  | "Promoter"
  | "Finance_Manager"
  | "Accountant"
  | "Finance_Viewer";
export type SystemRole = "Superadmin" | null;
export type WorkspaceRole = Exclude<Role, "Superadmin">;
export type OrgMembershipRole =
  | "super_admin"
  | "admin"
  | "employee"
  | "hr_admin"
  | "hr_recruitment"
  | "training_manager"
  | "sales"
  | "sales_manager"
  | "promoter"
  | "finance_manager"
  | "accountant"
  | "finance_viewer"
  | null;

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  systemRole: SystemRole;
  workspaceRole: WorkspaceRole | null;
  orgMembershipRole: OrgMembershipRole;
  orgId: string;
  employeeId?: string;
  avatarUrl?: string;
}

export interface ActivityEvent {
  id: string;
  userId: string;
  type: "CHECK_IN" | "CHECK_OUT" | "TASK_COMPLETED" | "LOCATION_CHANGE";
  timestamp: string;
  details?: string;
}
