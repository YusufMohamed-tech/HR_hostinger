/**
 * Supabase Database Types — Phase 1 Core Workforce OS
 */

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
  | "finance_viewer";
export type EmploymentType = "full_time" | "part_time" | "intern" | "contract";
export type AttendanceStatus = "present" | "late" | "absent" | "on_leave" | "half_day";
export type TaskStatus = "pending" | "in_progress" | "completed" | "rejected" | "delayed";
export type LeaveType = "sick" | "vacation" | "emergency" | "unpaid" | "weekly" | "marriage" | "bereavement";
export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";
export type ShiftType = "morning" | "night" | "flexible";
export type NotificationType = "attendance" | "task" | "leave" | "system" | "sales" | "accounting" | "recruitment" | "lms";
export type DocumentType = "cv" | "contract" | "national_id" | "certificate" | "other";
export type LocationType = "branch" | "booth" | "office" | "area";
export type BusinessEventStatus = "pending" | "processing" | "completed" | "failed" | "dead_letter";
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      schema_migrations: {
        Row: {
          id: string;
          file_path: string;
          checksum_sha256: string;
          applied_at: string;
          applied_by: string;
          execution_ms: number;
        };
        Insert: {
          id: string;
          file_path: string;
          checksum_sha256: string;
          applied_at?: string;
          applied_by: string;
          execution_ms?: number;
        };
        Update: Record<string, never>;
      };
      platform_admins: {
        Row: {
          id: string;
          user_id: string;
          role: "superadmin";
          status: "active" | "suspended";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          role?: "superadmin";
          status?: "active" | "suspended";
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          role?: "superadmin";
          status?: "active" | "suspended";
          updated_at?: string;
        };
      };
      platform_audit_logs: {
        Row: {
          id: string;
          actor_user_id: string | null;
          actor_role: string;
          action: string;
          target_org_id: string | null;
          target_user_id: string | null;
          target_type: string | null;
          target_id: string | null;
          metadata: Record<string, unknown>;
          created_at: string;
        };
        Insert: {
          id?: string;
          actor_user_id?: string | null;
          actor_role?: string;
          action: string;
          target_org_id?: string | null;
          target_user_id?: string | null;
          target_type?: string | null;
          target_id?: string | null;
          metadata?: Record<string, unknown>;
          created_at?: string;
        };
        Update: {
          id?: string;
          actor_user_id?: string | null;
          actor_role?: string;
          action?: string;
          target_org_id?: string | null;
          target_user_id?: string | null;
          target_type?: string | null;
          target_id?: string | null;
          metadata?: Record<string, unknown>;
        };
      };
      business_events: {
        Row: {
          id: string;
          org_id: string;
          source_type: string;
          business_key: string;
          event_version: number;
          payload: Json;
          payload_hash: string;
          status: BusinessEventStatus;
          attempts: number;
          request_id: string | null;
          correlation_id: string | null;
          actor_user_id: string | null;
          last_error: string | null;
          occurred_at: string;
          processing_started_at: string | null;
          processed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          source_type: string;
          business_key: string;
          event_version?: number;
          payload?: Json;
          payload_hash: string;
          status?: BusinessEventStatus;
          attempts?: number;
          request_id?: string | null;
          correlation_id?: string | null;
          actor_user_id?: string | null;
          last_error?: string | null;
          occurred_at?: string;
          processing_started_at?: string | null;
          processed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          status?: BusinessEventStatus;
          attempts?: number;
          last_error?: string | null;
          processing_started_at?: string | null;
          processed_at?: string | null;
          updated_at?: string;
        };
      };
      event_outbox: {
        Row: {
          id: string;
          org_id: string;
          business_event_id: string;
          topic: string;
          payload: Json;
          payload_hash: string;
          status: BusinessEventStatus;
          attempts: number;
          available_at: string;
          locked_at: string | null;
          locked_by: string | null;
          last_error: string | null;
          sent_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          business_event_id: string;
          topic: string;
          payload?: Json;
          payload_hash: string;
          status?: BusinessEventStatus;
          attempts?: number;
          available_at?: string;
          locked_at?: string | null;
          locked_by?: string | null;
          last_error?: string | null;
          sent_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          status?: BusinessEventStatus;
          attempts?: number;
          available_at?: string;
          locked_at?: string | null;
          locked_by?: string | null;
          last_error?: string | null;
          sent_at?: string | null;
          updated_at?: string;
        };
      };
      operational_audit_logs: {
        Row: {
          id: string;
          org_id: string | null;
          request_id: string;
          correlation_id: string | null;
          actor_user_id: string | null;
          actor_role: string | null;
          action: string;
          target_type: string | null;
          target_id: string | null;
          outcome: "success" | "denied" | "failed";
          status_code: number | null;
          duration_ms: number | null;
          error_code: string | null;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id?: string | null;
          request_id: string;
          correlation_id?: string | null;
          actor_user_id?: string | null;
          actor_role?: string | null;
          action: string;
          target_type?: string | null;
          target_id?: string | null;
          outcome: "success" | "denied" | "failed";
          status_code?: number | null;
          duration_ms?: number | null;
          error_code?: string | null;
          metadata?: Json;
          created_at?: string;
        };
        Update: Record<string, never>;
      };
      plans: {
        Row: {
          code: string;
          name: string;
          description: string | null;
          features: Json;
          limits: Json;
          price_monthly: number;
          price_yearly: number;
          currency: string;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          code: string;
          name: string;
          description?: string | null;
          features?: Json;
          limits?: Json;
          price_monthly?: number;
          price_yearly?: number;
          currency?: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          description?: string | null;
          features?: Json;
          limits?: Json;
          price_monthly?: number;
          price_yearly?: number;
          currency?: string;
          is_active?: boolean;
          updated_at?: string;
        };
      };
      organizations: {
        Row: {
          id: string;
          name: string;
          slug: string | null;
          status: string;
          deleted_at: string | null;
          deletion_requested_at: string | null;
          deletion_requested_by: string | null;
          deletion_reason: string | null;
          data_export_requested_at: string | null;
          data_export_path: string | null;
          version: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug?: string | null;
          status?: string;
          deleted_at?: string | null;
          deletion_requested_at?: string | null;
          deletion_requested_by?: string | null;
          deletion_reason?: string | null;
          data_export_requested_at?: string | null;
          data_export_path?: string | null;
          version?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string | null;
          status?: string;
          deleted_at?: string | null;
          deletion_requested_at?: string | null;
          deletion_requested_by?: string | null;
          deletion_reason?: string | null;
          data_export_requested_at?: string | null;
          data_export_path?: string | null;
          version?: number;
          updated_at?: string;
        };
      };
      organization_settings: {
        Row: {
          org_id: string;
          brand_name: string | null;
          tagline: string | null;
          primary_color: string;
          locale: string;
          timezone: string;
          attendance_default_radius_meters: number;
          allow_out_of_geofence_checkin: boolean;
          leave_defaults: Json;
          approval_workflows: Json;
          shift_rules: Json;
          chat_retention_days: number;
          version: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          org_id: string;
          brand_name?: string | null;
          tagline?: string | null;
          primary_color?: string;
          locale?: string;
          timezone?: string;
          attendance_default_radius_meters?: number;
          allow_out_of_geofence_checkin?: boolean;
          leave_defaults?: Json;
          approval_workflows?: Json;
          shift_rules?: Json;
          chat_retention_days?: number;
          version?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          brand_name?: string | null;
          tagline?: string | null;
          primary_color?: string;
          locale?: string;
          timezone?: string;
          attendance_default_radius_meters?: number;
          allow_out_of_geofence_checkin?: boolean;
          leave_defaults?: Json;
          approval_workflows?: Json;
          shift_rules?: Json;
          chat_retention_days?: number;
          version?: number;
          updated_at?: string;
        };
      };
      organization_features: {
        Row: {
          org_id: string;
          plan_code: string | null;
          hr_enabled: boolean;
          sales_enabled: boolean;
          recruitment_enabled: boolean;
          accounting_enabled: boolean;
          chat_enabled: boolean;
          assets_enabled: boolean;
          payroll_enabled: boolean;
          personnel_enabled: boolean;
          lms_enabled: boolean;
          enabled_modules: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          org_id: string;
          plan_code?: string | null;
          hr_enabled?: boolean;
          sales_enabled?: boolean;
          recruitment_enabled?: boolean;
          accounting_enabled?: boolean;
          chat_enabled?: boolean;
          assets_enabled?: boolean;
          payroll_enabled?: boolean;
          personnel_enabled?: boolean;
          lms_enabled?: boolean;
          enabled_modules?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          plan_code?: string | null;
          hr_enabled?: boolean;
          sales_enabled?: boolean;
          recruitment_enabled?: boolean;
          accounting_enabled?: boolean;
          chat_enabled?: boolean;
          assets_enabled?: boolean;
          payroll_enabled?: boolean;
          personnel_enabled?: boolean;
          lms_enabled?: boolean;
          enabled_modules?: Json;
          updated_at?: string;
        };
      };
      organization_subscriptions: {
        Row: {
          org_id: string;
          plan_code: string;
          status: "trialing" | "active" | "past_due" | "paused" | "canceled" | "expired";
          provider: string | null;
          provider_customer_id: string | null;
          provider_subscription_id: string | null;
          period_start: string | null;
          period_end: string | null;
          trial_end: string | null;
          cancel_at: string | null;
          canceled_at: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          org_id: string;
          plan_code: string;
          status?: "trialing" | "active" | "past_due" | "paused" | "canceled" | "expired";
          provider?: string | null;
          provider_customer_id?: string | null;
          provider_subscription_id?: string | null;
          period_start?: string | null;
          period_end?: string | null;
          trial_end?: string | null;
          cancel_at?: string | null;
          canceled_at?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          plan_code?: string;
          status?: "trialing" | "active" | "past_due" | "paused" | "canceled" | "expired";
          provider?: string | null;
          provider_customer_id?: string | null;
          provider_subscription_id?: string | null;
          period_start?: string | null;
          period_end?: string | null;
          trial_end?: string | null;
          cancel_at?: string | null;
          canceled_at?: string | null;
          metadata?: Json;
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
          access_activated_at: string | null;
          access_suspended_at: string | null;
          access_suspension_reason: string | null;
          password_last_changed_at: string | null;
          password_last_changed_by: string | null;
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
          access_activated_at?: string | null;
          access_suspended_at?: string | null;
          access_suspension_reason?: string | null;
          password_last_changed_at?: string | null;
          password_last_changed_by?: string | null;
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
          access_activated_at?: string | null;
          access_suspended_at?: string | null;
          access_suspension_reason?: string | null;
          password_last_changed_at?: string | null;
          password_last_changed_by?: string | null;
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
          full_name_ar: string | null;
          full_name_en: string | null;
          email: string | null;
          phone: string | null;
          address: string | null;
          emergency_contact_name: string | null;
          emergency_contact_phone: string | null;
          national_id: string | null;
          date_of_birth: string | null;
          date_of_birth_hijri: string | null;
          gender: string | null;
          hiring_date: string | null;
          department_id: string | null;
          job_title: string | null;
          manager_id: string | null;
          location_id: string | null;
          company_id: string | null;
          project_id: string | null;
          work_city: string | null;
          city: string | null;
          province: string | null;
          national_address_code: string | null;
          employment_type: EmploymentType | null;
          status: string;
          base_salary: number | null;
          bonus: number | null;
          deductions: number | null;
          deduction_rule_group_id: string | null;
          leave_balance_days: number | null;
          leave_accrual_start_date: string | null;
          leave_balance_manual_adjustment: number | null;
          payment_method: string | null;
          bank_account: string | null;
          bank_account_name: string | null;
          bank_name: string | null;
          iban: string | null;
          education_level: string | null;
          lifecycle_status: "onboarding" | "active" | "offboarding" | "offboarded" | "archived";
          lifecycle_version: number;
          onboarding_status: "not_started" | "in_progress" | "ready" | "overdue";
          onboarding_progress: number;
          onboarding_due_at: string | null;
          onboarded_at: string | null;
          offboarding_started_at: string | null;
          offboarded_at: string | null;
          offboarding_reason: string | null;
          offboarded_by: string | null;
          archived_at: string | null;
          archived_by: string | null;
          auth_access_revoked_at: string | null;
          termination_date: string | null;
          termination_type: string | null;
          can_multi_checkin: boolean;
          gosi_registered: boolean;
          gosi_number: string | null;
          carrier_supervisor_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          user_id?: string | null;
          employee_code?: string | null;
          full_name: string;
          full_name_ar?: string | null;
          full_name_en?: string | null;
          email?: string | null;
          phone?: string | null;
          address?: string | null;
          emergency_contact_name?: string | null;
          emergency_contact_phone?: string | null;
          national_id?: string | null;
          date_of_birth?: string | null;
          date_of_birth_hijri?: string | null;
          gender?: string | null;
          hiring_date?: string | null;
          department_id?: string | null;
          job_title?: string | null;
          manager_id?: string | null;
          location_id?: string | null;
          company_id?: string | null;
          project_id?: string | null;
          work_city?: string | null;
          city?: string | null;
          province?: string | null;
          national_address_code?: string | null;
          employment_type?: EmploymentType | null;
          status?: string;
          base_salary?: number | null;
          bonus?: number | null;
          deductions?: number | null;
          deduction_rule_group_id?: string | null;
          leave_balance_days?: number | null;
          leave_accrual_start_date?: string | null;
          leave_balance_manual_adjustment?: number | null;
          payment_method?: string | null;
          bank_account?: string | null;
          bank_account_name?: string | null;
          bank_name?: string | null;
          iban?: string | null;
          education_level?: string | null;
          lifecycle_status?: "onboarding" | "active" | "offboarding" | "offboarded" | "archived";
          lifecycle_version?: number;
          onboarding_status?: "not_started" | "in_progress" | "ready" | "overdue";
          onboarding_progress?: number;
          onboarding_due_at?: string | null;
          onboarded_at?: string | null;
          offboarding_started_at?: string | null;
          offboarded_at?: string | null;
          offboarding_reason?: string | null;
          offboarded_by?: string | null;
          archived_at?: string | null;
          archived_by?: string | null;
          auth_access_revoked_at?: string | null;
          termination_date?: string | null;
          termination_type?: string | null;
          can_multi_checkin?: boolean;
          gosi_registered?: boolean;
          gosi_number?: string | null;
          carrier_supervisor_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          user_id?: string | null;
          employee_code?: string | null;
          full_name?: string;
          full_name_ar?: string | null;
          full_name_en?: string | null;
          email?: string | null;
          phone?: string | null;
          address?: string | null;
          emergency_contact_name?: string | null;
          emergency_contact_phone?: string | null;
          national_id?: string | null;
          date_of_birth?: string | null;
          date_of_birth_hijri?: string | null;
          gender?: string | null;
          hiring_date?: string | null;
          department_id?: string | null;
          job_title?: string | null;
          manager_id?: string | null;
          location_id?: string | null;
          company_id?: string | null;
          project_id?: string | null;
          work_city?: string | null;
          city?: string | null;
          province?: string | null;
          national_address_code?: string | null;
          employment_type?: EmploymentType | null;
          status?: string;
          base_salary?: number | null;
          bonus?: number | null;
          deductions?: number | null;
          deduction_rule_group_id?: string | null;
          leave_balance_days?: number | null;
          leave_accrual_start_date?: string | null;
          leave_balance_manual_adjustment?: number | null;
          payment_method?: string | null;
          bank_account?: string | null;
          bank_account_name?: string | null;
          bank_name?: string | null;
          iban?: string | null;
          education_level?: string | null;
          lifecycle_status?: "onboarding" | "active" | "offboarding" | "offboarded" | "archived";
          lifecycle_version?: number;
          onboarding_status?: "not_started" | "in_progress" | "ready" | "overdue";
          onboarding_progress?: number;
          onboarding_due_at?: string | null;
          onboarded_at?: string | null;
          offboarding_started_at?: string | null;
          offboarded_at?: string | null;
          offboarding_reason?: string | null;
          offboarded_by?: string | null;
          archived_at?: string | null;
          archived_by?: string | null;
          auth_access_revoked_at?: string | null;
          termination_date?: string | null;
          termination_type?: string | null;
          can_multi_checkin?: boolean;
          gosi_registered?: boolean;
          gosi_number?: string | null;
          carrier_supervisor_id?: string | null;
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
          location_id: string | null;
          device_fingerprint: string | null;
          is_registered_device: boolean | null;
          check_out_within_geofence: boolean | null;
          check_out_distance_meters: number | null;
          scheduled_check_in_at: string | null;
          scheduled_check_out_at: string | null;
          early_arrival_minutes: number | null;
          early_leave_minutes: number | null;
          overtime_minutes: number | null;
          arrival_status: string | null;
          departure_status: string | null;
          check_in_request_id: string | null;
          check_out_request_id: string | null;
          check_in_accuracy_meters: number | null;
          check_out_accuracy_meters: number | null;
          device_risk_metadata: Json;
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
          location_id?: string | null;
          device_fingerprint?: string | null;
          is_registered_device?: boolean | null;
          check_out_within_geofence?: boolean | null;
          check_out_distance_meters?: number | null;
          scheduled_check_in_at?: string | null;
          scheduled_check_out_at?: string | null;
          early_arrival_minutes?: number | null;
          early_leave_minutes?: number | null;
          overtime_minutes?: number | null;
          arrival_status?: string | null;
          departure_status?: string | null;
          check_in_request_id?: string | null;
          check_out_request_id?: string | null;
          check_in_accuracy_meters?: number | null;
          check_out_accuracy_meters?: number | null;
          device_risk_metadata?: Json;
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
          location_id?: string | null;
          device_fingerprint?: string | null;
          is_registered_device?: boolean | null;
          check_out_within_geofence?: boolean | null;
          check_out_distance_meters?: number | null;
          scheduled_check_in_at?: string | null;
          scheduled_check_out_at?: string | null;
          early_arrival_minutes?: number | null;
          early_leave_minutes?: number | null;
          overtime_minutes?: number | null;
          arrival_status?: string | null;
          departure_status?: string | null;
          check_in_request_id?: string | null;
          check_out_request_id?: string | null;
          check_in_accuracy_meters?: number | null;
          check_out_accuracy_meters?: number | null;
          device_risk_metadata?: Json;
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
          accrual_start_date: string | null;
          vacation_accrued_days: number | null;
          manual_adjustment: number | null;
          last_accrual_calculated_at: string | null;
          created_at: string | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          employee_id: string;
          sick_remaining?: number | null;
          vacation_remaining?: number | null;
          emergency_remaining?: number | null;
          accrual_start_date?: string | null;
          vacation_accrued_days?: number | null;
          manual_adjustment?: number | null;
          last_accrual_calculated_at?: string | null;
          created_at?: string | null;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          employee_id?: string;
          sick_remaining?: number | null;
          vacation_remaining?: number | null;
          emergency_remaining?: number | null;
          accrual_start_date?: string | null;
          vacation_accrued_days?: number | null;
          manual_adjustment?: number | null;
          last_accrual_calculated_at?: string | null;
          created_at?: string | null;
          updated_at?: string;
        };
      };
      leave_balance_transactions: {
        Row: {
          id: string;
          org_id: string;
          employee_id: string;
          leave_balance_id: string | null;
          leave_request_id: string | null;
          leave_type: LeaveType;
          transaction_type: string;
          amount: number;
          balance_before: number;
          balance_after: number;
          reason: string | null;
          created_by: string | null;
          command_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          employee_id: string;
          leave_balance_id?: string | null;
          leave_request_id?: string | null;
          leave_type: LeaveType;
          transaction_type: string;
          amount: number;
          balance_before?: number;
          balance_after?: number;
          reason?: string | null;
          created_by?: string | null;
          command_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          employee_id?: string;
          leave_balance_id?: string | null;
          leave_request_id?: string | null;
          leave_type?: LeaveType;
          transaction_type?: string;
          amount?: number;
          balance_before?: number;
          balance_after?: number;
          reason?: string | null;
          created_by?: string | null;
          command_id?: string | null;
          created_at?: string;
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
          manager_approval_status: string | null;
          hr_approval_status: string | null;
          total_steps: number | null;
          current_step: number | null;
          approval_history: Json;
          days_count: number | null;
          attachment_url: string | null;
          attachment_name: string | null;
          attachment_required: boolean;
          cancelled_at: string | null;
          cancelled_by: string | null;
          cancellation_reason: string | null;
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
          manager_approval_status?: string | null;
          hr_approval_status?: string | null;
          total_steps?: number | null;
          current_step?: number | null;
          approval_history?: Json;
          days_count?: number | null;
          attachment_url?: string | null;
          attachment_name?: string | null;
          attachment_required?: boolean;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          cancellation_reason?: string | null;
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
          manager_approval_status?: string | null;
          hr_approval_status?: string | null;
          total_steps?: number | null;
          current_step?: number | null;
          approval_history?: Json;
          days_count?: number | null;
          attachment_url?: string | null;
          attachment_name?: string | null;
          attachment_required?: boolean;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          cancellation_reason?: string | null;
        };
      };
      deduction_rule_groups: {
        Row: {
          id: string;
          org_id: string;
          name: string;
          late_grace_minutes: number;
          deduction_per_late_hour: number;
          allowed_absent_days: number;
          deduction_per_absent_day: number;
          deduction_per_excess_approved_day: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          name: string;
          late_grace_minutes?: number;
          deduction_per_late_hour?: number;
          allowed_absent_days?: number;
          deduction_per_absent_day?: number;
          deduction_per_excess_approved_day?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          name?: string;
          late_grace_minutes?: number;
          deduction_per_late_hour?: number;
          allowed_absent_days?: number;
          deduction_per_absent_day?: number;
          deduction_per_excess_approved_day?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "deduction_rule_groups_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      payslips: {
        Row: {
          id: string;
          org_id: string;
          employee_id: string;
          month: string;
          base_salary: number;
          total_allowances: number;
          total_deductions: number;
          net_salary: number;
          attendance_days: number;
          status: string;
          allowances_details: Json;
          deductions_details: Json;
          payroll_notes: string | null;
          employee_gosi: number;
          employer_gosi: number;
          snapshot_group_name: string | null;
          snapshot_late_grace_minutes: number | null;
          snapshot_deduction_per_late_hour: number | null;
          snapshot_allowed_absent_days: number | null;
          snapshot_deduction_per_absent_day: number | null;
          snapshot_deduction_per_excess_approved_day: number | null;
          approved_absent_days: number;
          unapproved_absent_days: number;
          late_minutes: number;
          late_deduction: number;
          absence_deduction: number;
          manual_adjustments: Json;
          manual_adjustments_total: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          employee_id: string;
          month: string;
          base_salary?: number;
          total_allowances?: number;
          total_deductions?: number;
          net_salary?: number;
          attendance_days?: number;
          status?: string;
          allowances_details?: Json;
          deductions_details?: Json;
          payroll_notes?: string | null;
          employee_gosi?: number;
          employer_gosi?: number;
          snapshot_group_name?: string | null;
          snapshot_late_grace_minutes?: number | null;
          snapshot_deduction_per_late_hour?: number | null;
          snapshot_allowed_absent_days?: number | null;
          snapshot_deduction_per_absent_day?: number | null;
          snapshot_deduction_per_excess_approved_day?: number | null;
          approved_absent_days?: number;
          unapproved_absent_days?: number;
          late_minutes?: number;
          late_deduction?: number;
          absence_deduction?: number;
          manual_adjustments?: Json;
          manual_adjustments_total?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          employee_id?: string;
          month?: string;
          base_salary?: number;
          total_allowances?: number;
          total_deductions?: number;
          net_salary?: number;
          attendance_days?: number;
          status?: string;
          allowances_details?: Json;
          deductions_details?: Json;
          payroll_notes?: string | null;
          employee_gosi?: number;
          employer_gosi?: number;
          snapshot_group_name?: string | null;
          snapshot_late_grace_minutes?: number | null;
          snapshot_deduction_per_late_hour?: number | null;
          snapshot_allowed_absent_days?: number | null;
          snapshot_deduction_per_absent_day?: number | null;
          snapshot_deduction_per_excess_approved_day?: number | null;
          approved_absent_days?: number;
          unapproved_absent_days?: number;
          late_minutes?: number;
          late_deduction?: number;
          absence_deduction?: number;
          manual_adjustments?: Json;
          manual_adjustments_total?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payslips_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payslips_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
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
          source_event_id: string | null;
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
          source_event_id?: string | null;
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
          source_event_id?: string | null;
        };
      };
    };
  };
}

