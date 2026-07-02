import type { LmsLearnerDashboard, LmsRecord } from "@/types/lms";

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
      return { data: null, error: { message: String(payload.message || "LMS request failed.") } };
    }
    return { data: payload.data as T, error: null };
  } catch (error) {
    return { data: null, error: { message: error instanceof Error ? error.message : "LMS request failed." } };
  }
}

function jsonInit(method: string, body?: Record<string, unknown>): RequestInit {
  return { method, body: body ? JSON.stringify(body) : undefined };
}

export function getLmsDashboard() {
  return apiFetch<LmsLearnerDashboard>("/api/lms/my");
}

export function getLmsCatalog() {
  return apiFetch<LmsRecord[]>("/api/lms/courses?mode=catalog");
}

export function getLmsCourses() {
  return apiFetch<LmsRecord[]>("/api/lms/courses");
}

export function getLmsCategories() {
  return apiFetch<LmsRecord[]>("/api/lms/categories");
}

export function getLmsCourse(courseId: string, learner = false) {
  return apiFetch<LmsRecord>(`/api/lms/courses/${courseId}${learner ? "?view=learner" : ""}`);
}

export function getLmsEnrollment(enrollmentId: string) {
  return apiFetch<LmsRecord>(`/api/lms/my/${enrollmentId}`);
}

export function createLmsCourse(values: Record<string, unknown>) {
  return apiFetch<LmsRecord>("/api/lms/courses", jsonInit("POST", values));
}

export function updateLmsCourse(courseId: string, values: Record<string, unknown>) {
  return apiFetch<LmsRecord>(`/api/lms/courses/${courseId}`, jsonInit("PATCH", values));
}

export function publishLmsCourse(courseId: string) {
  return apiFetch<LmsRecord>(`/api/lms/courses/${courseId}/publish`, jsonInit("POST"));
}

export function archiveLmsCourse(courseId: string) {
  return apiFetch<LmsRecord>(`/api/lms/courses/${courseId}`, jsonInit("DELETE"));
}

export function createLmsCategory(values: Record<string, unknown>) {
  return apiFetch<LmsRecord>("/api/lms/categories", jsonInit("POST", values));
}

export function updateLmsCategory(categoryId: string, values: Record<string, unknown>) {
  return apiFetch<LmsRecord>(`/api/lms/categories/${categoryId}`, jsonInit("PATCH", values));
}

export function archiveLmsCategory(categoryId: string) {
  return apiFetch<LmsRecord>(`/api/lms/categories/${categoryId}`, jsonInit("DELETE"));
}

export function createLmsSection(courseId: string, values: Record<string, unknown>) {
  return apiFetch<LmsRecord>(`/api/lms/courses/${courseId}/sections`, jsonInit("POST", values));
}

export function createLmsLesson(courseId: string, values: Record<string, unknown>) {
  return apiFetch<LmsRecord>(`/api/lms/courses/${courseId}/lessons`, jsonInit("POST", values));
}

export function updateLmsLesson(lessonId: string, values: Record<string, unknown>) {
  return apiFetch<LmsRecord>(`/api/lms/lessons/${lessonId}`, jsonInit("PATCH", values));
}

export function createLmsQuiz(courseId: string, values: Record<string, unknown>) {
  return apiFetch<LmsRecord>(`/api/lms/courses/${courseId}/quizzes`, jsonInit("POST", values));
}

export function createLmsTask(courseId: string, values: Record<string, unknown>) {
  return apiFetch<LmsRecord>(`/api/lms/courses/${courseId}/tasks`, jsonInit("POST", values));
}

export function createLmsInstructor(courseId: string, values: Record<string, unknown>) {
  return apiFetch<LmsRecord>(`/api/lms/courses/${courseId}/instructors`, jsonInit("POST", values));
}

export function getLmsInstructors(courseId: string) {
  return apiFetch<LmsRecord[]>(`/api/lms/courses/${courseId}/instructors`);
}

export function assignLmsCourse(values: Record<string, unknown>) {
  return apiFetch<LmsRecord>("/api/lms/assignments", jsonInit("POST", values));
}

export function completeLmsLesson(enrollmentId: string, lessonId: string) {
  return apiFetch<LmsRecord>(`/api/lms/my/${enrollmentId}/lessons/${lessonId}/complete`, jsonInit("POST"));
}

