export interface ChecklistItem {
  id: string;
  label: string;
  type: "boolean" | "rating" | "text";
  required: boolean;
  order: number;
}

export interface ChecklistTemplate {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  items: ChecklistItem[];
  location_type: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface EvaluationResponse {
  item_id: string;
  label: string;
  value: boolean | number | string;
  notes?: string;
}

export interface SiteEvaluation {
  id: string;
  org_id: string;
  supervisor_id: string;
  location_id: string;
  attendance_record_id: string | null;
  template_id: string | null;
  responses: EvaluationResponse[];
  overall_score: number | null;
  comment: string | null;
  status: "draft" | "submitted" | "reviewed" | "flagged";
  reviewed_by: string | null;
  reviewed_at: string | null;
  reviewer_notes: string | null;
  evaluation_date: string;
  submitted_at: string;
  created_at: string;
  updated_at: string;
}

export interface SiteEvaluationAttachment {
  id: string;
  org_id: string;
  evaluation_id: string;
  file_key: string;
  file_name: string;
  file_type: string;
  file_size: number | null;
  uploaded_by: string;
  created_at: string;
}

export interface SiteEvaluationWithDetails extends SiteEvaluation {
  location?: { id: string; name: string; type: string };
  supervisor?: { id: string; full_name: string };
  attachments?: SiteEvaluationAttachment[];
}