type UnmappedRelationship = {
  foreignKeyName: string;
  columns: string[];
  isOneToOne?: boolean;
  referencedRelation: string;
  referencedColumns: string[];
};

type UnmappedTable = {
  Row: Record<string, unknown>;
  Insert: Record<string, unknown>;
  Update: Record<string, unknown>;
  Relationships: UnmappedRelationship[];
};

type UnmappedView = {
  Row: Record<string, unknown>;
  Relationships: UnmappedRelationship[];
};

type UnmappedFunction = {
  Args: Record<string, unknown>;
  Returns: unknown;
};

/**
 * The hand-maintained table map predates the `Relationships`, `Views`, and
 * `Functions` keys required by current supabase-js releases. Keep Database as
 * the readable source model and expose the structurally complete version to
 * clients until Phase 0 can regenerate this file from the canonical schema.
 * The index signatures deliberately mark tables not yet represented above as
 * unknown records rather than collapsing the entire client schema to `never`.
 */
export type SupabaseDatabase = {
  public: {
    Tables: {
      [Name in keyof Database["public"]["Tables"]]: Database["public"]["Tables"][Name] & {
        Relationships: Database["public"]["Tables"][Name] extends { Relationships: infer Relations }
          ? Relations
          : [];
      };
    } & Record<string, UnmappedTable>;
    Views: Record<string, UnmappedView>;
    Functions: {
      create_organization_defaults: {
        Args: { p_org_id: string; p_actor_user_id?: string | null };
        Returns: undefined;
      };
      refresh_organization_usage: {
        Args: { p_org_id: string };
        Returns: undefined;
      };
      attendance_check_in: {
        Args: {
          p_org_id: string;
          p_user_id: string;
          p_request_id: string;
          p_latitude: number;
          p_longitude: number;
          p_accuracy_meters?: number | null;
          p_device_label?: string | null;
          p_device_signal?: string | null;
          p_photo_path?: string | null;
        };
        Returns: Database["public"]["Tables"]["attendance_records"]["Row"][];
      };
      attendance_check_out: {
        Args: {
          p_org_id: string;
          p_user_id: string;
          p_attendance_id: string;
          p_request_id: string;
          p_latitude: number;
          p_longitude: number;
          p_accuracy_meters?: number | null;
          p_device_label?: string | null;
          p_device_signal?: string | null;
        };
        Returns: Database["public"]["Tables"]["attendance_records"]["Row"][];
      };
      review_leave_request: {
        Args: {
          p_org_id: string;
          p_actor_user_id: string;
          p_leave_request_id: string;
          p_command_id: string;
          p_decision: "approved" | "rejected";
          p_note?: string | null;
        };
        Returns: Database["public"]["Tables"]["leave_requests"]["Row"][];
      };
      execute_leave_review_command: {
        Args: {
          p_org_id: string;
          p_actor_user_id: string;
          p_leave_request_id: string;
          p_command_id: string;
          p_decision: "approved" | "rejected";
          p_note?: string | null;
        };
        Returns: Json;
      };
      refresh_employee_leave_balance: {
        Args: { p_org_id: string; p_employee_id: string; p_actor_user_id: string; p_command_id: string };
        Returns: Database["public"]["Tables"]["leave_balances"]["Row"][];
      };
      adjust_employee_leave_balance: {
        Args: {
          p_org_id: string;
          p_employee_id: string;
          p_actor_user_id: string;
          p_command_id: string;
          p_leave_type: string;
          p_amount: number;
          p_reason: string;
        };
        Returns: Database["public"]["Tables"]["leave_balances"]["Row"][];
      };
      cancel_leave_request: {
        Args: { p_org_id: string; p_leave_request_id: string; p_actor_user_id: string; p_command_id: string; p_reason: string };
        Returns: Database["public"]["Tables"]["leave_requests"]["Row"][];
      };
      provision_organization_admin_identity: {
        Args: { p_org_id: string; p_actor_user_id: string; p_user_id: string; p_email: string; p_full_name: string };
        Returns: undefined;
      };
      begin_employee_onboarding: {
        Args: {
          p_org_id: string;
          p_actor_user_id: string;
          p_command_id: string;
          p_employee: Json;
          p_source_type?: string;
          p_source_id?: string | null;
        };
        Returns: Database["public"]["Tables"]["employees"]["Row"][];
      };
      finalize_employee_onboarding: {
        Args: {
          p_org_id: string;
          p_employee_id: string;
          p_actor_user_id: string;
          p_command_id: string;
        };
        Returns: Database["public"]["Tables"]["employees"]["Row"][];
      };
      link_employee_identity: {
        Args: {
          p_org_id: string;
          p_employee_id: string;
          p_actor_user_id: string;
          p_command_id: string;
          p_user_id: string;
          p_email: string;
          p_full_name: string;
          p_role: OrgRole;
        };
        Returns: Database["public"]["Tables"]["employees"]["Row"][];
      };
      set_employee_locations: {
        Args: {
          p_org_id: string;
          p_employee_id: string;
          p_location_ids: string[];
          p_primary_location_id?: string | null;
        };
        Returns: undefined;
      };
      offboard_employee: {
        Args: {
          p_org_id: string;
          p_employee_id: string;
          p_actor_user_id: string;
          p_command_id: string;
          p_effective_date: string;
          p_reason: string;
          p_termination_type?: string;
        };
        Returns: Database["public"]["Tables"]["employees"]["Row"][];
      };
      configure_employee_social_insurance: {
        Args: {
          p_org_id: string;
          p_employee_id: string;
          p_actor_user_id: string;
          p_command_id: string;
          p_request_id: string;
          p_configuration: Json;
        };
        Returns: Record<string, unknown>[];
      };
      save_payroll_calculation: {
        Args: {
          p_org_id: string;
          p_employee_id: string;
          p_month: string;
          p_actor_user_id: string;
          p_command_id: string;
          p_request_id: string;
          p_expected_calculation_version: number;
          p_command_action: "calculate_payslip" | "add_adjustment" | "remove_adjustment";
          p_input_snapshot: Json;
          p_result_snapshot: Json;
        };
        Returns: Database["public"]["Tables"]["payslips"]["Row"][];
      };
      transition_payroll_run: {
        Args: {
          p_org_id: string;
          p_payroll_run_id: string;
          p_actor_user_id: string;
          p_command_id: string;
          p_request_id: string;
          p_expected_version: number;
          p_target_status: "approved" | "void";
          p_reason?: string | null;
        };
        Returns: Record<string, unknown>[];
      };
      claim_business_event: {
        Args: { target_event_id: string; target_org_id: string };
        Returns: Database["public"]["Tables"]["business_events"]["Row"][];
      };
      claim_event_outbox: {
        Args: { worker_id: string; batch_size?: number };
        Returns: Database["public"]["Tables"]["event_outbox"]["Row"][];
      };
    } & Record<string, UnmappedFunction>;
  };
};