export function submitLmsQuiz(enrollmentId: string, quizId: string, answers: Record<string, unknown>) {
  return apiFetch<LmsRecord>(`/api/lms/my/${enrollmentId}/quizzes/${quizId}/attempts`, jsonInit("POST", { answers }));
}

export function submitLmsTask(enrollmentId: string, taskId: string, values: Record<string, unknown>) {
  return apiFetch<LmsRecord>(`/api/lms/my/${enrollmentId}/tasks/${taskId}/submit`, jsonInit("POST", values));
}

export function reviewLmsSubmission(submissionId: string, values: Record<string, unknown>) {
  return apiFetch<LmsRecord>(`/api/lms/submissions/${submissionId}/review`, jsonInit("POST", values));
}

export function getLmsTaskSubmissions(taskId: string) {
  return apiFetch<LmsRecord[]>(`/api/lms/tasks/${taskId}/submissions`);
}

export function createLmsAnnouncement(courseId: string, values: Record<string, unknown>) {
  return apiFetch<LmsRecord>(`/api/lms/courses/${courseId}/announcements`, jsonInit("POST", values));
}

export function submitLmsFeedback(enrollmentId: string, values: Record<string, unknown>) {
  return apiFetch<LmsRecord>(`/api/lms/my/${enrollmentId}/feedback`, jsonInit("POST", values));
}

export function getLmsCertificates() {
  return apiFetch<LmsRecord[]>("/api/lms/certificates");
}

export function getLmsCertificate(certificateId: string) {
  return apiFetch<LmsRecord>(`/api/lms/certificates/${certificateId}`);
}

export function getLmsReports() {
  return apiFetch<LmsRecord>("/api/lms/reports");
}

export function getLmsCommunity(courseId: string) {
  return apiFetch<LmsRecord[]>(`/api/lms/courses/${courseId}/community`);
}

export function createLmsPost(courseId: string, values: Record<string, unknown>) {
  return apiFetch<LmsRecord>(`/api/lms/courses/${courseId}/community/posts`, jsonInit("POST", values));
}

export function createLmsComment(postId: string, values: Record<string, unknown>) {
  return apiFetch<LmsRecord>(`/api/lms/community/posts/${postId}/comments`, jsonInit("POST", values));
}

export function reactToLmsPost(postId: string, reactionType = "like") {
  return apiFetch<LmsRecord>(`/api/lms/community/posts/${postId}/reactions`, jsonInit("POST", { reaction_type: reactionType }));
}

export function uploadLmsContent(formData: FormData) {
  return apiFetch<LmsRecord>("/api/lms/uploads", { method: "POST", body: formData });
}

export function getLmsAssignments() {
  return apiFetch<LmsRecord[]>("/api/lms/assignments");
}

export function removeLmsInstructor(courseId: string, instructorId: string) {
  return apiFetch<LmsRecord>(`/api/lms/courses/${courseId}/instructors/${instructorId}`, jsonInit("DELETE"));
}

export function deleteLmsLesson(lessonId: string) {
  return apiFetch<LmsRecord>(`/api/lms/lessons/${lessonId}`, jsonInit("DELETE"));
}

export function deleteLmsQuiz(quizId: string) {
  return apiFetch<LmsRecord>(`/api/lms/quizzes/${quizId}`, jsonInit("DELETE"));
}

export function deleteLmsTask(taskId: string) {
  return apiFetch<LmsRecord>(`/api/lms/tasks/${taskId}`, jsonInit("DELETE"));
}

export function getSignedLmsUrl(path: string) {
  return apiFetch<{ signedUrl: string }>(`/api/lms/files/signed-url?path=${encodeURIComponent(path)}`);
}

export function addLmsQuizQuestion(quizId: string, values: Record<string, unknown>) {
  return apiFetch<LmsRecord>(`/api/lms/quizzes/${quizId}/questions`, jsonInit("POST", values));
}

export function deleteLmsQuizQuestion(questionId: string) {
  return apiFetch<LmsRecord>(`/api/lms/quizzes/questions/${questionId}`, jsonInit("DELETE"));
}

export function getLmsOrgEmployees() {
  return apiFetch<LmsRecord[]>("/api/lms/employees");
}

export function getLmsOrgDepartments() {
  return apiFetch<LmsRecord[]>("/api/lms/departments");
}

export function getLmsOrgLocations() {
  return apiFetch<LmsRecord[]>("/api/lms/locations");
}
