/* eslint-disable @typescript-eslint/no-explicit-any */
import type { TenantAuthContext } from "@/lib/server/tenant-context";
import {
  canManageCourse,
  getSubmission,
  isElevated,
  reviewSubmission,
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
function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => text(item)).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(/\r?\n|,/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

async function assertManageCourse(auth: LmsAuth, courseId: string, permission: "can_edit_content" | "can_review_tasks" | "can_moderate_community" | "any" = "can_edit_content") {
  if (!(await canManageCourse(auth, courseId, permission))) throw new Error("Forbidden");
}

async function getCourseCore(auth: LmsAuth, courseId: string) {
  const result = await db(auth).from("lms_courses").select("*").eq("org_id", auth.orgId).eq("id", courseId).maybeSingle();
  if (result.error) throw new Error(result.error.message);
  const course = asRecord(result.data);
  if (!course.id) throw new Error("Course not found");
  return course;
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export async function updateCourseBuilderOverview(auth: LmsAuth, courseId: string, values: RecordMap) {
  await assertManageCourse(auth, courseId, "can_edit_content");
  const payload: RecordMap = { updated_at: new Date().toISOString() };
  if (values.title !== undefined) payload.title = text(values.title);
  if (values.subtitle !== undefined) payload.subtitle = optionalText(values.subtitle);
  if (values.description !== undefined) payload.description = optionalText(values.description);
  if (values.category_id !== undefined) payload.category_id = optionalText(values.category_id);
  if (values.difficulty !== undefined) payload.difficulty = text(values.difficulty) || "beginner";
  if (values.estimated_minutes !== undefined) payload.estimated_minutes = numberValue(values.estimated_minutes, 0);
  if (values.thumbnail_path !== undefined) payload.thumbnail_path = optionalText(values.thumbnail_path);
  if (values.visibility !== undefined) payload.visibility = text(values.visibility) || "assigned_only";
  if (values.experience_type !== undefined) payload.experience_type = text(values.experience_type) || "course";
  if (values.target_audience !== undefined) payload.target_audience = optionalText(values.target_audience);
  if (values.prerequisites !== undefined) payload.prerequisites = optionalText(values.prerequisites);
  if (values.language !== undefined) payload.language = text(values.language) || "ar";
  if (values.learning_outcomes !== undefined) payload.learning_outcomes = stringArray(values.learning_outcomes);
  if (values.skills_gained !== undefined) payload.skills_gained = stringArray(values.skills_gained);
  if (values.tags !== undefined) payload.tags = stringArray(values.tags);
  if (values.passing_score !== undefined) payload.passing_score = numberValue(values.passing_score, 70);
  if (values.requires_quiz_pass !== undefined) payload.requires_quiz_pass = values.requires_quiz_pass === true;
  if (values.requires_task_pass !== undefined) payload.requires_task_pass = values.requires_task_pass === true;
  if (values.certificate_enabled !== undefined) payload.certificate_enabled = values.certificate_enabled !== false;
  if (values.certificate_title !== undefined) payload.certificate_title = optionalText(values.certificate_title);
  if (values.certificate_description !== undefined) payload.certificate_description = optionalText(values.certificate_description);
  if (values.certificate_signatory !== undefined) payload.certificate_signatory = optionalText(values.certificate_signatory);

  const result = await db(auth).from("lms_courses").update(payload as never).eq("org_id", auth.orgId).eq("id", courseId).select().single();
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

// ---------------------------------------------------------------------------
// Rubrics
// ---------------------------------------------------------------------------

export async function getProjectRubric(auth: LmsAuth, taskId: string) {
  const taskResult = await db(auth).from("lms_tasks").select("id, course_id, title").eq("org_id", auth.orgId).eq("id", taskId).maybeSingle();
  if (taskResult.error) throw new Error(taskResult.error.message);
  const task = asRecord(taskResult.data);
  if (!task.id) throw new Error("Project not found");
  await assertManageCourse(auth, text(task.course_id), "any");
  const result = await db(auth)
    .from("lms_project_rubrics")
    .select("*, items:lms_project_rubric_items(*)")
    .eq("org_id", auth.orgId)
    .eq("task_id", taskId)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  const rubric = asRecord(result.data);
  if (rubric.id) rubric.items = asRows(rubric.items).sort((a, b) => numberValue(a.sort_order) - numberValue(b.sort_order));
  return { task, rubric: rubric.id ? rubric : null };
}

export async function upsertProjectRubric(auth: LmsAuth, taskId: string, values: RecordMap) {
  const taskResult = await db(auth).from("lms_tasks").select("id, course_id").eq("org_id", auth.orgId).eq("id", taskId).maybeSingle();
  if (taskResult.error) throw new Error(taskResult.error.message);
  const task = asRecord(taskResult.data);
  if (!task.id) throw new Error("Project not found");
  const courseId = text(task.course_id);
  await assertManageCourse(auth, courseId, "can_edit_content");

  const items = asRows(values.items);
  const totalPoints = items.reduce((sum, item) => sum + numberValue(item.points, 0), 0);
  const passPoints = values.pass_points !== undefined ? numberValue(values.pass_points, 0) : Math.round(totalPoints * 0.7 * 100) / 100;

  const rubricPayload = {
    org_id: auth.orgId,
    task_id: taskId,
    course_id: courseId,
    title: text(values.title) || "معايير تقييم المشروع",
    description: optionalText(values.description),
    total_points: totalPoints,
    pass_points: passPoints,
    created_by: auth.user.id,
    updated_at: new Date().toISOString(),
  };
  const rubricResult = await db(auth)
    .from("lms_project_rubrics")
    .upsert(rubricPayload as never, { onConflict: "org_id,task_id" })
    .select()
    .single();
  if (rubricResult.error) throw new Error(rubricResult.error.message);
  const rubric = asRecord(rubricResult.data);
  const rubricId = text(rubric.id);

  const keepIds = items.map((item) => text(item.id)).filter(Boolean);
  const existing = await db(auth).from("lms_project_rubric_items").select("id").eq("org_id", auth.orgId).eq("rubric_id", rubricId);
  if (existing.error) throw new Error(existing.error.message);
  const toDelete = asRows(existing.data).map((row) => text(row.id)).filter((id) => id && !keepIds.includes(id));
  if (toDelete.length > 0) {
    const del = await db(auth).from("lms_project_rubric_items").delete().eq("org_id", auth.orgId).in("id", toDelete);
    if (del.error) throw new Error(del.error.message);
  }

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const itemPayload = {
      org_id: auth.orgId,
      rubric_id: rubricId,
      task_id: taskId,
      course_id: courseId,
      title: text(item.title),
      description: optionalText(item.description),
      passing_criteria: optionalText(item.passing_criteria),
      points: numberValue(item.points, 1),
      sort_order: numberValue(item.sort_order, index),
      updated_at: new Date().toISOString(),
    };
    const itemId = text(item.id);
    const itemResult = itemId
      ? await db(auth).from("lms_project_rubric_items").update(itemPayload as never).eq("org_id", auth.orgId).eq("id", itemId)
      : await db(auth).from("lms_project_rubric_items").insert(itemPayload as never);
    if (itemResult.error) throw new Error(itemResult.error.message);
  }

  return getProjectRubric(auth, taskId);
}

export async function deleteRubricItem(auth: LmsAuth, itemId: string) {
  const itemResult = await db(auth).from("lms_project_rubric_items").select("id, course_id").eq("org_id", auth.orgId).eq("id", itemId).maybeSingle();
  if (itemResult.error) throw new Error(itemResult.error.message);
  const item = asRecord(itemResult.data);
  if (!item.id) throw new Error("Rubric item not found");
  await assertManageCourse(auth, text(item.course_id), "can_edit_content");
  const result = await db(auth).from("lms_project_rubric_items").delete().eq("org_id", auth.orgId).eq("id", itemId);
  if (result.error) throw new Error(result.error.message);
  return { success: true };
}

export async function reviewProjectWithRubric(auth: LmsAuth, submissionId: string, values: RecordMap) {
  const submission = await getSubmission(auth, submissionId);
  const courseId = text(submission.course_id);
  await assertManageCourse(auth, courseId, "can_review_tasks");

  const rubricItems = asRows(values.rubric_items);
  let computedScore = numberValue(values.score, 0);
  let reviewStatus = text(values.review_status) || "accepted";

  if (rubricItems.length > 0) {
    const rubricResult = await db(auth).from("lms_project_rubrics").select("total_points, pass_points").eq("org_id", auth.orgId).eq("task_id", text(submission.task_id)).maybeSingle();
    if (rubricResult.error) throw new Error(rubricResult.error.message);
    const rubric = asRecord(rubricResult.data);
    const earned = rubricItems.reduce((sum, item) => sum + numberValue(item.score, 0), 0);
    computedScore = earned;
    if (values.review_status === undefined) {
      reviewStatus = earned >= numberValue(rubric.pass_points, 0) ? "accepted" : "needs_revision";
    }
  }

  const reviewResult = await reviewSubmission(auth, submissionId, {
    score: computedScore,
    feedback: optionalText(values.feedback),
    review_status: reviewStatus,
  });
  const reviewId = text(asRecord(asRecord(reviewResult).review).id);

  if (reviewId && rubricItems.length > 0) {
    for (const item of rubricItems) {
      const payload = {
        org_id: auth.orgId,
        review_id: reviewId,
        submission_id: submissionId,
        rubric_item_id: text(item.rubric_item_id),
        task_id: text(submission.task_id),
        course_id: courseId,
        score: numberValue(item.score, 0),
        passed: item.passed === true,
        feedback: optionalText(item.feedback),
      };
      if (!payload.rubric_item_id) continue;
      const itemResult = await db(auth).from("lms_project_review_items").insert(payload as never);
      if (itemResult.error) throw new Error(itemResult.error.message);
    }
  }

  return reviewResult;
}

// ---------------------------------------------------------------------------
// Course resources + workspace configs
// ---------------------------------------------------------------------------

export async function listCourseResources(auth: LmsAuth, courseId: string) {
  await assertManageCourse(auth, courseId, "any");
  const result = await db(auth).from("lms_course_resources").select("*").eq("org_id", auth.orgId).eq("course_id", courseId).order("sort_order", { ascending: true });
  if (result.error) throw new Error(result.error.message);
  return result.data ?? [];
}

export async function upsertCourseResource(auth: LmsAuth, courseId: string, values: RecordMap, resourceId?: string) {
  await assertManageCourse(auth, courseId, "can_edit_content");
  const payload = {
    org_id: auth.orgId,
    course_id: courseId,
    lesson_id: optionalText(values.lesson_id),
    task_id: optionalText(values.task_id),
    title: text(values.title),
    description: optionalText(values.description),
    resource_type: text(values.resource_type) || "document",
    storage_path: optionalText(values.storage_path),
    external_url: optionalText(values.external_url),
    mime_type: optionalText(values.mime_type),
    size_bytes: numberValue(values.size_bytes, 0),
    sort_order: numberValue(values.sort_order, 0),
    is_active: values.is_active !== false,
    created_by: auth.user.id,
    updated_at: new Date().toISOString(),
  };
  const query = resourceId
    ? db(auth).from("lms_course_resources").update(payload as never).eq("org_id", auth.orgId).eq("id", resourceId)
    : db(auth).from("lms_course_resources").insert(payload as never);
  const result = await query.select().single();
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export async function deleteCourseResource(auth: LmsAuth, resourceId: string) {
  const current = await db(auth).from("lms_course_resources").select("course_id").eq("org_id", auth.orgId).eq("id", resourceId).maybeSingle();
  if (current.error) throw new Error(current.error.message);
  const courseId = text(asRecord(current.data).course_id);
  await assertManageCourse(auth, courseId, "can_edit_content");
  const result = await db(auth).from("lms_course_resources").update({ is_active: false } as never).eq("org_id", auth.orgId).eq("id", resourceId).select().single();
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export async function upsertWorkspaceConfig(auth: LmsAuth, courseId: string, values: RecordMap) {
  await assertManageCourse(auth, courseId, "can_edit_content");
  const payload = {
    org_id: auth.orgId,
    course_id: courseId,
    task_id: optionalText(values.task_id),
    workspace_type: text(values.workspace_type) || "instructions_only",
    external_url: optionalText(values.external_url),
    instructions: optionalText(values.instructions),
    created_by: auth.user.id,
    updated_at: new Date().toISOString(),
  };
  const result = await db(auth)
    .from("lms_workspace_configs")
    .upsert(payload as never, { onConflict: "org_id,course_id,task_id" })
    .select()
    .single();
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

// ---------------------------------------------------------------------------
// Publish checklist + learner preview + builder state
// ---------------------------------------------------------------------------

export async function getPublishChecklist(auth: LmsAuth, courseId: string) {
  await assertManageCourse(auth, courseId, "any");
  const course = await getCourseCore(auth, courseId);
  const [sections, lessons, quizzes, questions, tasks, rubrics, instructors] = await Promise.all([
    db(auth).from("lms_course_sections").select("id").eq("org_id", auth.orgId).eq("course_id", courseId),
    db(auth).from("lms_lessons").select("id, is_required, content, content_url, storage_path").eq("org_id", auth.orgId).eq("course_id", courseId).eq("is_active", true),
    db(auth).from("lms_quizzes").select("id, is_required").eq("org_id", auth.orgId).eq("course_id", courseId).eq("is_active", true),
    db(auth).from("lms_quiz_questions").select("quiz_id").eq("org_id", auth.orgId),
    db(auth).from("lms_tasks").select("id, is_required, instructions, status").eq("org_id", auth.orgId).eq("course_id", courseId),
    db(auth).from("lms_project_rubrics").select("task_id").eq("org_id", auth.orgId).eq("course_id", courseId),
    db(auth).from("lms_course_instructors").select("id").eq("org_id", auth.orgId).eq("course_id", courseId),
  ]);
  for (const item of [sections, lessons, quizzes, questions, tasks, rubrics, instructors]) {
    if (item.error) throw new Error(item.error.message);
  }
  const lessonRows = asRows(lessons.data);
  const requiredLessons = lessonRows.filter((l) => l.is_required !== false);
  const quizRows = asRows(quizzes.data);
  const requiredQuizzes = quizRows.filter((q) => q.is_required !== false);
  const questionQuizIds = new Set(asRows(questions.data).map((q) => text(q.quiz_id)));
  const publishedTasks = asRows(tasks.data).filter((t) => text(t.status) === "published");
  const requiredTasks = publishedTasks.filter((t) => t.is_required !== false);
  const rubricTaskIds = new Set(asRows(rubrics.data).map((r) => text(r.task_id)));

  const lessonHasContent = (lesson: RecordMap) => Boolean(text(lesson.content) || text(lesson.content_url) || text(lesson.storage_path));

  const checks = [
    { key: "title", label: "عنوان الدورة موجود", ok: Boolean(text(course.title)), severity: "critical" },
    { key: "description", label: "وصف الدورة موجود", ok: Boolean(text(course.description)), severity: "warning" },
    { key: "sections", label: "يوجد قسم واحد على الأقل", ok: asRows(sections.data).length > 0, severity: "critical" },
    { key: "required_lessons", label: "يوجد درس مطلوب واحد على الأقل", ok: requiredLessons.length > 0, severity: "critical" },
    { key: "lessons_content", label: "كل الدروس المطلوبة تحتوي محتوى", ok: requiredLessons.every(lessonHasContent), severity: "critical" },
    { key: "quiz_questions", label: "الاختبارات المطلوبة تحتوي أسئلة", ok: requiredQuizzes.every((q) => questionQuizIds.has(text(q.id))), severity: "critical" },
    { key: "task_instructions", label: "المشاريع المطلوبة تحتوي تعليمات", ok: requiredTasks.every((t) => Boolean(text(t.instructions))), severity: "warning" },
    { key: "task_rubrics", label: "المشاريع المطلوبة لها معايير تقييم", ok: !course.requires_task_pass || requiredTasks.every((t) => rubricTaskIds.has(text(t.id))), severity: "warning" },
    { key: "instructor", label: "تم تعيين مدرب للدورة", ok: asRows(instructors.data).length > 0, severity: "warning" },
    { key: "completion_quiz", label: "قواعد الإكمال للاختبارات صحيحة", ok: !course.requires_quiz_pass || requiredQuizzes.length > 0, severity: "critical" },
    { key: "completion_task", label: "قواعد الإكمال للمشاريع صحيحة", ok: !course.requires_task_pass || requiredTasks.length > 0, severity: "critical" },
  ];

  const criticalFailures = checks.filter((c) => c.severity === "critical" && !c.ok);
  return {
    course: { id: text(course.id), title: text(course.title), status: text(course.status) },
    checks,
    canPublish: criticalFailures.length === 0,
    criticalFailures: criticalFailures.length,
    passed: checks.filter((c) => c.ok).length,
    total: checks.length,
  };
}

export async function getLearnerPreview(auth: LmsAuth, courseId: string) {
  await assertManageCourse(auth, courseId, "any");
  const course = await getCourseCore(auth, courseId);
  const [sections, lessons, quizzes, tasks] = await Promise.all([
    db(auth).from("lms_course_sections").select("*").eq("org_id", auth.orgId).eq("course_id", courseId).order("sort_order", { ascending: true }),
    db(auth).from("lms_lessons").select("id, section_id, title, description, lesson_type, display_mode, duration_minutes, sort_order, is_required").eq("org_id", auth.orgId).eq("course_id", courseId).eq("is_active", true).order("sort_order", { ascending: true }),
    db(auth).from("lms_quizzes").select("id, lesson_id, title, is_required").eq("org_id", auth.orgId).eq("course_id", courseId).eq("is_active", true),
    db(auth).from("lms_tasks").select("id, lesson_id, title, task_type, is_required, status").eq("org_id", auth.orgId).eq("course_id", courseId).eq("status", "published"),
  ]);
  for (const item of [sections, lessons, quizzes, tasks]) {
    if (item.error) throw new Error(item.error.message);
  }
  const sectionRows = asRows(sections.data);
  const lessonRows = asRows(lessons.data);
  const quizRows = asRows(quizzes.data);
  const taskRows = asRows(tasks.data);
  const structure = sectionRows.map((section) => ({
    id: text(section.id),
    title: text(section.title),
    section_type: text(section.section_type) || "module",
    lessons: lessonRows.filter((l) => text(l.section_id) === text(section.id)),
    quizzes: quizRows.filter((q) => lessonRows.some((l) => text(l.section_id) === text(section.id) && text(l.id) === text(q.lesson_id))),
    projects: taskRows.filter((t) => lessonRows.some((l) => text(l.section_id) === text(section.id) && text(l.id) === text(t.lesson_id))),
  }));
  return {
    course,
    structure,
    counts: { sections: sectionRows.length, lessons: lessonRows.length, quizzes: quizRows.length, projects: taskRows.length },
  };
}

export async function getCourseBuilderState(auth: LmsAuth, courseId: string) {
  await assertManageCourse(auth, courseId, "any");
  const course = await getCourseCore(auth, courseId);
  const [resources, workspaceConfigs, rubrics, checklist] = await Promise.all([
    db(auth).from("lms_course_resources").select("*").eq("org_id", auth.orgId).eq("course_id", courseId).eq("is_active", true).order("sort_order", { ascending: true }),
    db(auth).from("lms_workspace_configs").select("*").eq("org_id", auth.orgId).eq("course_id", courseId),
    db(auth).from("lms_project_rubrics").select("*, items:lms_project_rubric_items(*)").eq("org_id", auth.orgId).eq("course_id", courseId),
    getPublishChecklist(auth, courseId),
  ]);
  if (resources.error) throw new Error(resources.error.message);
  if (workspaceConfigs.error) throw new Error(workspaceConfigs.error.message);
  if (rubrics.error) throw new Error(rubrics.error.message);
  return {
    course,
    resources: resources.data ?? [],
    workspaceConfigs: workspaceConfigs.data ?? [],
    rubrics: rubrics.data ?? [],
    checklist,
    canManage: await canManageCourse(auth, courseId, "can_edit_content"),
    isElevated: isElevated(auth),
  };
}
