/* eslint-disable @typescript-eslint/no-explicit-any */
import type { TenantAuthContext } from "@/lib/server/tenant-context";
import {
  completeLesson,
  createSignedLmsUrl,
  getEmployeeId,
  getEnrollmentForLearner,
  listCommunity,
  recalculateEnrollment,
  submitQuizAttempt,
  submitTask,
} from "@/lib/server/lms";

type Db = { from: (table: string) => any; storage: { from: (bucket: string) => any } };
type LmsAuth = TenantAuthContext;
type RecordMap = Record<string, unknown>;

function db(auth: LmsAuth): Db {
  return auth.admin as unknown as Db;
}
function asRecord(value: unknown): RecordMap {
  return value && typeof value === "object" ? (value as RecordMap) : {};
}
function asRows(value: unknown): RecordMap[] {
  return Array.isArray(value) ? value.map(asRecord) : [];
}
function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
function optionalText(value: unknown) {
  const next = text(value);
  return next || null;
}
function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function nowIso() {
  return new Date().toISOString();
}

// Owner-only enrollment context for the classroom. Throws if not the learner.
async function loadClassroom(auth: LmsAuth, enrollmentId: string) {
  const enrollment = await getEnrollmentForLearner(auth, enrollmentId);
  const courseId = text(enrollment.course_id);
  const courseResult = await db(auth)
    .from("lms_courses")
    .select("*, category:category_id(name, color)")
    .eq("org_id", auth.orgId)
    .eq("id", courseId)
    .maybeSingle();
  if (courseResult.error) throw new Error(courseResult.error.message);
  const course = asRecord(courseResult.data);
  if (!course.id) throw new Error("Course not found");
  return { enrollment, course, courseId, employeeId: text(enrollment.employee_id) };
}

async function signIfStored(auth: LmsAuth, path: unknown) {
  const value = text(path);
  if (!value) return null;
  try {
    const signed = await createSignedLmsUrl(auth, value);
    return asRecord(signed).signedUrl || null;
  } catch {
    return null;
  }
}

async function loadSyllabusData(auth: LmsAuth, courseId: string, enrollmentId: string) {
  const [sections, lessons, quizzes, tasks, progress, attempts, submissions] = await Promise.all([
    db(auth).from("lms_course_sections").select("*").eq("org_id", auth.orgId).eq("course_id", courseId).order("sort_order", { ascending: true }),
    db(auth).from("lms_lessons").select("id, section_id, title, description, lesson_type, learning_unit_type, display_mode, duration_minutes, sort_order, is_required, is_preview").eq("org_id", auth.orgId).eq("course_id", courseId).eq("is_active", true).order("sort_order", { ascending: true }),
    db(auth).from("lms_quizzes").select("id, lesson_id, title, description, passing_score, max_attempts, time_limit_minutes, is_required").eq("org_id", auth.orgId).eq("course_id", courseId).eq("is_active", true).order("created_at", { ascending: true }),
    db(auth).from("lms_tasks").select("id, lesson_id, title, description, task_type, due_date, is_required, estimated_minutes, why_it_matters").eq("org_id", auth.orgId).eq("course_id", courseId).eq("status", "published").order("created_at", { ascending: true }),
    db(auth).from("lms_lesson_progress").select("lesson_id, status").eq("org_id", auth.orgId).eq("enrollment_id", enrollmentId),
    db(auth).from("lms_quiz_attempts").select("quiz_id, passed, score, attempt_number").eq("org_id", auth.orgId).eq("enrollment_id", enrollmentId),
    db(auth).from("lms_task_submissions").select("task_id, status").eq("org_id", auth.orgId).eq("enrollment_id", enrollmentId),
  ]);
  for (const item of [sections, lessons, quizzes, tasks, progress, attempts, submissions]) {
    if (item.error) throw new Error(item.error.message);
  }
  return {
    sections: asRows(sections.data),
    lessons: asRows(lessons.data),
    quizzes: asRows(quizzes.data),
    tasks: asRows(tasks.data),
    completedLessonIds: new Set(asRows(progress.data).filter((r) => r.status === "completed").map((r) => text(r.lesson_id))),
    passedQuizIds: new Set(asRows(attempts.data).filter((r) => r.passed === true).map((r) => text(r.quiz_id))),
    quizAttemptCounts: asRows(attempts.data).reduce<Record<string, number>>((acc, r) => {
      const id = text(r.quiz_id);
      acc[id] = (acc[id] || 0) + 1;
      return acc;
    }, {}),
    submissionStatus: asRows(submissions.data).reduce<Record<string, string>>((acc, r) => {
      acc[text(r.task_id)] = text(r.status);
      return acc;
    }, {}),
  };
}

