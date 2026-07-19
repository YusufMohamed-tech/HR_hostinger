import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenantContext, type TenantAuthContext } from "@/lib/server/tenant-context";
import {
  archiveCourseLesson,
  archiveCourseQuiz,
  archiveCourseTask,
  addQuizQuestion,
  archiveLmsCategory,
  archiveLmsCourse,
  assignLmsLearning,
  listAssignmentRules,
  listOrgDepartments,
  listOrgEmployees,
  listOrgLocations,
  deleteQuizQuestion,
  completeLesson,
  createCommunityComment,
  createCommunityPost,
  createSignedLmsUrl,
  getCertificate,
  getEnrollmentDetail,
  getInstructorDashboard,
  getLearnerDashboard,
  getLmsCourse,
  getLmsReports,
  listCertificates,
  listCommunity,
  listCourseInstructors,
  listLmsCategories,
  listLmsCourses,
  listTaskSubmissions,
  getSubmission,
  markPostRead,
  publishLmsCourse,
  reactToPost,
  removeAnnouncement,
  removeCourseInstructor,
  reviewSubmission,
  submitFeedback,
  submitQuizAttempt,
  submitTask,
  updateCommunityComment,
  updateCommunityPost,
  updateCourseLessonById,
  updateCourseQuizById,
  updateCourseTaskById,
  uploadLmsFile,
  upsertAnnouncement,
  upsertCourseInstructor,
  upsertCourseLesson,
  upsertCourseQuiz,
  upsertCourseSection,
  upsertCourseTask,
  upsertLearningPath,
  upsertLmsCategory,
  upsertLmsCourse,
} from "@/lib/server/lms";
import {
  deleteCourseResource,
  deleteRubricItem,
  getCourseBuilderState,
  getLearnerPreview,
  getProjectRubric,
  getPublishChecklist,
  listCourseResources,
  reviewProjectWithRubric,
  updateCourseBuilderOverview,
  upsertCourseResource,
  upsertProjectRubric,
  upsertWorkspaceConfig,
} from "@/lib/server/lms-builder";
import {
  getValidationMessage,
  lmsAnnouncementSchema,
  lmsAssignmentSchema,
  lmsBuilderOverviewSchema,
  lmsCategorySchema,
  lmsCommunityCommentSchema,
  lmsCommunityPostSchema,
  lmsCourseSchema,
  lmsFeedbackSchema,
  lmsInstructorSchema,
  lmsLearningPathSchema,
  lmsLessonSchema,
  lmsQuizSchema,
  lmsResourceSchema,
  lmsRubricReviewSchema,
  lmsRubricSchema,
  lmsSectionSchema,
  lmsTaskReviewSchema,
  lmsTaskSchema,
  lmsTaskSubmissionSchema,
  lmsWorkspaceConfigSchema,
} from "@/lib/validation";

type RouteContext = { params?: Promise<{ segments?: string[] }> };
type Handler = (request: NextRequest, auth: TenantAuthContext, routeContext?: unknown) => Promise<Response>;
type ValidationResult =
  | { ok: false; error: NextResponse }
  | { ok: true; data: Record<string, unknown> };

async function segments(routeContext?: unknown) {
  const context = routeContext as RouteContext | undefined;
  const params = await context?.params;
  return params?.segments ?? [];
}

async function jsonBody(request: NextRequest) {
  return await request.json().catch(() => ({}));
}

function validate(schema: z.ZodTypeAny, body: unknown): ValidationResult {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, error: NextResponse.json({ message: getValidationMessage(parsed.error) }, { status: 400 }) };
  }
  return { ok: true, data: parsed.data as Record<string, unknown> };
}

function response(data: unknown) {
  return NextResponse.json({ data });
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unable to complete LMS request.";
  if (message === "Forbidden") return NextResponse.json({ message }, { status: 403 });
  if (message.toLowerCase().includes("not found")) return NextResponse.json({ message }, { status: 404 });
  if (
    message.includes("required") ||
    message.includes("Unsupported") ||
    message.includes("Maximum") ||
    message.includes("Select") ||
    message.includes("Learners cannot")
  ) {
    return NextResponse.json({ message }, { status: 400 });
  }
  return NextResponse.json({ message }, { status: 500 });
}

