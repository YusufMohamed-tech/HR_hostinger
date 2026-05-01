export type Role = "Super Admin" | "Admin" | "Team Leader" | "Employee";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  orgId: string;
  avatarUrl?: string;
}

export interface ActivityEvent {
  id: string;
  userId: string;
  type: "CHECK_IN" | "CHECK_OUT" | "TASK_COMPLETED" | "LOCATION_CHANGE";
  timestamp: string;
  details?: string;
}