type SyllabusItem = {
  kind: "lesson" | "quiz" | "project";
  id: string;
  title: string;
  subtitle: string | null;
  status: "completed" | "passed" | "available" | "submitted" | "in_review" | "needs_revision" | "locked";
  is_required: boolean;
  meta: RecordMap;
};

function buildSyllabus(data: Awaited<ReturnType<typeof loadSyllabusData>>) {
  const { sections, lessons, quizzes, tasks, completedLessonIds, passedQuizIds, quizAttemptCounts, submissionStatus } = data;

  const lessonStatus = (lessonId: string): SyllabusItem["status"] =>
    completedLessonIds.has(lessonId) ? "completed" : "available";
  const quizStatus = (quizId: string): SyllabusItem["status"] =>
    passedQuizIds.has(quizId) ? "passed" : "available";
  const projectStatus = (taskId: string): SyllabusItem["status"] => {
    const status = submissionStatus[taskId];
    if (status === "accepted") return "completed";
    if (status === "needs_revision" || status === "rejected") return "needs_revision";
    if (status === "submitted" || status === "late") return "submitted";
    if (status === "reviewed") return "in_review";
    return "available";
  };

  const quizzesByLesson = new Map<string, RecordMap[]>();
  const tasksByLesson = new Map<string, RecordMap[]>();
  for (const quiz of quizzes) {
    const key = text(quiz.lesson_id);
    if (!key) continue;
    quizzesByLesson.set(key, [...(quizzesByLesson.get(key) || []), quiz]);
  }
  for (const task of tasks) {
    const key = text(task.lesson_id);
    if (!key) continue;
    tasksByLesson.set(key, [...(tasksByLesson.get(key) || []), task]);
  }

  const itemsForSection = (sectionId: string | null): SyllabusItem[] => {
    const out: SyllabusItem[] = [];
    const sectionLessons = lessons.filter((l) => (sectionId ? text(l.section_id) === sectionId : !text(l.section_id)));
    for (const lesson of sectionLessons) {
      const lessonId = text(lesson.id);
      out.push({
        kind: "lesson",
        id: lessonId,
        title: text(lesson.title),
        subtitle: text(lesson.description) || null,
        status: lessonStatus(lessonId),
        is_required: lesson.is_required !== false,
        meta: { lesson_type: text(lesson.lesson_type), display_mode: text(lesson.display_mode), learning_unit_type: text(lesson.learning_unit_type), duration_minutes: numberValue(lesson.duration_minutes) },
      });
      for (const quiz of quizzesByLesson.get(lessonId) || []) {
        out.push({ kind: "quiz", id: text(quiz.id), title: text(quiz.title), subtitle: "اختبار", status: quizStatus(text(quiz.id)), is_required: quiz.is_required !== false, meta: { attempts: quizAttemptCounts[text(quiz.id)] || 0, max_attempts: numberValue(quiz.max_attempts, 3), passing_score: numberValue(quiz.passing_score, 70) } });
      }
      for (const task of tasksByLesson.get(lessonId) || []) {
        out.push({ kind: "project", id: text(task.id), title: text(task.title), subtitle: "مشروع", status: projectStatus(text(task.id)), is_required: task.is_required !== false, meta: { task_type: text(task.task_type), due_date: text(task.due_date) || null } });
      }
    }
    // Section-level quizzes/projects (no lesson link) only for real sections.
    if (sectionId) {
      for (const quiz of quizzes.filter((q) => !text(q.lesson_id))) {
        // attach to first section only if it belongs (skip; handled at course-level below)
        void quiz;
      }
    }
    return out;
  };

  const topLevel = sections.filter((s) => !text(s.parent_section_id));
  const childrenOf = (sectionId: string) => sections.filter((s) => text(s.parent_section_id) === sectionId);

  const parts = topLevel.map((section) => {
    const sectionId = text(section.id);
    const modules = childrenOf(sectionId).map((child) => ({
      id: text(child.id),
      title: text(child.title),
      description: text(child.description) || null,
      section_type: text(child.section_type) || "module",
      is_milestone: child.is_milestone === true,
      estimated_minutes: numberValue(child.estimated_minutes) || null,
      items: itemsForSection(text(child.id)),
    }));
    return {
      id: sectionId,
      title: text(section.title),
      description: text(section.description) || null,
      section_type: text(section.section_type) || "module",
      is_milestone: section.is_milestone === true,
      estimated_minutes: numberValue(section.estimated_minutes) || null,
      items: itemsForSection(sectionId),
      modules,
    };
  });

  // Unsectioned lessons + course-level quizzes/tasks bucket.
  const looseItems = itemsForSection(null);
  const courseLevelExtras: SyllabusItem[] = [];
  for (const quiz of quizzes.filter((q) => !text(q.lesson_id))) {
    courseLevelExtras.push({ kind: "quiz", id: text(quiz.id), title: text(quiz.title), subtitle: "اختبار", status: quizStatus(text(quiz.id)), is_required: quiz.is_required !== false, meta: { attempts: quizAttemptCounts[text(quiz.id)] || 0, max_attempts: numberValue(quiz.max_attempts, 3) } });
  }
  for (const task of tasks.filter((t) => !text(t.lesson_id))) {
    courseLevelExtras.push({ kind: "project", id: text(task.id), title: text(task.title), subtitle: "مشروع", status: projectStatus(text(task.id)), is_required: task.is_required !== false, meta: { task_type: text(task.task_type), due_date: text(task.due_date) || null } });
  }
  const extras = [...looseItems, ...courseLevelExtras];
  if (extras.length > 0) {
    parts.push({ id: "general", title: "محتوى عام", description: null, section_type: "module", is_milestone: false, estimated_minutes: null, items: extras, modules: [] });
  }

  return parts;
}

