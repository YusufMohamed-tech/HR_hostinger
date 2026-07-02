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