const getHandler: Handler = async (request, auth, routeContext) => {
  try {
    const parts = await segments(routeContext);
    const [a, b, c] = parts;
    const search = request.nextUrl.searchParams;

    if (!a) return response(await getLearnerDashboard(auth));
    if (a === "instructor") return response(await getInstructorDashboard(auth));
    if (a === "categories") return response(await listLmsCategories(auth));
    if (a === "courses" && !b) return response(await listLmsCourses(auth, search.get("mode") || "manage"));
    if (a === "courses" && b && !c) return response(await getLmsCourse(auth, b, { learner: search.get("view") === "learner" }));
    if (a === "courses" && b && c === "instructors") return response(await listCourseInstructors(auth, b));
    if (a === "courses" && b && c === "lessons") {
      const course = await getLmsCourse(auth, b, { learner: search.get("view") === "learner" });
      return response((course?.sections as unknown[]) ?? []);
    }
    if (a === "courses" && b && c === "quizzes") {
      const course = await getLmsCourse(auth, b, { learner: search.get("view") === "learner" });
      return response((course?.quizzes as unknown[]) ?? []);
    }
    if (a === "courses" && b && c === "tasks") {
      const course = await getLmsCourse(auth, b, { learner: search.get("view") === "learner" });
      return response((course?.tasks as unknown[]) ?? []);
    }
    if (a === "courses" && b && c === "announcements") {
      const course = await getLmsCourse(auth, b, { learner: true });
      return response((course?.announcements as unknown[]) ?? []);
    }
    if (a === "courses" && b && c === "community") return response(await listCommunity(auth, b));
    if (a === "courses" && b && c === "builder") return response(await getCourseBuilderState(auth, b));
    if (a === "courses" && b && c === "publish-checklist") return response(await getPublishChecklist(auth, b));
    if (a === "courses" && b && c === "learner-preview") return response(await getLearnerPreview(auth, b));
    if (a === "courses" && b && c === "resources") return response(await listCourseResources(auth, b));
    if (a === "tasks" && b && c === "rubric") return response(await getProjectRubric(auth, b));
    if (a === "my" && !b) return response(await getLearnerDashboard(auth));
    if (a === "my" && b) return response(await getEnrollmentDetail(auth, b));
    if (a === "certificates" && !b) return response(await listCertificates(auth));
    if (a === "certificates" && b) return response(await getCertificate(auth, b));
    if (a === "reports") return response(await getLmsReports(auth));
    if (a === "tasks" && b && c === "submissions") return response(await listTaskSubmissions(auth, b));
    if (a === "submissions" && b) return response(await getSubmission(auth, b));
    if (a === "files" && b === "signed-url") {
      const path = search.get("path") || "";
      return response(await createSignedLmsUrl(auth, path));
    }
    if (a === "assignments") return response(await listAssignmentRules(auth));
    if (a === "employees") return response(await listOrgEmployees(auth));
    if (a === "departments") return response(await listOrgDepartments(auth));
    if (a === "locations") return response(await listOrgLocations(auth));

    return NextResponse.json({ message: "LMS endpoint not found." }, { status: 404 });
  } catch (error) {
    return errorResponse(error);
  }
};

