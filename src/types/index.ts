export type Role = "Superadmin" | "Admin" | "Employee" | "HR_Admin" | "HR_Recruitment" | "Training_Manager";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
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
