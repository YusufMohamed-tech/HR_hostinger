import type { LmsClassroomDashboard, LmsLearnerHome, LmsRecord } from "@/types/lms";

type ApiResult<T> = { data: T | null; error: { message: string } | null };

async function apiFetch<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const response = await fetch(path, {
      ...init,
      headers: init?.body instanceof FormData
        ? init.headers
        : { "Content-Type": "application/json", ...(init?.headers || {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { data: null, error: { message: String(payload.message || "Learning request failed.") } };
    }
    return { data: payload.data as T, error: null };
  } catch (error) {
    return { data: null, error: { message: error instanceof Error ? error.message : "Learning request failed." } };
  }
}

function jsonInit(method: string, body?: Record<string, unknown>): RequestInit {
  return { method, body: body ? JSON.stringify(body) : undefined };
}

const base = "/api/learn";

// --- Reads ---
export function getLearnerHome() {
  return apiFetch<LmsLearnerHome>(base);
}
export function getClassroom(enrollmentId: string) {
  return apiFetch<LmsClassroomDashboard>(`${base}/${enrollmentId}`);
}
export function getClassroomSyllabus(enrollmentId: string) {
  return apiFetch<LmsRecord>(`${base}/${enrollmentId}/syllabus`);
}
export function getClassroomLesson(enrollmentId: string, lessonId: string) {
  return apiFetch<LmsRecord>(`${base}/${enrollmentId}/lesson/${lessonId}`);
}
export function getClassroomQuiz(enrollmentId: string, quizId: string) {
  return apiFetch<LmsRecord>(`${base}/${enrollmentId}/quiz/${quizId}`);
}
export function getClassroomProject(enrollmentId: string, taskId: string) {
  return apiFetch<LmsRecord>(`${base}/${enrollmentId}/project/${taskId}`);
}
export function getClassroomWorkspace(enrollmentId: string) {
  return apiFetch<LmsRecord>(`${base}/${enrollmentId}/workspace`);
}
export function getClassroomResources(enrollmentId: string) {
  return apiFetch<LmsRecord>(`${base}/${enrollmentId}/resources`);
}
export function getClassroomCommunity(enrollmentId: string) {
  return apiFetch<LmsRecord>(`${base}/${enrollmentId}/community`);
}
export function getClassroomCertificate(enrollmentId: string) {
  return apiFetch<LmsRecord>(`${base}/${enrollmentId}/certificate`);
}
export function getLearnerNotes(enrollmentId: string) {
  return apiFetch<LmsRecord[]>(`${base}/${enrollmentId}/notes`);
}
export function getLearnerBookmarks(enrollmentId: string) {
  return apiFetch<LmsRecord[]>(`${base}/${enrollmentId}/bookmarks`);
}

// --- Mutations ---
export function completeClassroomLesson(enrollmentId: string, lessonId: string) {
  return apiFetch<LmsRecord>(`${base}/${enrollmentId}/lesson/${lessonId}/complete`, jsonInit("POST"));
}
export function submitClassroomQuiz(enrollmentId: string, quizId: string, answers: Record<string, unknown>) {
  return apiFetch<LmsRecord>(`${base}/${enrollmentId}/quiz/${quizId}/attempts`, jsonInit("POST", { answers }));
}
export function submitClassroomProject(enrollmentId: string, taskId: string, values: Record<string, unknown>) {
  return apiFetch<LmsRecord>(`${base}/${enrollmentId}/project/${taskId}/submit`, jsonInit("POST", values));
}
export function createLearnerNote(enrollmentId: string, values: Record<string, unknown>) {
  return apiFetch<LmsRecord>(`${base}/${enrollmentId}/notes`, jsonInit("POST", values));
}
export function updateLearnerNote(enrollmentId: string, noteId: string, values: Record<string, unknown>) {
  return apiFetch<LmsRecord>(`${base}/${enrollmentId}/notes/${noteId}`, jsonInit("PATCH", values));
}
export function deleteLearnerNote(enrollmentId: string, noteId: string) {
  return apiFetch<LmsRecord>(`${base}/${enrollmentId}/notes/${noteId}`, jsonInit("DELETE"));
}
export function createLearnerBookmark(enrollmentId: string, values: Record<string, unknown>) {
  return apiFetch<LmsRecord>(`${base}/${enrollmentId}/bookmarks`, jsonInit("POST", values));
}
export function deleteLearnerBookmark(enrollmentId: string, bookmarkId: string) {
  return apiFetch<LmsRecord>(`${base}/${enrollmentId}/bookmarks/${bookmarkId}`, jsonInit("DELETE"));
}
export function updateWorkspaceState(enrollmentId: string, values: Record<string, unknown>) {
  return apiFetch<LmsRecord>(`${base}/${enrollmentId}/workspace-state`, jsonInit("PATCH", values));
}
export function recordLearnerActivity(enrollmentId: string, values: Record<string, unknown>) {
  return apiFetch<LmsRecord>(`${base}/${enrollmentId}/activity`, jsonInit("POST", values));
}

// --- Studio builder (served by /api/lms) ---
const lmsBase = "/api/lms";
export function getCourseBuilderState(courseId: string) {
  return apiFetch<LmsRecord>(`${lmsBase}/courses/${courseId}/builder`);
}
export function updateCourseBuilderOverview(courseId: string, values: Record<string, unknown>) {
  return apiFetch<LmsRecord>(`${lmsBase}/courses/${courseId}/builder/overview`, jsonInit("PATCH", values));
}
export function getPublishChecklist(courseId: string) {
  return apiFetch<LmsRecord>(`${lmsBase}/courses/${courseId}/publish-checklist`);
}
export function getLearnerPreview(courseId: string) {
  return apiFetch<LmsRecord>(`${lmsBase}/courses/${courseId}/learner-preview`);
}
export function getCourseResources(courseId: string) {
  return apiFetch<LmsRecord[]>(`${lmsBase}/courses/${courseId}/resources`);
}
export function upsertCourseResource(courseId: string, values: Record<string, unknown>, resourceId?: string) {
  return resourceId
    ? apiFetch<LmsRecord>(`${lmsBase}/courses/${courseId}/resources/${resourceId}`, jsonInit("PATCH", values))
    : apiFetch<LmsRecord>(`${lmsBase}/courses/${courseId}/resources`, jsonInit("POST", values));
}
export function deleteCourseResource(resourceId: string) {
  return apiFetch<LmsRecord>(`${lmsBase}/resources/${resourceId}`, jsonInit("DELETE"));
}
export function upsertWorkspaceConfig(courseId: string, values: Record<string, unknown>) {
  return apiFetch<LmsRecord>(`${lmsBase}/courses/${courseId}/workspace-config`, jsonInit("POST", values));
}
export function getProjectRubric(taskId: string) {
  return apiFetch<LmsRecord>(`${lmsBase}/tasks/${taskId}/rubric`);
}
export function upsertProjectRubric(taskId: string, values: Record<string, unknown>) {
  return apiFetch<LmsRecord>(`${lmsBase}/tasks/${taskId}/rubric`, jsonInit("POST", values));
}
export function deleteRubricItem(itemId: string) {
  return apiFetch<LmsRecord>(`${lmsBase}/rubric-items/${itemId}`, jsonInit("DELETE"));
}
export function reviewProjectWithRubric(submissionId: string, values: Record<string, unknown>) {
  return apiFetch<LmsRecord>(`${lmsBase}/submissions/${submissionId}/rubric-review`, jsonInit("POST", values));
}
