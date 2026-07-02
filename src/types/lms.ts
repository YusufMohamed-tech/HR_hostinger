export type LmsCourseStatus = "draft" | "published" | "archived";
export type LmsCourseVisibility = "assigned_only" | "catalog";
export type LmsDifficulty = "beginner" | "intermediate" | "advanced";
export type LmsLessonType = "text" | "video" | "file" | "document" | "link";
export type LmsEnrollmentStatus = "assigned" | "in_progress" | "completed" | "overdue" | "cancelled";
export type LmsProgressStatus = "not_started" | "in_progress" | "completed";
export type LmsTaskType = "text_response" | "file_upload" | "link_submission" | "mixed";
export type LmsTaskStatus = "draft" | "published" | "archived";
export type LmsSubmissionStatus = "not_submitted" | "submitted" | "late" | "reviewed" | "accepted" | "rejected" | "needs_revision";
export type LmsReviewStatus = "accepted" | "rejected" | "needs_revision";
export type LmsPostType = "discussion" | "question" | "announcement";
export type LmsReactionType = "like" | "helpful" | "celebrate";
export type LmsInstructorType = "primary_instructor" | "assistant_instructor" | "reviewer";

export type LmsRecord = Record<string, unknown>;

export type LmsCourseSummary = {
  id: string;
  title: string;
  description: string | null;
  status: LmsCourseStatus;
  visibility: LmsCourseVisibility;
  difficulty: LmsDifficulty;
  estimated_minutes: number;
  progress_percent?: number;
  enrollment_id?: string;
  due_date?: string | null;
};

export type LmsLearnerDashboard = {
  assigned: LmsRecord[];
  catalog: LmsRecord[];
  certificates: LmsRecord[];
  stats: {
    assigned: number;
    inProgress: number;
    completed: number;
    overdue: number;
  };
};

export type LmsReportSummary = {
  assignedCourses: number;
  completedCourses: number;
  inProgressCourses: number;
  overdueCourses: number;
  completionRate: number;
  averageQuizScore: number;
  taskSubmissions: number;
  taskPassRate: number;
  certificates: number;
  communityPosts: number;
  feedbackAverage: number;
};

// --- LMS v44 classroom ---

export type LmsSyllabusItemKind = "lesson" | "quiz" | "project";
export type LmsSyllabusItemStatus =
  | "completed"
  | "passed"
  | "available"
  | "submitted"
  | "in_review"
  | "needs_revision"
  | "locked";

export type LmsSyllabusItem = {
  kind: LmsSyllabusItemKind;
  id: string;
  title: string;
  subtitle: string | null;
  status: LmsSyllabusItemStatus;
  is_required: boolean;
  meta: LmsRecord;
};

export type LmsSyllabusModule = {
  id: string;
  title: string;
  description: string | null;
  section_type: string;
  is_milestone: boolean;
  estimated_minutes: number | null;
  items: LmsSyllabusItem[];
};

export type LmsSyllabusPart = LmsSyllabusModule & {
  modules: LmsSyllabusModule[];
};

export type LmsLearnerHome = {
  continueLearning: LmsRecord | null;
  active: LmsRecord[];
  completed: LmsRecord[];
  deadlines: LmsRecord[];
  announcements: LmsRecord[];
  certificates: LmsRecord[];
  stats: {
    assigned: number;
    inProgress: number;
    completed: number;
    overdue: number;
    certificates: number;
  };
};

export type LmsClassroomDashboard = {
  enrollment: LmsRecord;
  course: LmsRecord;
  parts: LmsSyllabusPart[];
  nextAction: LmsSyllabusItem | null;
  checklist: {
    totalRequired: number;
    completedRequired: number;
    lessons: { total: number; done: number };
    quizzes: { total: number; passed: number };
    projects: { total: number; accepted: number };
  };
  instructors: LmsRecord[];
  deadlines: LmsRecord[];
  certificate: LmsRecord | null;
  workspaceState: LmsRecord | null;
};