function flattenSyllabus(parts: ReturnType<typeof buildSyllabus>): SyllabusItem[] {
  const flat: SyllabusItem[] = [];
  for (const part of parts) {
    flat.push(...part.items);
    for (const mod of part.modules) flat.push(...mod.items);
  }
  return flat;
}

function computeNextAction(flat: SyllabusItem[]) {
  const done = new Set(["completed", "passed"]);
  const next = flat.find((item) => item.is_required && !done.has(item.status));
  if (next) return next;
  return flat.find((item) => !done.has(item.status)) || null;
}

// ---------------------------------------------------------------------------
// Learner home
// ---------------------------------------------------------------------------

export async function getLearnerHome(auth: LmsAuth) {
  const employeeId = await getEmployeeId(auth);
  if (!employeeId) throw new Error("Employee profile is required.");

  const [enrollmentsResult, workspaceResult, certificatesResult] = await Promise.all([
    db(auth)
      .from("lms_enrollments")
      .select("*, course:course_id(id, title, subtitle, thumbnail_path, difficulty, estimated_minutes, experience_type, category:category_id(name, color))")
      .eq("org_id", auth.orgId)
      .eq("employee_id", employeeId)
      .neq("status", "cancelled")
      .order("updated_at", { ascending: false }),
    db(auth).from("lms_learner_workspace_state").select("*").eq("org_id", auth.orgId).eq("employee_id", employeeId).order("updated_at", { ascending: false }),
    db(auth).from("lms_certificates").select("*, course:course_id(title)").eq("org_id", auth.orgId).eq("employee_id", employeeId).order("issued_at", { ascending: false }),
  ]);
  if (enrollmentsResult.error) throw new Error(enrollmentsResult.error.message);
  if (workspaceResult.error) throw new Error(workspaceResult.error.message);
  if (certificatesResult.error) throw new Error(certificatesResult.error.message);

  const enrollments = asRows(enrollmentsResult.data).filter((row) => text(asRecord(row.course).id));
  const workspaceStates = asRows(workspaceResult.data);
  const workspaceByEnrollment = new Map(workspaceStates.map((w) => [text(w.enrollment_id), w]));
  const courseIds = enrollments.map((row) => text(asRecord(row.course).id)).filter(Boolean);
  const enrollmentIds = enrollments.map((row) => text(row.id)).filter(Boolean);

  const [deadlinesResult, announcementsResult] = await Promise.all([
    enrollmentIds.length
      ? db(auth).from("lms_learning_deadlines").select("*, course:course_id(title)").eq("org_id", auth.orgId).eq("employee_id", employeeId).in("status", ["upcoming", "due_soon", "overdue"]).order("due_at", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    courseIds.length
      ? db(auth).from("lms_course_announcements").select("*, course:course_id(title)").eq("org_id", auth.orgId).in("course_id", courseIds).order("published_at", { ascending: false }).limit(8)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (deadlinesResult.error) throw new Error(deadlinesResult.error.message);
  if (announcementsResult.error) throw new Error(announcementsResult.error.message);

  const active = enrollments.filter((row) => ["assigned", "in_progress", "overdue"].includes(text(row.status)));
  const continueState = workspaceStates.find((w) => active.some((e) => text(e.id) === text(w.enrollment_id)));
  const continueEnrollment =
    (continueState && active.find((e) => text(e.id) === text(continueState.enrollment_id))) ||
    active.find((e) => text(e.status) === "in_progress") ||
    active[0] ||
    null;

  const decorate = (row: RecordMap) => ({
    ...row,
    workspace_state: workspaceByEnrollment.get(text(row.id)) || null,
  });

  return {
    continueLearning: continueEnrollment ? decorate(continueEnrollment) : null,
    active: active.map(decorate),
    completed: enrollments.filter((row) => text(row.status) === "completed").map(decorate),
    deadlines: asRows(deadlinesResult.data),
    announcements: asRows(announcementsResult.data),
    certificates: asRows(certificatesResult.data),
    stats: {
      assigned: enrollments.length,
      inProgress: enrollments.filter((row) => text(row.status) === "in_progress").length,
      completed: enrollments.filter((row) => text(row.status) === "completed").length,
      overdue: enrollments.filter((row) => text(row.status) === "overdue").length,
      certificates: asRows(certificatesResult.data).length,
    },
  };
}

// ---------------------------------------------------------------------------
// Classroom dashboard + syllabus
// ---------------------------------------------------------------------------

export async function getClassroomDashboard(auth: LmsAuth, enrollmentId: string) {
  const { enrollment, course, courseId, employeeId } = await loadClassroom(auth, enrollmentId);
  const data = await loadSyllabusData(auth, courseId, enrollmentId);
  const parts = buildSyllabus(data);
  const flat = flattenSyllabus(parts);
  const nextAction = computeNextAction(flat);

  const [workspaceState, instructorsResult, deadlinesResult, certificateResult] = await Promise.all([
    db(auth).from("lms_learner_workspace_state").select("*").eq("org_id", auth.orgId).eq("enrollment_id", enrollmentId).eq("employee_id", employeeId).maybeSingle(),
    db(auth).from("lms_course_instructors").select("instructor_type, employee:employee_id(full_name, job_title)").eq("org_id", auth.orgId).eq("course_id", courseId),
    db(auth).from("lms_learning_deadlines").select("*").eq("org_id", auth.orgId).eq("enrollment_id", enrollmentId).in("status", ["upcoming", "due_soon", "overdue"]).order("due_at", { ascending: true }),
    db(auth).from("lms_certificates").select("id, certificate_number, issued_at").eq("org_id", auth.orgId).eq("enrollment_id", enrollmentId).maybeSingle(),
  ]);
  if (instructorsResult.error) throw new Error(instructorsResult.error.message);
  if (deadlinesResult.error) throw new Error(deadlinesResult.error.message);

  const requiredItems = flat.filter((item) => item.is_required);
  const completedRequired = requiredItems.filter((item) => item.status === "completed" || item.status === "passed").length;

  return {
    enrollment,
    course,
    parts,
    nextAction,
    checklist: {
      totalRequired: requiredItems.length,
      completedRequired,
      lessons: { total: data.lessons.length, done: data.completedLessonIds.size },
      quizzes: { total: data.quizzes.length, passed: data.passedQuizIds.size },
      projects: { total: data.tasks.length, accepted: Object.values(data.submissionStatus).filter((s) => s === "accepted").length },
    },
    instructors: asRows(instructorsResult.data),
    deadlines: asRows(deadlinesResult.data),
    certificate: asRecord(certificateResult.data).id ? certificateResult.data : null,
    workspaceState: asRecord(workspaceState.data).id ? workspaceState.data : null,
  };
}

export async function getClassroomSyllabus(auth: LmsAuth, enrollmentId: string) {
  const { enrollment, course, courseId } = await loadClassroom(auth, enrollmentId);
  const data = await loadSyllabusData(auth, courseId, enrollmentId);
  const parts = buildSyllabus(data);
  const flat = flattenSyllabus(parts);
  return {
    enrollment,
    course,
    parts,
    nextAction: computeNextAction(flat),
    counts: {
      lessons: data.lessons.length,
      quizzes: data.quizzes.length,
      projects: data.tasks.length,
      completedLessons: data.completedLessonIds.size,
      passedQuizzes: data.passedQuizIds.size,
    },
  };
}

// ---------------------------------------------------------------------------
// Lesson experience
// ---------------------------------------------------------------------------

export async function getClassroomLesson(auth: LmsAuth, enrollmentId: string, lessonId: string) {
  const { enrollment, courseId, employeeId } = await loadClassroom(auth, enrollmentId);
  const lessonResult = await db(auth)
    .from("lms_lessons")
    .select("*, attachments:lms_lesson_attachments(*), quizzes:lms_quizzes(id, title, passing_score, max_attempts, is_required), tasks:lms_tasks(id, title, task_type, due_date, is_required)")
    .eq("org_id", auth.orgId)
    .eq("course_id", courseId)
    .eq("id", lessonId)
    .eq("is_active", true)
    .maybeSingle();
  if (lessonResult.error) throw new Error(lessonResult.error.message);
  const lesson = asRecord(lessonResult.data);
  if (!lesson.id) throw new Error("Lesson not found");

  const [orderedResult, progressResult, notesResult, bookmarkResult] = await Promise.all([
    db(auth).from("lms_lessons").select("id, section_id, title, sort_order").eq("org_id", auth.orgId).eq("course_id", courseId).eq("is_active", true).order("sort_order", { ascending: true }),
    db(auth).from("lms_lesson_progress").select("lesson_id, status").eq("org_id", auth.orgId).eq("enrollment_id", enrollmentId).eq("lesson_id", lessonId).maybeSingle(),
    db(auth).from("lms_learner_notes").select("*").eq("org_id", auth.orgId).eq("enrollment_id", enrollmentId).eq("employee_id", employeeId).eq("lesson_id", lessonId).order("created_at", { ascending: false }),
    db(auth).from("lms_learner_bookmarks").select("id").eq("org_id", auth.orgId).eq("enrollment_id", enrollmentId).eq("employee_id", employeeId).eq("lesson_id", lessonId).maybeSingle(),
  ]);
  if (orderedResult.error) throw new Error(orderedResult.error.message);
  if (notesResult.error) throw new Error(notesResult.error.message);

  const ordered = asRows(orderedResult.data);
  const index = ordered.findIndex((row) => text(row.id) === lessonId);
  const previous = index > 0 ? ordered[index - 1] : null;
  const next = index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : null;

  const signedUrl = await signIfStored(auth, lesson.storage_path);
  const attachments = [];
  for (const attachment of asRows(lesson.attachments)) {
    attachments.push({ ...attachment, signed_url: await signIfStored(auth, attachment.storage_path) });
  }

  await recordActivityEvent(auth, enrollmentId, { event_type: "lesson_opened", source_type: "lesson", source_id: lessonId }).catch(() => null);

  return {
    enrollment,
    lesson: { ...lesson, signed_url: signedUrl, attachments },
    progress: asRecord(progressResult.data),
    completed: text(asRecord(progressResult.data).status) === "completed",
    notes: asRows(notesResult.data),
    bookmarked: Boolean(asRecord(bookmarkResult.data).id),
    navigation: {
      previous: previous ? { id: text(previous.id), title: text(previous.title) } : null,
      next: next ? { id: text(next.id), title: text(next.title) } : null,
      index: index + 1,
      total: ordered.length,
    },
  };
}

export async function completeClassroomLesson(auth: LmsAuth, enrollmentId: string, lessonId: string) {
  const result = await completeLesson(auth, enrollmentId, lessonId);
  await recordActivityEvent(auth, enrollmentId, { event_type: "lesson_completed", source_type: "lesson", source_id: lessonId }).catch(() => null);
  return result;
}

// ---------------------------------------------------------------------------
// Quiz experience (answers never leave the server before submission)
// ---------------------------------------------------------------------------

export async function getClassroomQuiz(auth: LmsAuth, enrollmentId: string, quizId: string) {
  const { enrollment, courseId } = await loadClassroom(auth, enrollmentId);
  const quizResult = await db(auth)
    .from("lms_quizzes")
    .select("id, course_id, lesson_id, title, description, passing_score, max_attempts, time_limit_minutes, is_required, questions:lms_quiz_questions(id, question_text, question_type, options_json, points, sort_order)")
    .eq("org_id", auth.orgId)
    .eq("course_id", courseId)
    .eq("id", quizId)
    .maybeSingle();
  if (quizResult.error) throw new Error(quizResult.error.message);
  const quiz = asRecord(quizResult.data);
  if (!quiz.id) throw new Error("Quiz not found");

  const attemptsResult = await db(auth)
    .from("lms_quiz_attempts")
    .select("id, attempt_number, score, passed, submitted_at")
    .eq("org_id", auth.orgId)
    .eq("enrollment_id", enrollmentId)
    .eq("quiz_id", quizId)
    .order("attempt_number", { ascending: true });
  if (attemptsResult.error) throw new Error(attemptsResult.error.message);
  const attempts = asRows(attemptsResult.data);

  const questions = asRows(quiz.questions)
    .sort((a, b) => numberValue(a.sort_order) - numberValue(b.sort_order))
    .map((question) => ({
      id: text(question.id),
      question_text: text(question.question_text),
      question_type: text(question.question_type),
      options_json: question.options_json ?? [],
      points: numberValue(question.points, 1),
    }));

  return {
    enrollment,
    quiz: {
      id: text(quiz.id),
      title: text(quiz.title),
      description: text(quiz.description) || null,
      passing_score: numberValue(quiz.passing_score, 70),
      max_attempts: numberValue(quiz.max_attempts, 3),
      time_limit_minutes: quiz.time_limit_minutes ? numberValue(quiz.time_limit_minutes) : null,
      is_required: quiz.is_required !== false,
      question_count: questions.length,
      total_points: questions.reduce((sum, q) => sum + q.points, 0),
    },
    questions,
    attempts,
    attemptsUsed: attempts.length,
    canRetake: attempts.length < numberValue(quiz.max_attempts, 3),
    passed: attempts.some((a) => a.passed === true),
    bestScore: attempts.reduce((max, a) => Math.max(max, numberValue(a.score)), 0),
  };
}

export async function submitClassroomQuiz(auth: LmsAuth, enrollmentId: string, quizId: string, answers: Record<string, unknown>) {
  const result = await submitQuizAttempt(auth, enrollmentId, quizId, answers);
  await recordActivityEvent(auth, enrollmentId, { event_type: "quiz_submitted", source_type: "quiz", source_id: quizId }).catch(() => null);
  return result;
}

// ---------------------------------------------------------------------------
// Project experience (tasks displayed as projects) + rubric read
// ---------------------------------------------------------------------------

export async function getClassroomProject(auth: LmsAuth, enrollmentId: string, taskId: string) {
  const { enrollment, courseId, employeeId } = await loadClassroom(auth, enrollmentId);
  const taskResult = await db(auth)
    .from("lms_tasks")
    .select("*")
    .eq("org_id", auth.orgId)
    .eq("course_id", courseId)
    .eq("id", taskId)
    .eq("status", "published")
    .maybeSingle();
  if (taskResult.error) throw new Error(taskResult.error.message);
  const task = asRecord(taskResult.data);
  if (!task.id) throw new Error("Project not found");

  const [rubricResult, submissionResult, configResult] = await Promise.all([
    db(auth).from("lms_project_rubrics").select("*, items:lms_project_rubric_items(*)").eq("org_id", auth.orgId).eq("task_id", taskId).maybeSingle(),
    db(auth).from("lms_task_submissions").select("*, reviews:lms_task_reviews(*)").eq("org_id", auth.orgId).eq("enrollment_id", enrollmentId).eq("task_id", taskId).eq("employee_id", employeeId).maybeSingle(),
    db(auth).from("lms_workspace_configs").select("*").eq("org_id", auth.orgId).eq("course_id", courseId).eq("task_id", taskId).maybeSingle(),
  ]);
  if (rubricResult.error) throw new Error(rubricResult.error.message);
  if (submissionResult.error) throw new Error(submissionResult.error.message);

  const rubric = asRecord(rubricResult.data);
  const rubricItems = asRows(rubric.items).sort((a, b) => numberValue(a.sort_order) - numberValue(b.sort_order));
  const submission = asRecord(submissionResult.data);
  const reviews = asRows(submission.reviews).sort((a, b) => String(b.reviewed_at).localeCompare(String(a.reviewed_at)));
  const latestReview = reviews[0] || null;

  let reviewItems: RecordMap[] = [];
  if (latestReview) {
    const reviewItemsResult = await db(auth)
      .from("lms_project_review_items")
      .select("*")
      .eq("org_id", auth.orgId)
      .eq("review_id", text(latestReview.id));
    if (reviewItemsResult.error) throw new Error(reviewItemsResult.error.message);
    reviewItems = asRows(reviewItemsResult.data);
  }

  const submissionSigned = await signIfStored(auth, submission.storage_path);

  await recordActivityEvent(auth, enrollmentId, { event_type: "project_opened", source_type: "task", source_id: taskId }).catch(() => null);

  return {
    enrollment,
    project: { ...task },
    rubric: rubric.id ? { ...rubric, items: rubricItems } : null,
    submission: submission.id ? { ...submission, signed_url: submissionSigned } : null,
    latestReview,
    reviewItems,
    workspaceConfig: asRecord(configResult.data).id ? configResult.data : null,
  };
}

export async function submitClassroomProject(auth: LmsAuth, enrollmentId: string, taskId: string, values: RecordMap) {
  const result = await submitTask(auth, enrollmentId, taskId, values);
  await recordActivityEvent(auth, enrollmentId, { event_type: "project_submitted", source_type: "task", source_id: taskId }).catch(() => null);
  return result;
}

// ---------------------------------------------------------------------------
// Workspace, resources, community, certificate
// ---------------------------------------------------------------------------

export async function getClassroomWorkspace(auth: LmsAuth, enrollmentId: string) {
  const { enrollment, courseId, employeeId } = await loadClassroom(auth, enrollmentId);
  const [tasksResult, submissionsResult, configsResult, resourcesResult] = await Promise.all([
    db(auth).from("lms_tasks").select("*").eq("org_id", auth.orgId).eq("course_id", courseId).eq("status", "published").order("created_at", { ascending: true }),
    db(auth).from("lms_task_submissions").select("*, reviews:lms_task_reviews(*)").eq("org_id", auth.orgId).eq("enrollment_id", enrollmentId).eq("employee_id", employeeId),
    db(auth).from("lms_workspace_configs").select("*").eq("org_id", auth.orgId).eq("course_id", courseId),
    db(auth).from("lms_course_resources").select("*").eq("org_id", auth.orgId).eq("course_id", courseId).eq("is_active", true).order("sort_order", { ascending: true }),
  ]);
  if (tasksResult.error) throw new Error(tasksResult.error.message);
  if (submissionsResult.error) throw new Error(submissionsResult.error.message);
  if (configsResult.error) throw new Error(configsResult.error.message);
  if (resourcesResult.error) throw new Error(resourcesResult.error.message);

  const submissionsByTask = new Map(asRows(submissionsResult.data).map((s) => [text(s.task_id), s]));
  const configByTask = new Map(asRows(configsResult.data).map((c) => [text(c.task_id), c]));

  const projects = asRows(tasksResult.data).map((task) => ({
    ...task,
    submission: submissionsByTask.get(text(task.id)) || null,
    workspaceConfig: configByTask.get(text(task.id)) || configByTask.get("") || null,
  }));

  return { enrollment, projects, resources: asRows(resourcesResult.data) };
}

export async function getClassroomResources(auth: LmsAuth, enrollmentId: string) {
  const { enrollment, courseId } = await loadClassroom(auth, enrollmentId);
  const result = await db(auth)
    .from("lms_course_resources")
    .select("*")
    .eq("org_id", auth.orgId)
    .eq("course_id", courseId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (result.error) throw new Error(result.error.message);
  const resources = [];
  for (const resource of asRows(result.data)) {
    resources.push({ ...resource, signed_url: text(resource.storage_path) ? await signIfStored(auth, resource.storage_path) : null });
  }
  return { enrollment, resources };
}

export async function getClassroomCommunity(auth: LmsAuth, enrollmentId: string) {
  const { enrollment, courseId } = await loadClassroom(auth, enrollmentId);
  const posts = await listCommunity(auth, courseId);
  return { enrollment, courseId, posts };
}

export async function getClassroomCertificate(auth: LmsAuth, enrollmentId: string) {
  const { enrollment, course, employeeId } = await loadClassroom(auth, enrollmentId);
  const result = await db(auth)
    .from("lms_certificates")
    .select("*, employee:employee_id(full_name, employee_code), organization:org_id(name)")
    .eq("org_id", auth.orgId)
    .eq("enrollment_id", enrollmentId)
    .eq("employee_id", employeeId)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  const certificate = asRecord(result.data);
  if (certificate.id) {
    await recordActivityEvent(auth, enrollmentId, { event_type: "certificate_viewed", source_type: "certificate", source_id: text(certificate.id) }).catch(() => null);
  }
  return { enrollment, course, certificate: certificate.id ? certificate : null, eligible: text(enrollment.status) === "completed" };
}

// ---------------------------------------------------------------------------
// Workspace state, notes, bookmarks, activity
// ---------------------------------------------------------------------------

export async function updateWorkspaceState(auth: LmsAuth, enrollmentId: string, values: RecordMap) {
  const { employeeId } = await loadClassroom(auth, enrollmentId);
  const payload = {
    org_id: auth.orgId,
    enrollment_id: enrollmentId,
    employee_id: employeeId,
    last_lesson_id: optionalText(values.last_lesson_id),
    last_quiz_id: optionalText(values.last_quiz_id),
    last_task_id: optionalText(values.last_task_id),
    last_route: optionalText(values.last_route),
    current_tab: optionalText(values.current_tab),
    state_json: values.state_json && typeof values.state_json === "object" ? values.state_json : {},
    updated_at: nowIso(),
  };
  const result = await db(auth)
    .from("lms_learner_workspace_state")
    .upsert(payload as never, { onConflict: "org_id,enrollment_id,employee_id" })
    .select()
    .single();
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export async function listLearnerNotes(auth: LmsAuth, enrollmentId: string) {
  const { employeeId } = await loadClassroom(auth, enrollmentId);
  const result = await db(auth)
    .from("lms_learner_notes")
    .select("*")
    .eq("org_id", auth.orgId)
    .eq("enrollment_id", enrollmentId)
    .eq("employee_id", employeeId)
    .order("created_at", { ascending: false });
  if (result.error) throw new Error(result.error.message);
  return result.data ?? [];
}

export async function createLearnerNote(auth: LmsAuth, enrollmentId: string, values: RecordMap) {
  const { employeeId, courseId } = await loadClassroom(auth, enrollmentId);
  const payload = {
    org_id: auth.orgId,
    enrollment_id: enrollmentId,
    employee_id: employeeId,
    course_id: courseId,
    lesson_id: optionalText(values.lesson_id),
    task_id: optionalText(values.task_id),
    quiz_id: optionalText(values.quiz_id),
    title: optionalText(values.title),
    body: text(values.body),
    is_private: values.is_private !== false,
  };
  if (!payload.body) throw new Error("Note body is required.");
  const result = await db(auth).from("lms_learner_notes").insert(payload as never).select().single();
  if (result.error) throw new Error(result.error.message);
  await recordActivityEvent(auth, enrollmentId, { event_type: "note_created", source_type: "lesson", source_id: optionalText(values.lesson_id) }).catch(() => null);
  return result.data;
}

async function assertOwnsNote(auth: LmsAuth, noteId: string) {
  const employeeId = await getEmployeeId(auth);
  const result = await db(auth).from("lms_learner_notes").select("id, employee_id").eq("org_id", auth.orgId).eq("id", noteId).maybeSingle();
  if (result.error) throw new Error(result.error.message);
  const note = asRecord(result.data);
  if (!note.id || text(note.employee_id) !== employeeId) throw new Error("Forbidden");
}

export async function updateLearnerNote(auth: LmsAuth, noteId: string, values: RecordMap) {
  await assertOwnsNote(auth, noteId);
  const payload: RecordMap = { updated_at: nowIso() };
  if (values.title !== undefined) payload.title = optionalText(values.title);
  if (values.body !== undefined) payload.body = text(values.body);
  const result = await db(auth).from("lms_learner_notes").update(payload as never).eq("org_id", auth.orgId).eq("id", noteId).select().single();
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export async function deleteLearnerNote(auth: LmsAuth, noteId: string) {
  await assertOwnsNote(auth, noteId);
  const result = await db(auth).from("lms_learner_notes").delete().eq("org_id", auth.orgId).eq("id", noteId);
  if (result.error) throw new Error(result.error.message);
  return { success: true };
}

export async function listLearnerBookmarks(auth: LmsAuth, enrollmentId: string) {
  const { employeeId } = await loadClassroom(auth, enrollmentId);
  const result = await db(auth)
    .from("lms_learner_bookmarks")
    .select("*")
    .eq("org_id", auth.orgId)
    .eq("enrollment_id", enrollmentId)
    .eq("employee_id", employeeId)
    .order("created_at", { ascending: false });
  if (result.error) throw new Error(result.error.message);
  return result.data ?? [];
}

export async function createLearnerBookmark(auth: LmsAuth, enrollmentId: string, values: RecordMap) {
  const { employeeId, courseId } = await loadClassroom(auth, enrollmentId);
  const payload = {
    org_id: auth.orgId,
    enrollment_id: enrollmentId,
    employee_id: employeeId,
    course_id: courseId,
    lesson_id: optionalText(values.lesson_id),
    task_id: optionalText(values.task_id),
    quiz_id: optionalText(values.quiz_id),
    bookmark_type: text(values.bookmark_type) || "lesson",
    label: optionalText(values.label),
  };
  const result = await db(auth).from("lms_learner_bookmarks").insert(payload as never).select().single();
  if (result.error) throw new Error(result.error.message);
  await recordActivityEvent(auth, enrollmentId, { event_type: "bookmark_created", source_type: payload.bookmark_type, source_id: payload.lesson_id || payload.task_id || payload.quiz_id }).catch(() => null);
  return result.data;
}

export async function deleteLearnerBookmark(auth: LmsAuth, bookmarkId: string) {
  const employeeId = await getEmployeeId(auth);
  const existing = await db(auth).from("lms_learner_bookmarks").select("id, employee_id").eq("org_id", auth.orgId).eq("id", bookmarkId).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (text(asRecord(existing.data).employee_id) !== employeeId) throw new Error("Forbidden");
  const result = await db(auth).from("lms_learner_bookmarks").delete().eq("org_id", auth.orgId).eq("id", bookmarkId);
  if (result.error) throw new Error(result.error.message);
  return { success: true };
}

export async function recordActivityEvent(auth: LmsAuth, enrollmentId: string, event: RecordMap) {
  const employeeId = await getEmployeeId(auth);
  if (!employeeId) return null;
  const enrollmentResult = await db(auth)
    .from("lms_enrollments")
    .select("id, course_id, employee_id")
    .eq("org_id", auth.orgId)
    .eq("id", enrollmentId)
    .eq("employee_id", employeeId)
    .maybeSingle();
  if (enrollmentResult.error) throw new Error(enrollmentResult.error.message);
  const enrollment = asRecord(enrollmentResult.data);
  if (!enrollment.id) throw new Error("Enrollment not found for learner.");
  const eventType = text(event.event_type);
  if (!eventType) return null;
  const result = await db(auth).from("lms_learner_activity_events").insert({
    org_id: auth.orgId,
    enrollment_id: enrollmentId,
    employee_id: employeeId,
    course_id: text(enrollment.course_id),
    event_type: eventType,
    source_type: optionalText(event.source_type),
    source_id: optionalText(event.source_id),
    metadata_json: event.metadata_json && typeof event.metadata_json === "object" ? event.metadata_json : {},
  } as never).select().single();
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export async function recalculateClassroomEnrollment(auth: LmsAuth, enrollmentId: string) {
  await getEnrollmentForLearner(auth, enrollmentId);
  return recalculateEnrollment(auth, enrollmentId);
}
