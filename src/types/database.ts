/**
 * Supabase Database Types — Phase 1 Core Workforce OS
 */

export type OrgRole = "admin" | "employee";
export type EmploymentType = "full_time" | "part_time" | "intern" | "contract";
export type AttendanceStatus = "present" | "late" | "absent" | "on_leave" | "half_day";
export type TaskStatus = "pending" | "in_progress" | "completed" | "rejected" | "delayed";
export type LeaveType = "sick" | "vacation" | "emergency";
export type LeaveStatus = "pending" | "approved" | "rejected";
export type ShiftType = "morning" | "night" | "flexible";
export type NotificationType = "attendance" | "task" | "leave" | "system";
export type DocumentType = "cv" | "contract" | "national_id" | "certificate" | "other";
export type LocationType = "branch" | "booth" | "office" | "area";

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string;
          name: string;
          slug: string | null;
          status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug?: string | null;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string | null;
          status?: string;
          updated_at?: string;
        };
      };
      org_members: {
        Row: {
          id: string;
          org_id: string;
          user_id: string;
          role: OrgRole;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          user_id: string;
          role?: OrgRole;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          user_id?: string;
          role?: OrgRole;
        };
      };
      profiles: {
        Row: {
          user_id: string;
          org_id: string | null;
          full_name: string | null;
          email: string | null;
          phone: string | null;
          title: string | null;
          username: string | null;
          account_status: string | null;
          last_login_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          org_id?: string | null;
          full_name?: string | null;
          email?: string | null;
          phone?: string | null;
          title?: string | null;
          username?: string | null;
          account_status?: string | null;
          last_login_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          org_id?: string | null;
          full_name?: string | null;
          email?: string | null;
          phone?: string | null;
          title?: string | null;
          username?: string | null;
          account_status?: string | null;
          last_login_at?: string | null;
          updated_at?: string;
        };
      };
      departments: {
        Row: {
          id: string;
          org_id: string;
          name: string;
          manager_employee_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          name: string;
          manager_employee_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          name?: string;
          manager_employee_id?: string | null;
          updated_at?: string;
        };
      };
      locations: {
        Row: {
          id: string;
          org_id: string;
          name: string;
          type: LocationType;
          latitude: number | null;
          longitude: number | null;
          radius_meters: number | null;
          manager_employee_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          name: string;
          type?: LocationType;
          latitude?: number | null;
          longitude?: number | null;
          radius_meters?: number | null;
          manager_employee_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          name?: string;
          type?: LocationType;
          latitude?: number | null;
          longitude?: number | null;
          radius_meters?: number | null;
          manager_employee_id?: string | null;
          updated_at?: string;
        };
      };
      employees: {
        Row: {
          id: string;
          org_id: string;
          user_id: string | null;
          employee_code: string | null;
          full_name: string;
          email: string | null;
          phone: string | null;
          address: string | null;
          emergency_contact_name: string | null;
          emergency_contact_phone: string | null;
          national_id: string | null;
          date_of_birth: string | null;
          gender: string | null;
          hiring_date: string | null;
          department_id: string | null;
          job_title: string | null;
          manager_id: string | null;
          location_id: string | null;
          employment_type: EmploymentType | null;
          status: string;
          base_salary: number | null;
          bonus: number | null;
          deductions: number | null;
          payment_method: string | null;
          bank_account: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          user_id?: string | null;
          employee_code?: string | null;
          full_name: string;
          email?: string | null;
          phone?: string | null;
          address?: string | null;
          emergency_contact_name?: string | null;
          emergency_contact_phone?: string | null;
          national_id?: string | null;
          date_of_birth?: string | null;
          gender?: string | null;
          hiring_date?: string | null;
          department_id?: string | null;
          job_title?: string | null;
          manager_id?: string | null;
          location_id?: string | null;
          employment_type?: EmploymentType | null;
          status?: string;
          base_salary?: number | null;
          bonus?: number | null;
          deductions?: number | null;
          payment_method?: string | null;
          bank_account?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          user_id?: string | null;
          employee_code?: string | null;
          full_name?: string;
          email?: string | null;
          phone?: string | null;
          address?: string | null;
          emergency_contact_name?: string | null;
          emergency_contact_phone?: string | null;
          national_id?: string | null;
          date_of_birth?: string | null;
          gender?: string | null;
          hiring_date?: string | null;
          department_id?: string | null;
          job_title?: string | null;
          manager_id?: string | null;
          location_id?: string | null;
          employment_type?: EmploymentType | null;
          status?: string;
          base_salary?: number | null;
          bonus?: number | null;
          deductions?: number | null;
          payment_method?: string | null;
          bank_account?: string | null;
          updated_at?: string;
        };
      };
      employee_documents: {
        Row: {
          id: string;
          org_id: string;
          employee_id: string;
          doc_type: DocumentType;
          file_path: string;
          file_name: string | null;
          uploaded_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          employee_id: string;
          doc_type?: DocumentType;
          file_path: string;
          file_name?: string | null;
          uploaded_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          employee_id?: string;
          doc_type?: DocumentType;
          file_path?: string;
          file_name?: string | null;
          uploaded_by?: string | null;
        };
      };
      salary_history: {
        Row: {
          id: string;
          org_id: string;
          employee_id: string;
          base_salary: number | null;
          bonus: number | null;
          deductions: number | null;
          payment_method: string | null;
          bank_account: string | null;
          effective_date: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          employee_id: string;
          base_salary?: number | null;
          bonus?: number | null;
          deductions?: number | null;
          payment_method?: string | null;
          bank_account?: string | null;
          effective_date?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          employee_id?: string;
          base_salary?: number | null;
          bonus?: number | null;
          deductions?: number | null;
          payment_method?: string | null;
          bank_account?: string | null;
          effective_date?: string;
        };
      };
      employee_kpis: {
        Row: {
          id: string;
          org_id: string;
          employee_id: string;
          kpi_name: string;
          value: number | null;
          recorded_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          employee_id: string;
          kpi_name: string;
          value?: number | null;
          recorded_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          employee_id?: string;
          kpi_name?: string;
          value?: number | null;
          recorded_at?: string;
        };
      };
      employee_reviews: {
        Row: {
          id: string;
          org_id: string;
          employee_id: string;
          review_month: string | null;
          rating: number | null;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          employee_id: string;
          review_month?: string | null;
          rating?: number | null;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          employee_id?: string;
          review_month?: string | null;
          rating?: number | null;
          notes?: string | null;
        };
      };
      employee_actions: {
        Row: {
          id: string;
          org_id: string;
          employee_id: string;
          action_type: string;
          reason: string | null;
          points: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          employee_id: string;
          action_type: string;
          reason?: string | null;
          points?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          employee_id?: string;
          action_type?: string;
          reason?: string | null;
          points?: number | null;
        };
      };
      shifts: {
        Row: {
          id: string;
          org_id: string;
          name: string;
          shift_type: ShiftType;
          start_time: string | null;
          end_time: string | null;
          location_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          name: string;
          shift_type?: ShiftType;
          start_time?: string | null;
          end_time?: string | null;
          location_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          name?: string;
          shift_type?: ShiftType;
          start_time?: string | null;
          end_time?: string | null;
          location_id?: string | null;
          updated_at?: string;
        };
      };
      employee_shifts: {
        Row: {
          id: string;
          org_id: string;
          employee_id: string;
          shift_id: string;
          start_date: string | null;
          end_date: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          employee_id: string;
          shift_id: string;
          start_date?: string | null;
          end_date?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          employee_id?: string;
          shift_id?: string;
          start_date?: string | null;
          end_date?: string | null;
        };
      };
      attendance_records: {
        Row: {
          id: string;
          org_id: string;
          employee_id: string;
          work_date: string;
          shift_id: string | null;
          check_in_at: string | null;
          check_out_at: string | null;
          check_in_lat: number | null;
          check_in_lng: number | null;
          check_out_lat: number | null;
          check_out_lng: number | null;
          check_in_device: string | null;
          check_out_device: string | null;
          check_in_photo_path: string | null;
          status: AttendanceStatus | null;
          total_minutes: number | null;
          late_minutes: number | null;
          within_geofence: boolean | null;
          distance_meters: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          employee_id: string;
          work_date?: string;
          shift_id?: string | null;
          check_in_at?: string | null;
          check_out_at?: string | null;
          check_in_lat?: number | null;
          check_in_lng?: number | null;
          check_out_lat?: number | null;
          check_out_lng?: number | null;
          check_in_device?: string | null;
          check_out_device?: string | null;
          check_in_photo_path?: string | null;
          status?: AttendanceStatus | null;
          total_minutes?: number | null;
          late_minutes?: number | null;
          within_geofence?: boolean | null;
          distance_meters?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          employee_id?: string;
          work_date?: string;
          shift_id?: string | null;
          check_in_at?: string | null;
          check_out_at?: string | null;
          check_in_lat?: number | null;
          check_in_lng?: number | null;
          check_out_lat?: number | null;
          check_out_lng?: number | null;
          check_in_device?: string | null;
          check_out_device?: string | null;
          check_in_photo_path?: string | null;
          status?: AttendanceStatus | null;
          total_minutes?: number | null;
          late_minutes?: number | null;
          within_geofence?: boolean | null;
          distance_meters?: number | null;
          updated_at?: string;
        };
      };
      tasks: {
        Row: {
          id: string;
          org_id: string;
          title: string;
          description: string | null;
          priority: string | null;
          status: TaskStatus;
          due_date: string | null;
          location_id: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          title: string;
          description?: string | null;
          priority?: string | null;
          status?: TaskStatus;
          due_date?: string | null;
          location_id?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          title?: string;
          description?: string | null;
          priority?: string | null;
          status?: TaskStatus;
          due_date?: string | null;
          location_id?: string | null;
          created_by?: string | null;
          updated_at?: string;
        };
      };
      task_assignments: {
        Row: {
          id: string;
          org_id: string;
          task_id: string;
          employee_id: string;
          status: TaskStatus;
          assigned_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          task_id: string;
          employee_id: string;
          status?: TaskStatus;
          assigned_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          task_id?: string;
          employee_id?: string;
          status?: TaskStatus;
        };
      };
      task_updates: {
        Row: {
          id: string;
          org_id: string;
          task_id: string;
          employee_id: string | null;
          status: TaskStatus | null;
          progress: number | null;
          note: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          task_id: string;
          employee_id?: string | null;
          status?: TaskStatus | null;
          progress?: number | null;
          note?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          task_id?: string;
          employee_id?: string | null;
          status?: TaskStatus | null;
          progress?: number | null;
          note?: string | null;
        };
      };
      task_attachments: {
        Row: {
          id: string;
          org_id: string;
          task_id: string;
          uploaded_by: string | null;
          file_path: string;
          file_name: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          task_id: string;
          uploaded_by?: string | null;
          file_path: string;
          file_name?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          task_id?: string;
          uploaded_by?: string | null;
          file_path?: string;
          file_name?: string | null;
        };
      };
      leave_balances: {
        Row: {
          id: string;
          org_id: string;
          employee_id: string;
          sick_remaining: number | null;
          vacation_remaining: number | null;
          emergency_remaining: number | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          employee_id: string;
          sick_remaining?: number | null;
          vacation_remaining?: number | null;
          emergency_remaining?: number | null;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          employee_id?: string;
          sick_remaining?: number | null;
          vacation_remaining?: number | null;
          emergency_remaining?: number | null;
          updated_at?: string;
        };
      };
      leave_requests: {
        Row: {
          id: string;
          org_id: string;
          employee_id: string;
          leave_type: LeaveType;
          status: LeaveStatus;
          start_date: string;
          end_date: string;
          reason: string | null;
          requested_at: string;
          decided_at: string | null;
          decided_by: string | null;
          decision_note: string | null;
        };
        Insert: {
          id?: string;
          org_id: string;
          employee_id: string;
          leave_type: LeaveType;
          status?: LeaveStatus;
          start_date: string;
          end_date: string;
          reason?: string | null;
          requested_at?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          decision_note?: string | null;
        };
        Update: {
          id?: string;
          org_id?: string;
          employee_id?: string;
          leave_type?: LeaveType;
          status?: LeaveStatus;
          start_date?: string;
          end_date?: string;
          reason?: string | null;
          requested_at?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          decision_note?: string | null;
        };
      };
      notifications: {
        Row: {
          id: string;
          org_id: string;
          user_id: string;
          title: string;
          body: string | null;
          type: NotificationType;
          link: string | null;
          is_read: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          user_id: string;
          title: string;
          body?: string | null;
          type?: NotificationType;
          link?: string | null;
          is_read?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          user_id?: string;
          title?: string;
          body?: string | null;
          type?: NotificationType;
          link?: string | null;
          is_read?: boolean;
        };
      };
    };
  };
}
