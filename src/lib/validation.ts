import { z } from "zod";

const emptyToUndefined = (value: unknown) => {
  if (value === null) return undefined;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const optionalTrimmedString = z.preprocess(emptyToUndefined, z.string().max(255).optional());
const optionalLongString = z.preprocess(emptyToUndefined, z.string().max(1000).optional());
const optionalDate = z.preprocess(
  emptyToUndefined,
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date.").optional()
);
const optionalUuid = z.preprocess(emptyToUndefined, z.string().uuid("Select a valid record.").optional());
const optionalMoney = z.preprocess(
  emptyToUndefined,
  z.coerce.number().min(0, "Amount cannot be negative.").finite().optional()
);

export const employeeFormSchema = z.object({
  full_name: z.string().trim().min(2, "Full name is required.").max(160),
  full_name_ar: optionalTrimmedString,
  full_name_en: optionalTrimmedString,
  employee_code: optionalTrimmedString,
  email: z.preprocess(emptyToUndefined, z.string().email("Use a valid email address.").optional()),
  phone: optionalTrimmedString,
  address: optionalLongString,
  work_city: optionalTrimmedString,
  national_address_code: z.preprocess(
    emptyToUndefined,
    z.string().regex(/^[A-Za-z]{4}\d{4}$/, "National address must be 4 letters followed by 4 numbers.").optional()
  ),
  emergency_contact_name: optionalTrimmedString,
  emergency_contact_phone: optionalTrimmedString,
  national_id: optionalTrimmedString,
  date_of_birth: optionalDate,
  date_of_birth_hijri: optionalTrimmedString,
  gender: z.preprocess(emptyToUndefined, z.enum(["male", "female"]).optional()),
  hiring_date: optionalDate,
  department_id: optionalUuid,
  job_title: optionalTrimmedString,
  manager_id: optionalUuid,
  location_id: optionalUuid,
  company_id: optionalUuid,
  project_id: optionalUuid,
  city: optionalTrimmedString,
  province: optionalTrimmedString,
  employment_type: z.enum(["full_time", "part_time", "intern", "contract"]),
  status: z.enum(["Active", "Inactive", "On Leave"]),
  base_salary: optionalMoney,
  bonus: optionalMoney,
  deductions: optionalMoney,
  leave_balance_manual_adjustment: optionalMoney,
  leave_accrual_start_date: optionalDate,
  payment_method: optionalTrimmedString,
  bank_account: optionalTrimmedString,
  bank_account_name: optionalTrimmedString,
  bank_name: optionalTrimmedString,
  iban: optionalTrimmedString,
  education_level: optionalTrimmedString,
});

export const leaveRequestFormSchema = z
  .object({
    leave_type: z.enum(["sick", "vacation", "emergency", "unpaid", "weekly", "marriage", "bereavement"]),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Start date is required."),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "End date is required."),
    reason: optionalLongString,
    attachment_url: optionalLongString,
    attachment_name: optionalTrimmedString,
  })
  .refine((value) => new Date(value.end_date) >= new Date(value.start_date), {
    message: "End date cannot be before start date.",
    path: ["end_date"],
  });

export const taskFormSchema = z.object({
  title: z.string().trim().min(2, "Title is required.").max(160),
  description: optionalLongString,
  priority: z.enum(["low", "medium", "high", "urgent"]),
  due_date: optionalDate,
  location_id: optionalUuid,
  employee_id: optionalUuid,
});

export const departmentFormSchema = z.object({
  name: z.string().trim().min(2, "Department name is required.").max(160),
  manager_employee_id: optionalUuid,
});

export const locationFormSchema = z.object({
  name: z.string().trim().min(2, "Location name is required.").max(160),
  type: z.enum(["branch", "booth", "office", "area"]),
  city: optionalTrimmedString,
  project_id: optionalUuid,
  project_name: optionalTrimmedString,
  address_details: optionalLongString,
  latitude: z.preprocess(emptyToUndefined, z.coerce.number().min(-90).max(90).optional()),
  longitude: z.preprocess(emptyToUndefined, z.coerce.number().min(-180).max(180).optional()),
  radius_meters: z.preprocess(emptyToUndefined, z.coerce.number().min(10).max(10000).optional()),
  manager_employee_id: optionalUuid,
});

const optionalUrl = z.preprocess(
  emptyToUndefined,
  z.string().url("Use a valid URL.").max(1000).optional()
);

const optionalPositiveInteger = z.preprocess(
  emptyToUndefined,
  z.coerce.number().int().min(0).max(100000).optional()
);

const optionalScore = z.preprocess(
  emptyToUndefined,
  z.coerce.number().min(0).max(100).optional()
);

const optionalBoolean = z.preprocess((value) => {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean().optional());

export const lmsCategorySchema = z.object({
  name: z.string().trim().min(2, "Category name is required.").max(160),
  description: optionalLongString,
  color: z.preprocess(
    emptyToUndefined,
    z.string().regex(/^#[0-9a-f]{6}$/i, "Use a valid hex color.").optional()
  ),
  is_active: optionalBoolean,
});

export const lmsCourseSchema = z.object({
  category_id: optionalUuid,
  title: z.string().trim().min(2, "Course title is required.").max(220),
  description: optionalLongString,
  thumbnail_path: optionalLongString,
  status: z.enum(["draft", "published", "archived"]).optional(),
  visibility: z.enum(["assigned_only", "catalog"]).optional(),
  difficulty: z.enum(["beginner", "intermediate", "advanced"]).optional(),
  estimated_minutes: optionalPositiveInteger,
  passing_score: optionalScore,
  requires_quiz_pass: optionalBoolean,
  requires_task_pass: optionalBoolean,
});

export const lmsInstructorSchema = z.object({
  employee_id: z.string().uuid("Select a valid instructor."),
  instructor_type: z.enum(["primary_instructor", "assistant_instructor", "reviewer"]).optional(),
  can_edit_content: optionalBoolean,
  can_review_tasks: optionalBoolean,
  can_moderate_community: optionalBoolean,
});

export const lmsSectionSchema = z.object({
  title: z.string().trim().min(2, "Section title is required.").max(220),
  description: optionalLongString,
  sort_order: optionalPositiveInteger,
});

export const lmsLessonSchema = z.object({
  section_id: optionalUuid,
  title: z.string().trim().min(2, "Lesson title is required.").max(220),
  description: optionalLongString,
  lesson_type: z.enum(["text", "video", "file", "document", "link"]),
  content: optionalLongString,
  content_url: optionalUrl,
  storage_path: optionalLongString,
  duration_minutes: optionalPositiveInteger,
  sort_order: optionalPositiveInteger,
  is_required: optionalBoolean,
  is_preview: optionalBoolean,
  is_active: optionalBoolean,
});

export const lmsQuizSchema = z.object({
  lesson_id: optionalUuid,
  title: z.string().trim().min(2, "Quiz title is required.").max(220),
  description: optionalLongString,
  passing_score: optionalScore,
  max_attempts: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(20).optional()),
  time_limit_minutes: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(600).optional()),
  is_required: optionalBoolean,
  is_active: optionalBoolean,
  questions: z.array(z.object({
    id: optionalUuid,
    question_text: z.string().trim().min(2).max(1000),
    question_type: z.enum(["single_choice", "multiple_choice", "true_false", "short_answer"]),
    options_json: z.unknown().optional(),
    correct_answer_json: z.unknown().optional(),
    points: z.coerce.number().min(0).max(1000).optional(),
    sort_order: z.coerce.number().int().min(0).optional(),
  })).optional(),
});

export const lmsTaskSchema = z.object({
  lesson_id: optionalUuid,
  title: z.string().trim().min(2, "Task title is required.").max(220),
  description: optionalLongString,
  task_type: z.enum(["text_response", "file_upload", "link_submission", "mixed"]).optional(),
  instructions: optionalLongString,
  due_date: optionalDate,
  max_score: z.preprocess(emptyToUndefined, z.coerce.number().min(1).max(10000).optional()),
  pass_score: z.preprocess(emptyToUndefined, z.coerce.number().min(0).max(10000).optional()),
  is_required: optionalBoolean,
  allow_resubmission: optionalBoolean,
  late_submission_allowed: optionalBoolean,
  status: z.enum(["draft", "published", "archived"]).optional(),
});

export const lmsAssignmentSchema = z.object({
  course_id: optionalUuid,
  learning_path_id: optionalUuid,
  assignment_type: z.enum(["employee", "department", "team", "location", "role", "all"]),
  target_id: optionalTrimmedString,
  due_date: optionalDate,
}).refine((value) => Boolean(value.course_id || value.learning_path_id), {
  message: "Select a course or learning path.",
  path: ["course_id"],
});

export const lmsTaskSubmissionSchema = z.object({
  submission_text: optionalLongString,
  submission_url: optionalUrl,
  storage_path: optionalLongString,
}).refine((value) => Boolean(value.submission_text || value.submission_url || value.storage_path), {
  message: "Add text, a link, or a file before submitting.",
});

export const lmsTaskReviewSchema = z.object({
  score: z.coerce.number().min(0).max(10000),
  feedback: optionalLongString,
  review_status: z.enum(["accepted", "rejected", "needs_revision"]),
});

export const lmsAnnouncementSchema = z.object({
  title: z.string().trim().min(2, "Announcement title is required.").max(220),
  body: z.string().trim().min(2, "Announcement body is required.").max(4000),
  pinned: optionalBoolean,
});

export const lmsCommunityPostSchema = z.object({
  post_type: z.enum(["discussion", "question", "announcement"]).optional(),
  title: optionalTrimmedString,
  body: z.string().trim().min(2, "Post body is required.").max(4000),
});

export const lmsCommunityCommentSchema = z.object({
  body: z.string().trim().min(2, "Comment body is required.").max(2000),
});

export const lmsFeedbackSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  comment: optionalLongString,
});

export const lmsLearningPathSchema = z.object({
  title: z.string().trim().min(2, "Learning path title is required.").max(220),
  description: optionalLongString,
  status: z.enum(["draft", "published", "archived"]).optional(),
});

export function getValidationMessage(error: z.ZodError) {
  return error.issues[0]?.message ?? "Please check the form and try again.";
}