const postHandler: Handler = async (request, auth, routeContext) => {
  try {
    const parts = await segments(routeContext);
    const [a, b, c, d, e] = parts;

    if (a === "uploads") return response(await uploadLmsFile(auth, await request.formData()));

    const body = await jsonBody(request);

    if (a === "categories") {
      const parsed = validate(lmsCategorySchema, body);
      if (!parsed.ok) return parsed.error;
      return response(await upsertLmsCategory(auth, parsed.data));
    }
    if (a === "courses" && !b) {
      const parsed = validate(lmsCourseSchema, body);
      if (!parsed.ok) return parsed.error;
      return response(await upsertLmsCourse(auth, parsed.data));
    }
    if (a === "courses" && b && c === "publish") return response(await publishLmsCourse(auth, b));
    if (a === "courses" && b && c === "instructors") {
      const parsed = validate(lmsInstructorSchema, body);
      if (!parsed.ok) return parsed.error;
      return response(await upsertCourseInstructor(auth, b, parsed.data));
    }
    if (a === "courses" && b && c === "sections") {
      const parsed = validate(lmsSectionSchema, body);
      if (!parsed.ok) return parsed.error;
      return response(await upsertCourseSection(auth, b, parsed.data));
    }
    if (a === "courses" && b && c === "lessons") {
      const parsed = validate(lmsLessonSchema, body);
      if (!parsed.ok) return parsed.error;
      return response(await upsertCourseLesson(auth, b, parsed.data));
    }
    if (a === "courses" && b && c === "quizzes") {
      const parsed = validate(lmsQuizSchema, body);
      if (!parsed.ok) return parsed.error;
      return response(await upsertCourseQuiz(auth, b, parsed.data));
    }
    if (a === "courses" && b && c === "tasks") {
      const parsed = validate(lmsTaskSchema, body);
      if (!parsed.ok) return parsed.error;
      return response(await upsertCourseTask(auth, b, parsed.data));
    }
    if (a === "quizzes" && b && c === "questions") {
      return response(await addQuizQuestion(auth, b, body as Record<string, unknown>));
    }
    if (a === "courses" && b && c === "announcements") {
      const parsed = validate(lmsAnnouncementSchema, body);
      if (!parsed.ok) return parsed.error;
      return response(await upsertAnnouncement(auth, b, parsed.data));
    }
    if (a === "courses" && b && c === "community" && d === "posts") {
      const parsed = validate(lmsCommunityPostSchema, body);
      if (!parsed.ok) return parsed.error;
      return response(await createCommunityPost(auth, b, parsed.data));
    }
    if (a === "assignments") {
      const parsed = validate(lmsAssignmentSchema, body);
      if (!parsed.ok) return parsed.error;
      return response(await assignLmsLearning(auth, parsed.data));
    }
    if (a === "learning-paths") {
      const parsed = validate(lmsLearningPathSchema, body);
      if (!parsed.ok) return parsed.error;
      return response(await upsertLearningPath(auth, parsed.data));
    }
    if (a === "submissions" && b && c === "review") {
      const parsed = validate(lmsTaskReviewSchema, body);
      if (!parsed.ok) return parsed.error;
      return response(await reviewSubmission(auth, b, parsed.data));
    }
    if (a === "submissions" && b && c === "rubric-review") {
      const parsed = validate(lmsRubricReviewSchema, body);
      if (!parsed.ok) return parsed.error;
      return response(await reviewProjectWithRubric(auth, b, parsed.data));
    }
    if (a === "courses" && b && c === "resources") {
      const parsed = validate(lmsResourceSchema, body);
      if (!parsed.ok) return parsed.error;
      return response(await upsertCourseResource(auth, b, parsed.data));
    }
    if (a === "courses" && b && c === "workspace-config") {
      const parsed = validate(lmsWorkspaceConfigSchema, body);
      if (!parsed.ok) return parsed.error;
      return response(await upsertWorkspaceConfig(auth, b, parsed.data));
    }
    if (a === "tasks" && b && c === "rubric") {
      const parsed = validate(lmsRubricSchema, body);
      if (!parsed.ok) return parsed.error;
      return response(await upsertProjectRubric(auth, b, parsed.data));
    }
    if (a === "my" && b && c === "lessons" && d && e === "complete") return response(await completeLesson(auth, b, d));
    if (a === "my" && b && c === "quizzes" && d && e === "attempts") return response(await submitQuizAttempt(auth, b, d, (body as Record<string, unknown>).answers as Record<string, unknown> || {}));
    if (a === "my" && b && c === "tasks" && d && e === "submit") {
      const parsed = validate(lmsTaskSubmissionSchema, body);
      if (!parsed.ok) return parsed.error;
      return response(await submitTask(auth, b, d, parsed.data));
    }
    if (a === "my" && b && c === "feedback") {
      const parsed = validate(lmsFeedbackSchema, body);
      if (!parsed.ok) return parsed.error;
      return response(await submitFeedback(auth, b, parsed.data));
    }
    if (a === "community" && b === "posts" && c && d === "comments") {
      const parsed = validate(lmsCommunityCommentSchema, body);
      if (!parsed.ok) return parsed.error;
      return response(await createCommunityComment(auth, c, parsed.data));
    }
    if (a === "community" && b === "posts" && c && d === "reactions") return response(await reactToPost(auth, c, String((body as Record<string, unknown>).reaction_type || "like")));
    if (a === "community" && b === "posts" && c && d === "read") return response(await markPostRead(auth, c));
    if (a === "community" && b === "posts" && c && d === "accept-answer") return response(await updateCommunityPost(auth, c, { accepted_comment_id: (body as Record<string, unknown>).comment_id }));
    if (a === "community" && b === "posts" && c && d === "moderate") return response(await updateCommunityPost(auth, c, body as Record<string, unknown>));

    return NextResponse.json({ message: "LMS endpoint not found." }, { status: 404 });
  } catch (error) {
    return errorResponse(error);
  }
};

