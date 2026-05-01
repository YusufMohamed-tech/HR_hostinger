/**
 * Supabase Database Types — manually defined to match db/schema.sql
 * In production, regenerate with: npx supabase gen types typescript --project-id yccgilxenflqqtzsehih
 */

export type OrgRole = "super_admin" | "admin" | "team_leader" | "employee";

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string;
          name: string;
          slug: string | null;
          plan: string;
          status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug?: string | null;
          plan?: string;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string | null;
          plan?: string;
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
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          org_id?: string | null;
          full_name?: string | null;
          email?: string | null;
          phone?: string | null;
          title?: string | null;
          updated_at?: string;
        };
      };
      departments: {
        Row: {
          id: string;
          org_id: string;
          name: string;
          head_employee_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          name: string;
          head_employee_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          name?: string;
          head_employee_id?: string | null;
          updated_at?: string;
        };
      };
      locations: {
        Row: {
          id: string;
          org_id: string;
          name: string;
          city: string | null;
          geofence: Record<string, unknown> | null;
          geofence_status: string;
          latitude: number | null;
          longitude: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          name: string;
          city?: string | null;
          geofence?: Record<string, unknown> | null;
          geofence_status?: string;
          latitude?: number | null;
          longitude?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          name?: string;
          city?: string | null;
          geofence?: Record<string, unknown> | null;
          geofence_status?: string;
          latitude?: number | null;
          longitude?: number | null;
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
          role: string | null;
          status: string;
          department_id: string | null;
          location_id: string | null;
          manager_id: string | null;
          hire_date: string | null;
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
          role?: string | null;
          status?: string;
          department_id?: string | null;
          location_id?: string | null;
          manager_id?: string | null;
          hire_date?: string | null;
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
          role?: string | null;
          status?: string;
          department_id?: string | null;
          location_id?: string | null;
          manager_id?: string | null;
          hire_date?: string | null;
          updated_at?: string;
        };
      };
      contracts: {
        Row: {
          id: string;
          org_id: string;
          employee_id: string;
          start_date: string;
          end_date: string | null;
          base_salary: number | null;
          currency: string;
          status: string;
          terms: Record<string, unknown> | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          employee_id: string;
          start_date: string;
          end_date?: string | null;
          base_salary?: number | null;
          currency?: string;
          status?: string;
          terms?: Record<string, unknown> | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          employee_id?: string;
          start_date?: string;
          end_date?: string | null;
          base_salary?: number | null;
          currency?: string;
          status?: string;
          terms?: Record<string, unknown> | null;
          updated_at?: string;
        };
      };
      shifts: {
        Row: {
          id: string;
          org_id: string;
          location_id: string | null;
          shift_date: string | null;
          start_time: string | null;
          end_time: string | null;
          required_headcount: number;
          status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          location_id?: string | null;
          shift_date?: string | null;
          start_time?: string | null;
          end_time?: string | null;
          required_headcount?: number;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          location_id?: string | null;
          shift_date?: string | null;
          start_time?: string | null;
          end_time?: string | null;
          required_headcount?: number;
          status?: string;
          updated_at?: string;
        };
      };
      shift_assignments: {
        Row: {
          id: string;
          org_id: string;
          shift_id: string;
          employee_id: string;
          status: string;
          assigned_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          shift_id: string;
          employee_id: string;
          status?: string;
          assigned_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          shift_id?: string;
          employee_id?: string;
          status?: string;
        };
      };
      events: {
        Row: {
          id: string;
          org_id: string;
          employee_id: string | null;
          user_id: string | null;
          event_type: string;
          payload: Record<string, unknown> | null;
          occurred_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          employee_id?: string | null;
          user_id?: string | null;
          event_type: string;
          payload?: Record<string, unknown> | null;
          occurred_at?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          employee_id?: string | null;
          user_id?: string | null;
          event_type?: string;
          payload?: Record<string, unknown> | null;
          occurred_at?: string;
        };
      };
      payroll_cycles: {
        Row: {
          id: string;
          org_id: string;
          name: string | null;
          period_start: string | null;
          period_end: string | null;
          status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          name?: string | null;
          period_start?: string | null;
          period_end?: string | null;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          name?: string | null;
          period_start?: string | null;
          period_end?: string | null;
          status?: string;
          updated_at?: string;
        };
      };
      payroll_items: {
        Row: {
          id: string;
          org_id: string;
          payroll_cycle_id: string;
          employee_id: string;
          base_salary: number;
          bonuses: number;
          deductions: number;
          total: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          payroll_cycle_id: string;
          employee_id: string;
          base_salary?: number;
          bonuses?: number;
          deductions?: number;
          total?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          payroll_cycle_id?: string;
          employee_id?: string;
          base_salary?: number;
          bonuses?: number;
          deductions?: number;
          total?: number;
        };
      };
      courses: {
        Row: {
          id: string;
          org_id: string;
          title: string;
          description: string | null;
          status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          title: string;
          description?: string | null;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          title?: string;
          description?: string | null;
          status?: string;
          updated_at?: string;
        };
      };
      enrollments: {
        Row: {
          id: string;
          org_id: string;
          course_id: string;
          employee_id: string;
          status: string;
          progress: number;
          due_date: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          course_id: string;
          employee_id: string;
          status?: string;
          progress?: number;
          due_date?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          course_id?: string;
          employee_id?: string;
          status?: string;
          progress?: number;
          due_date?: string | null;
          updated_at?: string;
        };
      };
      audit_logs: {
        Row: {
          id: string;
          org_id: string;
          actor_user_id: string | null;
          action: string;
          entity: string | null;
          entity_id: string | null;
          old_values: Record<string, unknown> | null;
          new_values: Record<string, unknown> | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          actor_user_id?: string | null;
          action: string;
          entity?: string | null;
          entity_id?: string | null;
          old_values?: Record<string, unknown> | null;
          new_values?: Record<string, unknown> | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          actor_user_id?: string | null;
          action?: string;
          entity?: string | null;
          entity_id?: string | null;
          old_values?: Record<string, unknown> | null;
          new_values?: Record<string, unknown> | null;
        };
      };
      ai_insights: {
        Row: {
          id: string;
          org_id: string;
          title: string;
          impact: string | null;
          summary: string | null;
          payload: Record<string, unknown> | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          title: string;
          impact?: string | null;
          summary?: string | null;
          payload?: Record<string, unknown> | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          title?: string;
          impact?: string | null;
          summary?: string | null;
          payload?: Record<string, unknown> | null;
        };
      };
      kpi_definitions: {
        Row: {
          id: string;
          org_id: string;
          name: string;
          description: string | null;
          unit: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          name: string;
          description?: string | null;
          unit?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          name?: string;
          description?: string | null;
          unit?: string | null;
        };
      };
      kpi_targets: {
        Row: {
          id: string;
          org_id: string;
          kpi_id: string;
          target_value: number | null;
          period_start: string | null;
          period_end: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          kpi_id: string;
          target_value?: number | null;
          period_start?: string | null;
          period_end?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          kpi_id?: string;
          target_value?: number | null;
          period_start?: string | null;
          period_end?: string | null;
        };
      };
      kpi_results: {
        Row: {
          id: string;
          org_id: string;
          kpi_id: string;
          employee_id: string | null;
          department_id: string | null;
          value: number | null;
          measured_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          kpi_id: string;
          employee_id?: string | null;
          department_id?: string | null;
          value?: number | null;
          measured_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          kpi_id?: string;
          employee_id?: string | null;
          department_id?: string | null;
          value?: number | null;
          measured_at?: string;
        };
      };
    };
    Functions: {
      current_org_id: { Returns: string };
      current_role: { Returns: string };
      is_super_admin: { Returns: boolean };
      is_org_admin: { Args: { org: string }; Returns: boolean };
    };
  };
}

/** Shorthand for table row types */
export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export type InsertTables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];
export type UpdateTables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];
