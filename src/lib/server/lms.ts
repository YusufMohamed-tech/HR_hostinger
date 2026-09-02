/* eslint-disable @typescript-eslint/no-explicit-any */
import type { TenantAuthContext } from "@/lib/server/tenant-context";
import { inspectUpload } from "@/lib/server/upload-security";
import { safeExternalUrl, sanitizeRichTextHtml } from "@/lib/rich-text";
import { createObjectAccessUrl, storeObject } from "@/lib/server/file-storage";

type Db = {
  from: (table: string) => any;
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  storage: {
    from: (bucket: string) => any;
  };
};

type LmsAuth = TenantAuthContext;
type RecordMap = Record<string, unknown>;

const managementRoles = new Set(["admin", "hr_admin", "super_admin", "superadmin"]);
const elevatedRoles = new Set(["admin", "hr_admin", "training_manager", "super_admin", "superadmin"]);
const allowedLmsMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/webm",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
]);

const maxLmsUploadBytes = 100 * 1024 * 1024;

function db(auth: LmsAuth): Db {
  return auth.admin as unknown as Db;
}

function asRecord(value: unknown): RecordMap {
  return value && typeof value === "object" ? value as RecordMap : {};
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

function roleKey(auth: LmsAuth) {
  return String(auth.role || "").trim().toLowerCase();
}

export function isManagement(auth: LmsAuth) {
  return managementRoles.has(roleKey(auth));
}

export function isElevated(auth: LmsAuth) {
  return elevatedRoles.has(roleKey(auth));
}

export function isTrainingManager(auth: LmsAuth) {
  return roleKey(auth) === "training_manager";
}

function safeFilename(name: string) {
  return name.replace(/[^\w.\-()[\]\u0600-\u06FF ]+/g, "_").slice(0, 160) || "lms-file";
}

function stripQuizAnswers(course: RecordMap | null) {
  if (!course) return course;
  const stripQuestion = (question: RecordMap) => {
    const sanitized = { ...question };
    delete sanitized.correct_answer_json;
    return sanitized;
  };
  const sections = asRows(course.sections);
  course.sections = sections.map((section) => {
    const lessons = asRows(section.lessons);
    section.lessons = lessons.map((lesson) => {
      const quizzes = asRows(lesson.quizzes);
      lesson.quizzes = quizzes.map((quiz) => ({
        ...quiz,
        questions: asRows(quiz.questions).map(stripQuestion),
      }));
      return lesson;
    });
    return section;
  });
  course.quizzes = asRows(course.quizzes).map((quiz) => ({
    ...quiz,
    questions: asRows(quiz.questions).map(stripQuestion),
  }));
  return course;
}

export async function getEmployeeId(auth: LmsAuth) {
  if (auth.employeeId) return auth.employeeId;
  const result = await db(auth)
    .from("employees")
    .select("id")
    .eq("org_id", auth.orgId)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return text(asRecord(result.data).id);
}

async function getEmployeeUserId(auth: LmsAuth, employeeId: string) {
  const result = await db(auth)
    .from("employees")
    .select("id, user_id, full_name")
    .eq("org_id", auth.orgId)
    .eq("id", employeeId)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return asRecord(result.data);
}

async function isTrainingManagerForEmployee(auth: LmsAuth, employeeId: string) {
  if (isManagement(auth)) return true;
  if (!isTrainingManager(auth)) return false;
  const managerEmployeeId = await getEmployeeId(auth);
  if (!managerEmployeeId) return false;
  const result = await db(auth)
    .from("employees")
    .select("id, manager_id, department:department_id(manager_employee_id), location:location_id(manager_employee_id)")
    .eq("org_id", auth.orgId)
    .eq("id", employeeId)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  const employee = asRecord(result.data);
  const department = asRecord(employee.department);
  const location = asRecord(employee.location);
  return (
    text(employee.manager_id) === managerEmployeeId ||
    text(department.manager_employee_id) === managerEmployeeId ||
    text(location.manager_employee_id) === managerEmployeeId
  );
}

async function getInstructor(auth: LmsAuth, courseId: string) {
  const employeeId = await getEmployeeId(auth);
  if (!employeeId) return null;
  const result = await db(auth)
    .from("lms_course_instructors")
    .select("*")
    .eq("org_id", auth.orgId)
    .eq("course_id", courseId)
    .eq("employee_id", employeeId)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return result.data ? asRecord(result.data) : null;
}

export async function canManageCourse(auth: LmsAuth, courseId: string, permission: "can_edit_content" | "can_review_tasks" | "can_moderate_community" | "any" = "can_edit_content") {
  if (isManagement(auth)) return true;
  const instructor = await getInstructor(auth, courseId);
  if (instructor) {
    if (permission === "any") return true;
    if (instructor[permission] === true) return true;
  }
  if (!isTrainingManager(auth)) return false;
  const result = await db(auth)
    .from("lms_courses")
    .select("id, created_by")
    .eq("org_id", auth.orgId)
    .eq("id", courseId)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return text(asRecord(result.data).created_by) === auth.user.id;
}

async function assertManageCourse(auth: LmsAuth, courseId: string, permission?: "can_edit_content" | "can_review_tasks" | "can_moderate_community" | "any") {
  if (!(await canManageCourse(auth, courseId, permission))) {
    throw new Error("Forbidden");
  }
}

async function hasActiveEnrollmentForCourse(auth: LmsAuth, courseId: string, employeeId?: string) {
  const learnerEmployeeId = employeeId || await getEmployeeId(auth);
  if (!learnerEmployeeId) return false;
  const result = await db(auth)
    .from("lms_enrollments")
    .select("id")
    .eq("org_id", auth.orgId)
    .eq("course_id", courseId)
    .eq("employee_id", learnerEmployeeId)
    .neq("status", "cancelled")
    .limit(1);
  if (result.error) throw new Error(result.error.message);
  return asRows(result.data).length > 0;
}

async function canAccessPublishedCourse(auth: LmsAuth, course: RecordMap) {
  if (await canManageCourse(auth, text(course.id), "any")) return true;
  if (text(course.status) !== "published") return false;
  if (text(course.visibility) === "catalog") return true;
  return hasActiveEnrollmentForCourse(auth, text(course.id));
}

async function canParticipateInCourse(auth: LmsAuth, courseId: string) {
  if (await canManageCourse(auth, courseId, "any")) return true;
  return hasActiveEnrollmentForCourse(auth, courseId);
}

async function assertElevated(auth: LmsAuth) {
  if (!isElevated(auth)) throw new Error("Forbidden");
}

export async function listLmsCategories(auth: LmsAuth) {
  const result = await db(auth)
    .from("lms_categories")
    .select("*")
    .eq("org_id", auth.orgId)
    .order("name", { ascending: true });
  if (result.error) throw new Error(result.error.message);
  return result.data ?? [];
}

export async function upsertLmsCategory(auth: LmsAuth, values: RecordMap, categoryId?: string) {
  await assertElevated(auth);
  const payload = {
    org_id: auth.orgId,
    name: text(values.name),
    description: optionalText(values.description),
    color: optionalText(values.color),
    is_active: values.is_active !== false,
  };
  const query = categoryId
    ? db(auth).from("lms_categories").update(payload as never).eq("org_id", auth.orgId).eq("id", categoryId)
    : db(auth).from("lms_categories").insert(payload as never);
  const result = await query.select().single();
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export async function archiveLmsCategory(auth: LmsAuth, categoryId: string) {
  await assertElevated(auth);
  const result = await db(auth)
    .from("lms_categories")
    .update({ is_active: false } as never)
    .eq("org_id", auth.orgId)
    .eq("id", categoryId)
    .select()
    .single();
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export async function listLmsCourses(auth: LmsAuth, mode = "manage") {
  const employeeId = await getEmployeeId(auth);
  if (mode === "catalog") {
    const result = await db(auth)
      .from("lms_courses")
      .select("*, category:category_id(name, color)")
      .eq("org_id", auth.orgId)
      .eq("status", "published")
      .eq("visibility", "catalog")
      .order("updated_at", { ascending: false });
    if (result.error) throw new Error(result.error.message);
    return result.data ?? [];
  }
  if (mode === "my") {
    if (!employeeId) return [];
    const result = await db(auth)
      .from("lms_enrollments")
      .select("*, course:course_id(*, category:category_id(name, color))")
      .eq("org_id", auth.orgId)
      .eq("employee_id", employeeId)
      .neq("status", "cancelled")
      .order("assigned_at", { ascending: false });
    if (result.error) throw new Error(result.error.message);
    return asRows(result.data).filter((row) => text(asRecord(row.course).status) === "published");
  }

  let query = db(auth)
    .from("lms_courses")
    .select("*, category:category_id(name, color), instructors:lms_course_instructors(id, employee_id, instructor_type, can_edit_content, can_review_tasks, can_moderate_community, employee:employee_id(full_name))")
    .eq("org_id", auth.orgId)
    .order("updated_at", { ascending: false });

  if (!isManagement(auth) && isTrainingManager(auth)) {
    query = query.or(`created_by.eq.${auth.user.id}`);
  }

  const result = await query;
  if (result.error) throw new Error(result.error.message);

  if (!isManagement(auth) && !isTrainingManager(auth)) {
    if (!employeeId) return [];
    const ownInstructor = await db(auth)
      .from("lms_course_instructors")
      .select("course_id")
      .eq("org_id", auth.orgId)
      .eq("employee_id", employeeId);
    if (ownInstructor.error) throw new Error(ownInstructor.error.message);
    const courseIds = new Set(asRows(ownInstructor.data).map((row) => text(row.course_id)));
    return asRows(result.data).filter((course) => courseIds.has(text(course.id)));
  }

  return result.data ?? [];
}

export async function getLmsCourse(auth: LmsAuth, courseId: string, options: { learner?: boolean } = {}) {
  const result = await db(auth)
    .from("lms_courses")
    .select(`
      *,
      category:category_id(*),
      instructors:lms_course_instructors(*, employee:employee_id(id, full_name, user_id)),
      sections:lms_course_sections(*, lessons:lms_lessons(*, attachments:lms_lesson_attachments(*), quizzes:lms_quizzes(*, questions:lms_quiz_questions(*)))),
      quizzes:lms_quizzes(*, questions:lms_quiz_questions(*)),
      tasks:lms_tasks(*),
      announcements:lms_course_announcements(*),
      feedback:lms_course_feedback(*)
    `)
    .eq("org_id", auth.orgId)
    .eq("id", courseId)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  const course = result.data ? asRecord(result.data) : null;
  if (!course) throw new Error("Course not found");

  // Flatten lessons from sections for consumers that read course.lessons directly
  const courseSections = asRows(course.sections);
  course.lessons = courseSections.flatMap((section) => asRows(section.lessons));

  const canManage = await canManageCourse(auth, courseId, "any");
  if (!canManage && !(await canAccessPublishedCourse(auth, course))) throw new Error("Forbidden");
  if (options.learner && !canManage) return stripQuizAnswers(course);
  return course;
}

export async function upsertLmsCourse(auth: LmsAuth, values: RecordMap, courseId?: string) {
  if (courseId) await assertManageCourse(auth, courseId, "can_edit_content");
  else await assertElevated(auth);

  const payload: RecordMap = {
    org_id: auth.orgId,
    category_id: optionalText(values.category_id),
    title: text(values.title),
    description: optionalText(values.description),
    thumbnail_path: optionalText(values.thumbnail_path),
    visibility: text(values.visibility) || "assigned_only",
    difficulty: text(values.difficulty) || "beginner",
    estimated_minutes: numberValue(values.estimated_minutes, 0),
    passing_score: numberValue(values.passing_score, 70),
    requires_quiz_pass: values.requires_quiz_pass === true,
    requires_task_pass: values.requires_task_pass === true,
  };
  if (!courseId) payload.created_by = auth.user.id;
  if (values.status) payload.status = text(values.status);

  const query = courseId
    ? db(auth).from("lms_courses").update(payload as never).eq("org_id", auth.orgId).eq("id", courseId)
    : db(auth).from("lms_courses").insert(payload as never);
  const result = await query.select().single();
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export async function archiveLmsCourse(auth: LmsAuth, courseId: string) {
  await assertManageCourse(auth, courseId, "can_edit_content");
  const result = await db(auth)
    .from("lms_courses")
    .update({ status: "archived", archived_at: new Date().toISOString() } as never)
    .eq("org_id", auth.orgId)
    .eq("id", courseId)
    .select()
    .single();
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export async function publishLmsCourse(auth: LmsAuth, courseId: string) {
  await assertManageCourse(auth, courseId, "can_edit_content");
  const result = await db(auth)
    .from("lms_courses")
    .update({ status: "published", published_at: new Date().toISOString(), archived_at: null } as never)
    .eq("org_id", auth.orgId)
    .eq("id", courseId)
    .select()
    .single();
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export async function listCourseInstructors(auth: LmsAuth, courseId: string) {
  await assertManageCourse(auth, courseId, "any");
  const result = await db(auth)
    .from("lms_course_instructors")
    .select("*, employee:employee_id(id, full_name, email, job_title)")
    .eq("org_id", auth.orgId)
    .eq("course_id", courseId)
    .order("created_at", { ascending: true });
  if (result.error) throw new Error(result.error.message);
  return result.data ?? [];
}

export async function upsertCourseInstructor(auth: LmsAuth, courseId: string, values: RecordMap, instructorId?: string) {
  await assertElevated(auth);
  const employeeId = text(values.employee_id);
  if (isTrainingManager(auth) && !(await isTrainingManagerForEmployee(auth, employeeId))) {
    throw new Error("You can assign instructors only within your scope.");
  }
  const employee = await getEmployeeUserId(auth, employeeId);
  if (!employee.id) throw new Error("Instructor employee was not found.");
  const payload = {
    org_id: auth.orgId,
    course_id: courseId,
    employee_id: employeeId,
    instructor_type: text(values.instructor_type) || "primary_instructor",
    can_edit_content: values.can_edit_content !== false,
    can_review_tasks: values.can_review_tasks !== false,
    can_moderate_community: values.can_moderate_community !== false,
    assigned_by: auth.user.id,
  };
  const query = instructorId
    ? db(auth).from("lms_course_instructors").update(payload as never).eq("org_id", auth.orgId).eq("id", instructorId)
    : db(auth).from("lms_course_instructors").upsert(payload as never, { onConflict: "org_id,course_id,employee_id" });
  const result = await query.select().single();
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export async function removeCourseInstructor(auth: LmsAuth, courseId: string, instructorId: string) {
  await assertElevated(auth);
  const result = await db(auth)
    .from("lms_course_instructors")
    .delete()
    .eq("org_id", auth.orgId)
    .eq("course_id", courseId)
    .eq("id", instructorId);
  if (result.error) throw new Error(result.error.message);
  return { success: true };
}

export async function upsertCourseSection(auth: LmsAuth, courseId: string, values: RecordMap, sectionId?: string) {
  await assertManageCourse(auth, courseId, "can_edit_content");
  const payload = {
    org_id: auth.orgId,
    course_id: courseId,
    title: text(values.title),
    description: optionalText(values.description),
    sort_order: numberValue(values.sort_order, 0),
  };
  const query = sectionId
    ? db(auth).from("lms_course_sections").update(payload as never).eq("org_id", auth.orgId).eq("id", sectionId)
    : db(auth).from("lms_course_sections").insert(payload as never);
  const result = await query.select().single();
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export async function upsertCourseLesson(auth: LmsAuth, courseId: string, values: RecordMap, lessonId?: string) {
  await assertManageCourse(auth, courseId, "can_edit_content");
  const requestedContentUrl = text(values.content_url);
  const contentUrl = safeExternalUrl(requestedContentUrl);
  if (requestedContentUrl && !contentUrl) {
    throw new Error("Lesson content URL must use HTTP or HTTPS.");
  }
  const payload = {
    org_id: auth.orgId,
    course_id: courseId,
    section_id: optionalText(values.section_id),
    title: text(values.title),
    description: optionalText(values.description),
    lesson_type: text(values.lesson_type) || "text",
    content: optionalText(sanitizeRichTextHtml(text(values.content))),
    content_url: contentUrl || null,
    storage_path: optionalText(values.storage_path),
    duration_minutes: numberValue(values.duration_minutes, 0),
    sort_order: numberValue(values.sort_order, 0),
    is_required: values.is_required !== false,
    is_preview: values.is_preview === true,
    is_active: values.is_active !== false,
    created_by: auth.user.id,
  };
  const query = lessonId
    ? db(auth).from("lms_lessons").update(payload as never).eq("org_id", auth.orgId).eq("id", lessonId)
    : db(auth).from("lms_lessons").insert(payload as never);
  const result = await query.select().single();
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export async function updateCourseLessonById(auth: LmsAuth, lessonId: string, values: RecordMap) {
  const current = await db(auth).from("lms_lessons").select("course_id").eq("org_id", auth.orgId).eq("id", lessonId).maybeSingle();
  if (current.error) throw new Error(current.error.message);
  const courseId = text(asRecord(current.data).course_id);
  if (!courseId) throw new Error("Lesson not found");
  return upsertCourseLesson(auth, courseId, values, lessonId);
}

export async function archiveCourseLesson(auth: LmsAuth, lessonId: string) {
  const lessonResult = await db(auth).from("lms_lessons").select("course_id").eq("org_id", auth.orgId).eq("id", lessonId).maybeSingle();
  if (lessonResult.error) throw new Error(lessonResult.error.message);
  const courseId = text(asRecord(lessonResult.data).course_id);
  await assertManageCourse(auth, courseId, "can_edit_content");
  const result = await db(auth).from("lms_lessons").update({ is_active: false } as never).eq("org_id", auth.orgId).eq("id", lessonId).select().single();
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export async function upsertCourseQuiz(auth: LmsAuth, courseId: string, values: RecordMap, quizId?: string) {
  await assertManageCourse(auth, courseId, "can_edit_content");
  const payload = {
    org_id: auth.orgId,
    course_id: courseId,
    lesson_id: optionalText(values.lesson_id),
    title: text(values.title),
    description: optionalText(values.description),
    passing_score: numberValue(values.passing_score, 70),
    max_attempts: Math.max(1, numberValue(values.max_attempts, 3)),
    time_limit_minutes: values.time_limit_minutes ? numberValue(values.time_limit_minutes) : null,
    is_required: values.is_required !== false,
    is_active: values.is_active !== false,
    created_by: auth.user.id,
  };
  const query = quizId
    ? db(auth).from("lms_quizzes").update(payload as never).eq("org_id", auth.orgId).eq("id", quizId)
    : db(auth).from("lms_quizzes").insert(payload as never);
  const result = await query.select().single();
  if (result.error) throw new Error(result.error.message);
  const savedQuiz = asRecord(result.data);
  const questions = Array.isArray(values.questions) ? values.questions.map(asRecord) : [];
  for (let index = 0; index < questions.length; index += 1) {
    const question = questions[index];
    const questionPayload = {
      org_id: auth.orgId,
      quiz_id: text(savedQuiz.id),
      question_text: text(question.question_text),
      question_type: text(question.question_type) || "single_choice",
      options_json: question.options_json ?? [],
      correct_answer_json: question.correct_answer_json ?? null,
      points: numberValue(question.points, 1),
      sort_order: numberValue(question.sort_order, index),
    };
    const questionId = text(question.id);
    const questionResult = questionId
      ? await db(auth).from("lms_quiz_questions").update(questionPayload as never).eq("org_id", auth.orgId).eq("id", questionId)
      : await db(auth).from("lms_quiz_questions").insert(questionPayload as never);
    if (questionResult.error) throw new Error(questionResult.error.message);
  }
  return getLmsCourse(auth, courseId);
}

export async function updateCourseQuizById(auth: LmsAuth, quizId: string, values: RecordMap) {
  const current = await db(auth).from("lms_quizzes").select("course_id").eq("org_id", auth.orgId).eq("id", quizId).maybeSingle();
  if (current.error) throw new Error(current.error.message);
  const courseId = text(asRecord(current.data).course_id);
  if (!courseId) throw new Error("Quiz not found");
  return upsertCourseQuiz(auth, courseId, values, quizId);
}

export async function archiveCourseQuiz(auth: LmsAuth, quizId: string) {
  const quizResult = await db(auth).from("lms_quizzes").select("course_id").eq("org_id", auth.orgId).eq("id", quizId).maybeSingle();
  if (quizResult.error) throw new Error(quizResult.error.message);
  const courseId = text(asRecord(quizResult.data).course_id);
  await assertManageCourse(auth, courseId, "can_edit_content");
  const result = await db(auth).from("lms_quizzes").update({ is_active: false } as never).eq("org_id", auth.orgId).eq("id", quizId).select().single();
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export async function upsertCourseTask(auth: LmsAuth, courseId: string, values: RecordMap, taskId?: string) {
  await assertManageCourse(auth, courseId, "can_edit_content");
  const payload = {
    org_id: auth.orgId,
    course_id: courseId,
    lesson_id: optionalText(values.lesson_id),
    title: text(values.title),
    description: optionalText(values.description),
    task_type: text(values.task_type) || "text_response",
    instructions: optionalText(values.instructions),
    due_date: optionalText(values.due_date),
    max_score: numberValue(values.max_score, 100),
    pass_score: numberValue(values.pass_score, 70),
    is_required: values.is_required !== false,
    allow_resubmission: values.allow_resubmission !== false,
    late_submission_allowed: values.late_submission_allowed !== false,
    status: text(values.status) || "draft",
    created_by: auth.user.id,
  };
  const query = taskId
    ? db(auth).from("lms_tasks").update(payload as never).eq("org_id", auth.orgId).eq("id", taskId)
    : db(auth).from("lms_tasks").insert(payload as never);
  const result = await query.select().single();
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export async function updateCourseTaskById(auth: LmsAuth, taskId: string, values: RecordMap) {
  const current = await db(auth).from("lms_tasks").select("course_id").eq("org_id", auth.orgId).eq("id", taskId).maybeSingle();
  if (current.error) throw new Error(current.error.message);
  const courseId = text(asRecord(current.data).course_id);
  if (!courseId) throw new Error("Task not found");
  return upsertCourseTask(auth, courseId, values, taskId);
}

export async function archiveCourseTask(auth: LmsAuth, taskId: string) {
  const taskResult = await db(auth).from("lms_tasks").select("course_id").eq("org_id", auth.orgId).eq("id", taskId).maybeSingle();
  if (taskResult.error) throw new Error(taskResult.error.message);
  const courseId = text(asRecord(taskResult.data).course_id);
  await assertManageCourse(auth, courseId, "can_edit_content");
  const result = await db(auth).from("lms_tasks").update({ status: "archived" } as never).eq("org_id", auth.orgId).eq("id", taskId).select().single();
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

async function loadAssignmentTargets(auth: LmsAuth, values: RecordMap) {
  const assignmentType = text(values.assignment_type);
  const targetId = text(values.target_id);
  let query = db(auth)
    .from("employees")
    .select("id, user_id, full_name, manager_id, department_id, location_id, status, department:department_id(manager_employee_id), location:location_id(manager_employee_id)")
    .eq("org_id", auth.orgId)
    .ilike("status", "active");

  if (assignmentType !== "all" && !targetId) throw new Error("Select an assignment target.");
  if (assignmentType === "employee") query = query.eq("id", targetId);
  if (assignmentType === "department") query = query.eq("department_id", targetId);
  if (assignmentType === "location" || assignmentType === "team") query = query.eq("location_id", targetId);
  if (assignmentType === "role") query = query.ilike("job_title", `%${targetId}%`);
  const result = await query;
  if (result.error) throw new Error(result.error.message);
  let employees = asRows(result.data);
  if (isTrainingManager(auth)) {
    const scoped: RecordMap[] = [];
    for (const employee of employees) {
      if (await isTrainingManagerForEmployee(auth, text(employee.id))) scoped.push(employee);
    }
    employees = scoped;
  }
  return employees;
}

export async function assignLmsLearning(auth: LmsAuth, values: RecordMap) {
  await assertElevated(auth);
  const courseId = text(values.course_id);
  const learningPathId = text(values.learning_path_id);
  let courseIds = courseId ? [courseId] : [];
  if (learningPathId) {
    const pathCourses = await db(auth)
      .from("lms_learning_path_courses")
      .select("course_id")
      .eq("org_id", auth.orgId)
      .eq("learning_path_id", learningPathId)
      .order("sort_order", { ascending: true });
    if (pathCourses.error) throw new Error(pathCourses.error.message);
    courseIds = asRows(pathCourses.data).map((row) => text(row.course_id)).filter(Boolean);
  }
  if (courseIds.length === 0) throw new Error("Select a course or learning path with courses.");

  const employees = await loadAssignmentTargets(auth, values);
  if (employees.length === 0) throw new Error("Select at least one active employee for this assignment.");

  const result = await db(auth).rpc("assign_lms_learning_atomic", {
    p_org_id: auth.orgId,
    p_actor_user_id: auth.user.id,
    p_request_id: auth.requestId,
    p_command_id: text(values.command_id) || crypto.randomUUID(),
    p_course_id: courseId || null,
    p_learning_path_id: learningPathId || null,
    p_assignment_type: text(values.assignment_type),
    p_target_id: optionalText(values.target_id),
    p_due_date: optionalText(values.due_date),
    p_course_ids: courseIds,
    p_employee_ids: employees.map((employee) => text(employee.id)).filter(Boolean),
  });
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export async function getLearnerDashboard(auth: LmsAuth) {
  const [assigned, catalog, certificates] = await Promise.all([
    listLmsCourses(auth, "my"),
    listLmsCourses(auth, "catalog"),
    listLearnerCertificates(auth),
  ]);
  const assignedRows = asRows(assigned);
  return {
    assigned,
    catalog,
    certificates,
    stats: {
      assigned: assignedRows.length,
      inProgress: assignedRows.filter((row) => row.status === "in_progress").length,
      completed: assignedRows.filter((row) => row.status === "completed").length,
      overdue: assignedRows.filter((row) => row.status === "overdue").length,
    },
  };
}

export async function getEnrollmentDetail(auth: LmsAuth, enrollmentId: string) {
  const result = await db(auth)
    .from("lms_enrollments")
    .select("*, employee:employee_id(id, full_name, user_id), course:course_id(*, category:category_id(*))")
    .eq("org_id", auth.orgId)
    .eq("id", enrollmentId)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  const enrollment = asRecord(result.data);
  if (!enrollment.id) throw new Error("Enrollment not found");
  const employeeId = text(enrollment.employee_id);
  if (employeeId !== await getEmployeeId(auth) && !(await isTrainingManagerForEmployee(auth, employeeId)) && !isManagement(auth)) {
    const courseId = text(enrollment.course_id);
    if (!(await canManageCourse(auth, courseId, "any"))) throw new Error("Forbidden");
  }
  const course = await getLmsCourse(auth, text(enrollment.course_id), { learner: true });
  const [progress, attempts, submissions, certificates] = await Promise.all([
    db(auth).from("lms_lesson_progress").select("*").eq("org_id", auth.orgId).eq("enrollment_id", enrollmentId),
    db(auth).from("lms_quiz_attempts").select("*").eq("org_id", auth.orgId).eq("enrollment_id", enrollmentId).order("attempt_number", { ascending: true }),
    db(auth).from("lms_task_submissions").select("*, reviews:lms_task_reviews(*)").eq("org_id", auth.orgId).eq("enrollment_id", enrollmentId),
    db(auth).from("lms_certificates").select("*").eq("org_id", auth.orgId).eq("enrollment_id", enrollmentId),
  ]);
  for (const item of [progress, attempts, submissions, certificates]) {
    if (item.error) throw new Error(item.error.message);
  }
  return {
    enrollment,
    course,
    progress: progress.data ?? [],
    attempts: attempts.data ?? [],
    submissions: submissions.data ?? [],
    certificates: certificates.data ?? [],
  };
}

export async function getEnrollmentForLearner(auth: LmsAuth, enrollmentId: string) {
  const employeeId = await getEmployeeId(auth);
  const result = await db(auth)
    .from("lms_enrollments")
    .select("*")
    .eq("org_id", auth.orgId)
    .eq("id", enrollmentId)
    .eq("employee_id", employeeId)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  const enrollment = asRecord(result.data);
  if (!enrollment.id) throw new Error("Enrollment not found for learner.");
  return enrollment;
}

export async function completeLesson(auth: LmsAuth, enrollmentId: string, lessonId: string) {
  const result = await db(auth).rpc("complete_lms_lesson", {
    p_org_id: auth.orgId,
    p_actor_user_id: auth.user.id,
    p_request_id: auth.requestId,
    p_enrollment_id: enrollmentId,
    p_lesson_id: lessonId,
  });
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export async function submitQuizAttempt(auth: LmsAuth, enrollmentId: string, quizId: string, answers: Record<string, unknown>) {
  const result = await db(auth).rpc("submit_lms_quiz_attempt", {
    p_org_id: auth.orgId,
    p_actor_user_id: auth.user.id,
    p_request_id: auth.requestId,
    p_enrollment_id: enrollmentId,
    p_quiz_id: quizId,
    p_answers: answers,
  });
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export async function submitTask(auth: LmsAuth, enrollmentId: string, taskId: string, values: RecordMap) {
  const enrollment = await getEnrollmentForLearner(auth, enrollmentId);
  const taskResult = await db(auth)
    .from("lms_tasks")
    .select("*")
    .eq("org_id", auth.orgId)
    .eq("id", taskId)
    .eq("course_id", text(enrollment.course_id))
    .eq("status", "published")
    .maybeSingle();
  if (taskResult.error) throw new Error(taskResult.error.message);
  const task = asRecord(taskResult.data);
  if (!task.id) throw new Error("Task not found");
  const now = new Date();
  const dueDate = task.due_date ? new Date(String(task.due_date)) : null;
  const status = dueDate && now > dueDate && task.late_submission_allowed !== true ? "late" : "submitted";
  const payload = {
    org_id: auth.orgId,
    task_id: taskId,
    course_id: text(enrollment.course_id),
    enrollment_id: enrollmentId,
    employee_id: text(enrollment.employee_id),
    submission_text: optionalText(values.submission_text),
    submission_url: optionalText(values.submission_url),
    storage_path: optionalText(values.storage_path),
    status,
    submitted_at: now.toISOString(),
  };
  const result = await db(auth).from("lms_task_submissions").upsert(payload as never, {
    onConflict: "org_id,task_id,enrollment_id,employee_id",
  }).select().single();
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export async function listTaskSubmissions(auth: LmsAuth, taskId: string) {
  const taskResult = await db(auth).from("lms_tasks").select("course_id").eq("org_id", auth.orgId).eq("id", taskId).maybeSingle();
  if (taskResult.error) throw new Error(taskResult.error.message);
  const courseId = text(asRecord(taskResult.data).course_id);
  if (!(await canManageCourse(auth, courseId, "can_review_tasks")) && !(await canManageCourse(auth, courseId, "any"))) throw new Error("Forbidden");
  const result = await db(auth)
    .from("lms_task_submissions")
    .select("*, employee:employee_id(full_name, employee_code, user_id), reviews:lms_task_reviews(*)")
    .eq("org_id", auth.orgId)
    .eq("task_id", taskId)
    .order("submitted_at", { ascending: false });
  if (result.error) throw new Error(result.error.message);
  return result.data ?? [];
}

export async function getInstructorDashboard(auth: LmsAuth) {
  const courses = asRows(await listLmsCourses(auth, "manage"));
  const courseIds = courses.map((course) => text(course.id)).filter(Boolean);
  if (courseIds.length === 0) {
    return {
      summary: {
        courses: 0,
        learners: 0,
        completed: 0,
        pendingSubmissions: 0,
        communityQuestions: 0,
        averageProgress: 0,
      },
      courses: [],
      pendingSubmissions: [],
      recentPosts: [],
    };
  }

  const employeeId = await getEmployeeId(auth);
  const [
    enrollments,
    tasks,
    submissions,
    posts,
    announcements,
    certificates,
  ] = await Promise.all([
    db(auth)
      .from("lms_enrollments")
      .select("*, employee:employee_id(id, full_name, employee_code, email, job_title), course:course_id(id, title, status)")
      .eq("org_id", auth.orgId)
      .in("course_id", courseIds)
      .neq("status", "cancelled")
      .order("assigned_at", { ascending: false }),
    db(auth)
      .from("lms_tasks")
      .select("*")
      .eq("org_id", auth.orgId)
      .in("course_id", courseIds)
      .order("created_at", { ascending: false }),
    db(auth)
      .from("lms_task_submissions")
      .select("*, employee:employee_id(id, full_name, employee_code, email), task:task_id(id, title, pass_score, max_score), reviews:lms_task_reviews(*)")
      .eq("org_id", auth.orgId)
      .in("course_id", courseIds)
      .order("submitted_at", { ascending: false }),
    db(auth)
      .from("lms_community_posts")
      .select("*, employee:employee_id(id, full_name), comments:lms_community_comments(*, employee:employee_id(id, full_name)), reactions:lms_community_reactions(*)")
      .eq("org_id", auth.orgId)
      .in("course_id", courseIds)
      .eq("is_hidden", false)
      .order("created_at", { ascending: false }),
    db(auth)
      .from("lms_course_announcements")
      .select("*")
      .eq("org_id", auth.orgId)
      .in("course_id", courseIds)
      .order("published_at", { ascending: false }),
    db(auth)
      .from("lms_certificates")
      .select("*")
      .eq("org_id", auth.orgId)
      .in("course_id", courseIds),
  ]);

  for (const item of [enrollments, tasks, submissions, posts, announcements, certificates]) {
    if (item.error) throw new Error(item.error.message);
  }

  const enrollmentRows = asRows(enrollments.data);
  const taskRows = asRows(tasks.data);
  const submissionRows = asRows(submissions.data);
  const postRows = asRows(posts.data);
  const announcementRows = asRows(announcements.data);
  const certificateRows = asRows(certificates.data);
  const pendingStatuses = new Set(["submitted", "late", "needs_revision"]);
  const questionRows = postRows.filter((post) => text(post.post_type) === "question");
  const pendingRows = submissionRows.filter((submission) => pendingStatuses.has(text(submission.status)));

  const progressTotal = enrollmentRows.reduce((sum, enrollment) => sum + numberValue(enrollment.progress_percent, 0), 0);
  const averageProgress = enrollmentRows.length ? Math.round(progressTotal / enrollmentRows.length) : 0;

  const courseDashboards = courses.map((course) => {
    const courseId = text(course.id);
    const courseEnrollments = enrollmentRows.filter((enrollment) => text(enrollment.course_id) === courseId);
    const courseTasks = taskRows.filter((task) => text(task.course_id) === courseId);
    const courseSubmissions = submissionRows.filter((submission) => text(submission.course_id) === courseId);
    const coursePosts = postRows.filter((post) => text(post.course_id) === courseId);
    const courseAnnouncements = announcementRows.filter((announcement) => text(announcement.course_id) === courseId);
    const courseCertificates = certificateRows.filter((certificate) => text(certificate.course_id) === courseId);
    const instructor = asRows(course.instructors).find((row) => text(row.employee_id) === employeeId);
    const elevatedForCourse = isElevated(auth);
    const completed = courseEnrollments.filter((enrollment) => text(enrollment.status) === "completed").length;
    const courseProgressTotal = courseEnrollments.reduce((sum, enrollment) => sum + numberValue(enrollment.progress_percent, 0), 0);

    return {
      ...course,
      instructor_permissions: {
        can_edit_content: elevatedForCourse || boolValue(instructor?.can_edit_content),
        can_review_tasks: elevatedForCourse || boolValue(instructor?.can_review_tasks),
        can_moderate_community: elevatedForCourse || boolValue(instructor?.can_moderate_community),
      },
      metrics: {
        learners: courseEnrollments.length,
        completed,
        inProgress: courseEnrollments.filter((enrollment) => text(enrollment.status) === "in_progress").length,
        overdue: courseEnrollments.filter((enrollment) => text(enrollment.status) === "overdue").length,
        averageProgress: courseEnrollments.length ? Math.round(courseProgressTotal / courseEnrollments.length) : 0,
        pendingSubmissions: courseSubmissions.filter((submission) => pendingStatuses.has(text(submission.status))).length,
        tasks: courseTasks.length,
        questions: coursePosts.filter((post) => text(post.post_type) === "question").length,
        certificates: courseCertificates.length,
      },
      learners: courseEnrollments,
      tasks: courseTasks,
      submissions: courseSubmissions,
      posts: coursePosts,
      announcements: courseAnnouncements,
    };
  });

  return {
    summary: {
      courses: courseDashboards.length,
      learners: enrollmentRows.length,
      completed: enrollmentRows.filter((enrollment) => text(enrollment.status) === "completed").length,
      pendingSubmissions: pendingRows.length,
      communityQuestions: questionRows.length,
      averageProgress,
    },
    courses: courseDashboards,
    pendingSubmissions: pendingRows.slice(0, 12),
    recentPosts: postRows.slice(0, 12),
  };
}

function boolValue(value: unknown) {
  return value === true;
}

export async function getSubmission(auth: LmsAuth, submissionId: string) {
  const result = await db(auth)
    .from("lms_task_submissions")
    .select("*, employee:employee_id(full_name, user_id), task:task_id(*), reviews:lms_task_reviews(*)")
    .eq("org_id", auth.orgId)
    .eq("id", submissionId)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  const submission = asRecord(result.data);
  if (!submission.id) throw new Error("Submission not found");
  if (submission.employee_id !== await getEmployeeId(auth) && !(await canManageCourse(auth, text(submission.course_id), "can_review_tasks"))) {
    throw new Error("Forbidden");
  }
  return submission;
}

export async function reviewSubmission(auth: LmsAuth, submissionId: string, values: RecordMap) {
  const submission = await getSubmission(auth, submissionId);
  const courseId = text(submission.course_id);
  if (!(await canManageCourse(auth, courseId, "can_review_tasks")) && !(await isTrainingManagerForEmployee(auth, text(submission.employee_id)))) {
    throw new Error("Forbidden");
  }
  const reviewerEmployeeId = await getEmployeeId(auth);
  if (reviewerEmployeeId && reviewerEmployeeId === text(submission.employee_id)) {
    throw new Error("Learners cannot review their own submissions.");
  }
  const result = await db(auth).rpc("review_lms_submission_atomic", {
    p_org_id: auth.orgId,
    p_actor_user_id: auth.user.id,
    p_request_id: auth.requestId,
    p_command_id: text(values.command_id) || crypto.randomUUID(),
    p_submission_id: submissionId,
    p_score: numberValue(values.score, 0),
    p_feedback: optionalText(values.feedback),
    p_review_status: text(values.review_status),
    p_rubric_items: asRows(values.rubric_items),
  });
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export async function upsertAnnouncement(auth: LmsAuth, courseId: string, values: RecordMap, announcementId?: string) {
  await assertManageCourse(auth, courseId, "can_moderate_community");
  const payload = {
    org_id: auth.orgId,
    course_id: courseId,
    title: text(values.title),
    body: text(values.body),
    pinned: values.pinned === true,
    created_by: auth.user.id,
    published_at: new Date().toISOString(),
  };
  const query = announcementId
    ? db(auth).from("lms_course_announcements").update(payload as never).eq("org_id", auth.orgId).eq("id", announcementId)
    : db(auth).from("lms_course_announcements").insert(payload as never);
  const result = await query.select().single();
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export async function listCommunity(auth: LmsAuth, courseId: string) {
  const canManage = await canManageCourse(auth, courseId, "can_moderate_community");
  if (!canManage && !(await canParticipateInCourse(auth, courseId))) throw new Error("Forbidden");
  let query = db(auth)
    .from("lms_community_posts")
    .select("*, employee:employee_id(full_name), comments:lms_community_comments(*, employee:employee_id(full_name)), reactions:lms_community_reactions(*)")
    .eq("org_id", auth.orgId)
    .eq("course_id", courseId)
    .order("is_pinned", { ascending: false })
    .order("created_at", { ascending: false });
  if (!canManage) query = query.eq("is_hidden", false);
  const result = await query;
  if (result.error) throw new Error(result.error.message);
  return result.data ?? [];
}

export async function createCommunityPost(auth: LmsAuth, courseId: string, values: RecordMap) {
  const employeeId = await getEmployeeId(auth);
  if (!employeeId) throw new Error("Employee profile is required.");
  if (!(await canParticipateInCourse(auth, courseId))) throw new Error("Forbidden");
  const result = await db(auth).from("lms_community_posts").insert({
    org_id: auth.orgId,
    course_id: courseId,
    employee_id: employeeId,
    post_type: text(values.post_type) || "discussion",
    title: optionalText(values.title),
    body: text(values.body),
  } as never).select().single();
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export async function updateCommunityPost(auth: LmsAuth, postId: string, values: RecordMap) {
  const current = await db(auth).from("lms_community_posts").select("*").eq("org_id", auth.orgId).eq("id", postId).maybeSingle();
  if (current.error) throw new Error(current.error.message);
  const post = asRecord(current.data);
  if (!post.id) throw new Error("Post not found");
  const canModerate = await canManageCourse(auth, text(post.course_id), "can_moderate_community");
  if (!canModerate && text(post.employee_id) !== await getEmployeeId(auth)) throw new Error("Forbidden");
  const payload: RecordMap = {};
  if (values.title !== undefined) payload.title = optionalText(values.title);
  if (values.body !== undefined) payload.body = text(values.body);
  if (canModerate) {
    for (const key of ["is_pinned", "is_locked", "is_hidden", "accepted_comment_id"]) {
      if (values[key] !== undefined) payload[key] = values[key];
    }
  }
  const result = await db(auth).from("lms_community_posts").update(payload as never).eq("org_id", auth.orgId).eq("id", postId).select().single();
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export async function updateCommunityComment(auth: LmsAuth, commentId: string, values: RecordMap) {
  const current = await db(auth).from("lms_community_comments").select("*").eq("org_id", auth.orgId).eq("id", commentId).maybeSingle();
  if (current.error) throw new Error(current.error.message);
  const comment = asRecord(current.data);
  if (!comment.id) throw new Error("Comment not found");
  const canModerate = await canManageCourse(auth, text(comment.course_id), "can_moderate_community");
  if (!canModerate && text(comment.employee_id) !== await getEmployeeId(auth)) throw new Error("Forbidden");
  const payload: RecordMap = {};
  if (values.body !== undefined) payload.body = text(values.body);
  if (canModerate && values.is_hidden !== undefined) payload.is_hidden = values.is_hidden === true;
  const result = await db(auth).from("lms_community_comments").update(payload as never).eq("org_id", auth.orgId).eq("id", commentId).select().single();
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export async function createCommunityComment(auth: LmsAuth, postId: string, values: RecordMap) {
  const postResult = await db(auth).from("lms_community_posts").select("*").eq("org_id", auth.orgId).eq("id", postId).maybeSingle();
  if (postResult.error) throw new Error(postResult.error.message);
  const post = asRecord(postResult.data);
  if (!post.id) throw new Error("Post not found");
  if (!(await canParticipateInCourse(auth, text(post.course_id)))) throw new Error("Forbidden");
  if (post.is_locked === true && !(await canManageCourse(auth, text(post.course_id), "can_moderate_community"))) throw new Error("Post is locked.");
  const employeeId = await getEmployeeId(auth);
  const isInstructorReply = await canManageCourse(auth, text(post.course_id), "any");
  const result = await db(auth).from("lms_community_comments").insert({
    org_id: auth.orgId,
    post_id: postId,
    course_id: text(post.course_id),
    employee_id: employeeId,
    body: text(values.body),
    is_instructor_reply: isInstructorReply,
  } as never).select().single();
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export async function reactToPost(auth: LmsAuth, postId: string, reactionType: string) {
  const post = await db(auth).from("lms_community_posts").select("course_id").eq("org_id", auth.orgId).eq("id", postId).maybeSingle();
  if (post.error) throw new Error(post.error.message);
  const postRecord = asRecord(post.data);
  if (!postRecord.course_id) throw new Error("Post not found");
  if (!(await canParticipateInCourse(auth, text(postRecord.course_id)))) throw new Error("Forbidden");
  const employeeId = await getEmployeeId(auth);
  const result = await db(auth).from("lms_community_reactions").upsert({
    org_id: auth.orgId,
    post_id: postId,
    employee_id: employeeId,
    reaction_type: reactionType || "like",
  } as never, { onConflict: "org_id,post_id,employee_id,reaction_type" }).select().single();
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export async function markPostRead(auth: LmsAuth, postId: string) {
  const post = await db(auth).from("lms_community_posts").select("course_id").eq("org_id", auth.orgId).eq("id", postId).maybeSingle();
  if (post.error) throw new Error(post.error.message);
  const postRecord = asRecord(post.data);
  if (!postRecord.course_id) throw new Error("Post not found");
  if (!(await canParticipateInCourse(auth, text(postRecord.course_id)))) throw new Error("Forbidden");
  const employeeId = await getEmployeeId(auth);
  const result = await db(auth).from("lms_community_post_reads").upsert({
    org_id: auth.orgId,
    post_id: postId,
    employee_id: employeeId,
    read_at: new Date().toISOString(),
  } as never, { onConflict: "org_id,post_id,employee_id" }).select().single();
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export async function removeAnnouncement(auth: LmsAuth, announcementId: string) {
  const current = await db(auth).from("lms_course_announcements").select("course_id").eq("org_id", auth.orgId).eq("id", announcementId).maybeSingle();
  if (current.error) throw new Error(current.error.message);
  const courseId = text(asRecord(current.data).course_id);
  await assertManageCourse(auth, courseId, "can_moderate_community");
  const result = await db(auth).from("lms_course_announcements").delete().eq("org_id", auth.orgId).eq("id", announcementId);
  if (result.error) throw new Error(result.error.message);
  return { success: true };
}

export async function submitFeedback(auth: LmsAuth, enrollmentId: string, values: RecordMap) {
  const enrollment = await getEnrollmentForLearner(auth, enrollmentId);
  const result = await db(auth).from("lms_course_feedback").upsert({
    org_id: auth.orgId,
    enrollment_id: enrollmentId,
    course_id: text(enrollment.course_id),
    employee_id: text(enrollment.employee_id),
    rating: numberValue(values.rating, 5),
    comment: optionalText(values.comment),
  } as never, { onConflict: "org_id,enrollment_id" }).select().single();
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

async function listLearnerCertificates(auth: LmsAuth) {
  const employeeId = await getEmployeeId(auth);
  const result = await db(auth)
    .from("lms_certificates")
    .select("*, course:course_id(title), employee:employee_id(full_name)")
    .eq("org_id", auth.orgId)
    .eq("employee_id", employeeId)
    .order("issued_at", { ascending: false });
  if (result.error) throw new Error(result.error.message);
  return result.data ?? [];
}

export async function listCertificates(auth: LmsAuth) {
  const employeeId = await getEmployeeId(auth);
  const query = db(auth)
    .from("lms_certificates")
    .select("*, course:course_id(title), employee:employee_id(full_name, employee_code)")
    .eq("org_id", auth.orgId)
    .order("issued_at", { ascending: false });
  const result = await query;
  if (result.error) throw new Error(result.error.message);
  let certificateRows = asRows(result.data);
  if (isManagement(auth)) return certificateRows;
  if (isTrainingManager(auth)) {
    const scoped: RecordMap[] = [];
    for (const certificate of certificateRows) {
      if (await isTrainingManagerForEmployee(auth, text(certificate.employee_id))) scoped.push(certificate);
    }
    return scoped;
  }
  certificateRows = certificateRows.filter((certificate) => text(certificate.employee_id) === employeeId);
  return certificateRows;
}

export async function getCertificate(auth: LmsAuth, certificateId: string) {
  const result = await db(auth)
    .from("lms_certificates")
    .select("*, course:course_id(title), employee:employee_id(full_name, employee_code), organization:org_id(name)")
    .eq("org_id", auth.orgId)
    .eq("id", certificateId)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  const certificate = asRecord(result.data);
  if (!certificate.id) throw new Error("Certificate not found");
  const employeeId = await getEmployeeId(auth);
  const canView =
    isManagement(auth)
    || text(certificate.employee_id) === employeeId
    || (isTrainingManager(auth) && await isTrainingManagerForEmployee(auth, text(certificate.employee_id)))
    || await canManageCourse(auth, text(certificate.course_id), "any");
  if (!canView) {
    throw new Error("Forbidden");
  }
  return certificate;
}

export async function recalculateEnrollment(auth: LmsAuth, enrollmentId: string) {
  const result = await db(auth).rpc("refresh_lms_enrollment", {
    p_org_id: auth.orgId,
    p_actor_user_id: auth.user.id,
    p_request_id: auth.requestId,
    p_enrollment_id: enrollmentId,
  });
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export async function getLmsReports(auth: LmsAuth) {
  let instructorCourseIds: string[] = [];
  if (!isElevated(auth)) {
    const employeeId = await getEmployeeId(auth);
    const instructorCourses = await db(auth).from("lms_course_instructors").select("course_id").eq("org_id", auth.orgId).eq("employee_id", employeeId);
    if (instructorCourses.error) throw new Error(instructorCourses.error.message);
    instructorCourseIds = asRows(instructorCourses.data).map((row) => text(row.course_id)).filter(Boolean);
    if (instructorCourseIds.length === 0) throw new Error("Forbidden");
  }

  const [enrollments, attempts, submissions, certificates, posts, feedback] = await Promise.all([
    db(auth).from("lms_enrollments").select("*, employee:employee_id(id, manager_id, department:department_id(manager_employee_id), location:location_id(manager_employee_id)), course:course_id(title)").eq("org_id", auth.orgId),
    db(auth).from("lms_quiz_attempts").select("*").eq("org_id", auth.orgId),
    db(auth).from("lms_task_submissions").select("*").eq("org_id", auth.orgId),
    db(auth).from("lms_certificates").select("*").eq("org_id", auth.orgId),
    db(auth).from("lms_community_posts").select("*").eq("org_id", auth.orgId),
    db(auth).from("lms_course_feedback").select("*").eq("org_id", auth.orgId),
  ]);
  for (const item of [enrollments, attempts, submissions, certificates, posts, feedback]) {
    if (item.error) throw new Error(item.error.message);
  }
  let enrollmentRows = asRows(enrollments.data);
  let attemptRows = asRows(attempts.data);
  let submissionRows = asRows(submissions.data);
  let certificateRows = asRows(certificates.data);
  let postRows = asRows(posts.data);
  let feedbackRows = asRows(feedback.data);

  if (isTrainingManager(auth)) {
    const scoped: RecordMap[] = [];
    for (const enrollment of enrollmentRows) {
      if (await isTrainingManagerForEmployee(auth, text(enrollment.employee_id))) scoped.push(enrollment);
    }
    enrollmentRows = scoped;
  } else if (!isElevated(auth)) {
    const allowedCourses = new Set(instructorCourseIds);
    enrollmentRows = enrollmentRows.filter((row) => allowedCourses.has(text(row.course_id)));
  }

  const scopedEnrollmentIds = new Set(enrollmentRows.map((row) => text(row.id)).filter(Boolean));
  const scopedCourseIds = new Set(enrollmentRows.map((row) => text(row.course_id)).filter(Boolean));
  const shouldScopeReportRows = isTrainingManager(auth) || !isElevated(auth);

  if (shouldScopeReportRows) {
    attemptRows = attemptRows.filter((row) => scopedEnrollmentIds.has(text(row.enrollment_id)));
    submissionRows = submissionRows.filter((row) => scopedEnrollmentIds.has(text(row.enrollment_id)) || scopedCourseIds.has(text(row.course_id)));
    certificateRows = certificateRows.filter((row) => scopedEnrollmentIds.has(text(row.enrollment_id)) || scopedCourseIds.has(text(row.course_id)));
    feedbackRows = feedbackRows.filter((row) => scopedEnrollmentIds.has(text(row.enrollment_id)) || scopedCourseIds.has(text(row.course_id)));
    postRows = postRows.filter((row) => scopedCourseIds.has(text(row.course_id)));
  }

  const completed = enrollmentRows.filter((row) => row.status === "completed").length;
  const inProgress = enrollmentRows.filter((row) => row.status === "in_progress").length;
  const overdue = enrollmentRows.filter((row) => row.status === "overdue").length;
  const passedTasks = submissionRows.filter((row) => row.status === "accepted").length;
  const avgQuiz = attemptRows.length ? Math.round((attemptRows.reduce((sum, row) => sum + numberValue(row.score, 0), 0) / attemptRows.length) * 100) / 100 : 0;
  const avgFeedback = feedbackRows.length ? Math.round((feedbackRows.reduce((sum, row) => sum + numberValue(row.rating, 0), 0) / feedbackRows.length) * 100) / 100 : 0;
  return {
    summary: {
      assignedCourses: enrollmentRows.length,
      completedCourses: completed,
      inProgressCourses: inProgress,
      overdueCourses: overdue,
      completionRate: enrollmentRows.length ? Math.round((completed / enrollmentRows.length) * 100) : 0,
      averageQuizScore: avgQuiz,
      taskSubmissions: submissionRows.length,
      taskPassRate: submissionRows.length ? Math.round((passedTasks / submissionRows.length) * 100) : 0,
      certificates: certificateRows.length,
      communityPosts: postRows.length,
      feedbackAverage: avgFeedback,
    },
    enrollments: enrollmentRows,
    attempts: attemptRows,
    submissions: submissionRows,
    certificates: certificateRows,
    feedback: feedbackRows,
    community: postRows,
  };
}

export async function uploadLmsFile(auth: LmsAuth, formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error("File is required.");
  let courseId = text(formData.get("course_id"));
  const lessonId = text(formData.get("lesson_id"));
  const taskId = text(formData.get("task_id"));
  const submissionId = text(formData.get("submission_id"));
  const postId = text(formData.get("post_id"));
  const kind = text(formData.get("kind")) || "lessons";

  if (!courseId && !submissionId && !postId) throw new Error("Course is required.");
  if (courseId && kind !== "community" && !(await canManageCourse(auth, courseId, "can_edit_content")) && !submissionId && !postId) throw new Error("Forbidden");
  if (submissionId) {
    const submission = await getSubmission(auth, submissionId);
    if (text(submission.employee_id) !== await getEmployeeId(auth)) throw new Error("Forbidden");
    if (courseId && courseId !== text(submission.course_id)) throw new Error("Forbidden");
    courseId = text(submission.course_id);
  }
  if (postId) {
    const post = await db(auth).from("lms_community_posts").select("course_id").eq("org_id", auth.orgId).eq("id", postId).maybeSingle();
    if (post.error) throw new Error(post.error.message);
    const postRecord = asRecord(post.data);
    if (!postRecord.course_id) throw new Error("Post not found");
    if (courseId && courseId !== text(postRecord.course_id)) throw new Error("Forbidden");
    courseId = text(postRecord.course_id);
    if (!(await canParticipateInCourse(auth, courseId))) throw new Error("Forbidden");
  } else if (kind === "community" && !(await canParticipateInCourse(auth, courseId))) {
    throw new Error("Forbidden");
  }

  const filename = `${Date.now()}-${safeFilename(file.name)}`;
  let path = `orgs/${auth.orgId}/lms/courses/${courseId || "general"}/lessons/${lessonId || "general"}/${filename}`;
  if (taskId) path = `orgs/${auth.orgId}/lms/courses/${courseId || "general"}/tasks/${taskId}/${filename}`;
  if (submissionId) path = `orgs/${auth.orgId}/lms/courses/${courseId || "general"}/submissions/${submissionId}/${filename}`;
  if (postId || kind === "community") path = `orgs/${auth.orgId}/lms/courses/${courseId || "general"}/community/${postId || "general"}/${filename}`;

  const inspected = await inspectUpload(file, { allowedMimeTypes: allowedLmsMimeTypes, maxBytes: maxLmsUploadBytes });
  await storeObject(auth.admin, {
    bucket: "lms-content", path, bytes: inspected.bytes,
    contentType: inspected.detectedMime, upsert: false,
  });
  return {
    bucket: "lms-content",
    path,
    file_name: file.name,
    mime_type: inspected.detectedMime,
    size_bytes: file.size,
    sha256: inspected.sha256,
    signed_url: createObjectAccessUrl("lms-content", path, { expiresIn: 60 * 60 }),
  };
}

export async function createSignedLmsUrl(auth: LmsAuth, path: string) {
  if (!path.startsWith(`orgs/${auth.orgId}/lms/`)) throw new Error("Forbidden");
  const parts = path.split("/");
  const courseId = parts[4] || "";
  const area = parts[5] || "";
  const targetId = parts[6] || "";
  if (!courseId || !area || !targetId) throw new Error("Forbidden");

  if (area === "submissions") {
    const submission = await getSubmission(auth, targetId);
    if (text(submission.course_id) !== courseId) throw new Error("Forbidden");
  } else if (area === "lessons" || area === "resources") {
    const course = await getLmsCourse(auth, courseId, { learner: true });
    if (!course) throw new Error("Forbidden");
  } else if (area === "tasks" || area === "community") {
    if (!(await canParticipateInCourse(auth, courseId))) throw new Error("Forbidden");
  } else {
    throw new Error("Forbidden");
  }

  return {
    signedUrl: createObjectAccessUrl("lms-content", path, { expiresIn: 60 * 60 }),
  };
}

export async function upsertLearningPath(auth: LmsAuth, values: RecordMap, pathId?: string) {
  await assertElevated(auth);
  const payload = {
    org_id: auth.orgId,
    title: text(values.title),
    description: optionalText(values.description),
    status: text(values.status) || "draft",
    created_by: auth.user.id,
  };
  const query = pathId
    ? db(auth).from("lms_learning_paths").update(payload as never).eq("org_id", auth.orgId).eq("id", pathId)
    : db(auth).from("lms_learning_paths").insert(payload as never);
  const result = await query.select().single();
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export async function listAssignmentRules(auth: LmsAuth) {
  await assertElevated(auth);
  const result = await db(auth)
    .from("lms_assignment_rules")
    .select("*, course:course_id(title)")
    .eq("org_id", auth.orgId)
    .eq("is_active", true)
    .order("created_at", { ascending: false });
  if (result.error) throw new Error(result.error.message);
  return result.data ?? [];
}

export async function addQuizQuestion(auth: LmsAuth, quizId: string, values: RecordMap) {
  const quizResult = await db(auth).from("lms_quizzes").select("course_id").eq("org_id", auth.orgId).eq("id", quizId).maybeSingle();
  if (quizResult.error) throw new Error(quizResult.error.message);
  const courseId = text(asRecord(quizResult.data).course_id);
  if (!courseId) throw new Error("Quiz not found");
  await assertManageCourse(auth, courseId, "can_edit_content");
  const countResult = await db(auth).from("lms_quiz_questions").select("id").eq("org_id", auth.orgId).eq("quiz_id", quizId);
  if (countResult.error) throw new Error(countResult.error.message);
  const sortOrder = asRows(countResult.data).length;
  const payload = {
    org_id: auth.orgId,
    quiz_id: quizId,
    question_text: text(values.question_text),
    question_type: text(values.question_type) || "single_choice",
    options_json: values.options_json ?? [],
    correct_answer_json: values.correct_answer_json ?? null,
    points: numberValue(values.points, 1),
    sort_order: numberValue(values.sort_order, sortOrder),
  };
  const result = await db(auth).from("lms_quiz_questions").insert(payload as never).select().single();
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export async function deleteQuizQuestion(auth: LmsAuth, questionId: string) {
  const questionResult = await db(auth).from("lms_quiz_questions").select("quiz_id").eq("org_id", auth.orgId).eq("id", questionId).maybeSingle();
  if (questionResult.error) throw new Error(questionResult.error.message);
  const quizId = text(asRecord(questionResult.data).quiz_id);
  if (!quizId) throw new Error("Question not found");
  const quizResult = await db(auth).from("lms_quizzes").select("course_id").eq("org_id", auth.orgId).eq("id", quizId).maybeSingle();
  if (quizResult.error) throw new Error(quizResult.error.message);
  const courseId = text(asRecord(quizResult.data).course_id);
  await assertManageCourse(auth, courseId, "can_edit_content");
  const result = await db(auth).from("lms_quiz_questions").delete().eq("org_id", auth.orgId).eq("id", questionId);
  if (result.error) throw new Error(result.error.message);
  return { success: true };
}

export async function listOrgEmployees(auth: LmsAuth) {
  await assertElevated(auth);
  const result = await db(auth)
    .from("employees")
    .select("id, full_name, employee_code, job_title")
    .eq("org_id", auth.orgId)
    .ilike("status", "active")
    .order("full_name", { ascending: true });
  if (result.error) throw new Error(result.error.message);
  return result.data ?? [];
}

export async function listOrgDepartments(auth: LmsAuth) {
  await assertElevated(auth);
  const result = await db(auth)
    .from("departments")
    .select("id, name")
    .eq("org_id", auth.orgId)
    .order("name", { ascending: true });
  if (result.error) throw new Error(result.error.message);
  return result.data ?? [];
}

export async function listOrgLocations(auth: LmsAuth) {
  await assertElevated(auth);
  const result = await db(auth)
    .from("locations")
    .select("id, name, type")
    .eq("org_id", auth.orgId)
    .order("name", { ascending: true });
  if (result.error) throw new Error(result.error.message);
  return result.data ?? [];
}