const patchHandler: Handler = async (request, auth, routeContext) => {
  try {
    const parts = await segments(routeContext);
    const [a, b, c, d] = parts;
    const body = await jsonBody(request);

    if (a === "categories" && b) {
      const parsed = validate(lmsCategorySchema.partial(), body);
      if (!parsed.ok) return parsed.error;
      return response(await upsertLmsCategory(auth, parsed.data, b));
    }
    if (a === "courses" && b && !c) {
      const parsed = validate(lmsCourseSchema.partial(), body);
      if (!parsed.ok) return parsed.error;
      return response(await upsertLmsCourse(auth, parsed.data, b));
    }
    if (a === "courses" && b && c === "instructors" && d) {
      const parsed = validate(lmsInstructorSchema.partial(), body);
      if (!parsed.ok) return parsed.error;
      return response(await upsertCourseInstructor(auth, b, parsed.data, d));
    }
    if (a === "courses" && b && c === "builder" && d === "overview") {
      const parsed = validate(lmsBuilderOverviewSchema, body);
      if (!parsed.ok) return parsed.error;
      return response(await updateCourseBuilderOverview(auth, b, parsed.data));
    }
    if (a === "courses" && b && c === "resources" && d) {
      const parsed = validate(lmsResourceSchema.partial(), body);
      if (!parsed.ok) return parsed.error;
      return response(await upsertCourseResource(auth, b, parsed.data, d));
    }
    if (a === "lessons" && b) {
      const parsed = validate(lmsLessonSchema.partial(), body);
      if (!parsed.ok) return parsed.error;
      return response(await updateCourseLessonById(auth, b, parsed.data));
    }
    if (a === "quizzes" && b) {
      const parsed = validate(lmsQuizSchema.partial(), body);
      if (!parsed.ok) return parsed.error;
      return response(await updateCourseQuizById(auth, b, parsed.data));
    }
    if (a === "tasks" && b) {
      const parsed = validate(lmsTaskSchema.partial(), body);
      if (!parsed.ok) return parsed.error;
      return response(await updateCourseTaskById(auth, b, parsed.data));
    }
    if (a === "announcements" && b) {
      const parsed = validate(lmsAnnouncementSchema.partial(), body);
      if (!parsed.ok) return parsed.error;
      return response(await upsertAnnouncement(auth, String((body as Record<string, unknown>).course_id || ""), parsed.data, b));
    }
    if (a === "community" && b === "posts" && c) return response(await updateCommunityPost(auth, c, body as Record<string, unknown>));
    if (a === "community" && b === "comments" && c) {
      const parsed = validate(lmsCommunityCommentSchema.partial().extend({ is_hidden: z.boolean().optional() }), body);
      if (!parsed.ok) return parsed.error;
      return response(await updateCommunityComment(auth, c, parsed.data));
    }
    if (a === "learning-paths" && b) {
      const parsed = validate(lmsLearningPathSchema.partial(), body);
      if (!parsed.ok) return parsed.error;
      return response(await upsertLearningPath(auth, parsed.data, b));
    }

    return NextResponse.json({ message: "LMS endpoint not found." }, { status: 404 });
  } catch (error) {
    return errorResponse(error);
  }
};

const deleteHandler: Handler = async (_request, auth, routeContext) => {
  try {
    const parts = await segments(routeContext);
    const [a, b, c, d] = parts;
    if (a === "categories" && b) return response(await archiveLmsCategory(auth, b));
    if (a === "resources" && b) return response(await deleteCourseResource(auth, b));
    if (a === "rubric-items" && b) return response(await deleteRubricItem(auth, b));
    if (a === "courses" && b && !c) return response(await archiveLmsCourse(auth, b));
    if (a === "courses" && b && c === "instructors" && d) return response(await removeCourseInstructor(auth, b, d));
    if (a === "lessons" && b) return response(await archiveCourseLesson(auth, b));
    if (a === "quizzes" && b === "questions" && c) return response(await deleteQuizQuestion(auth, c));
    if (a === "quizzes" && b) return response(await archiveCourseQuiz(auth, b));
    if (a === "tasks" && b) return response(await archiveCourseTask(auth, b));
    if (a === "announcements" && b) return response(await removeAnnouncement(auth, b));
    if (a === "community" && b === "posts" && c) return response(await updateCommunityPost(auth, c, { is_hidden: true }));
    if (a === "community" && b === "comments" && c) return response(await updateCommunityComment(auth, c, { is_hidden: true }));
    return NextResponse.json({ message: "LMS endpoint not found." }, { status: 404 });
  } catch (error) {
    return errorResponse(error);
  }
};

export const GET = withTenantContext(getHandler, { feature: "lms" });
export const POST = withTenantContext(postHandler, { feature: "lms" });
export const PATCH = withTenantContext(patchHandler, { feature: "lms" });
export const DELETE = withTenantContext(deleteHandler, { feature: "lms" });
