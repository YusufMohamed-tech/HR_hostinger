import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenantContext, type TenantAuthContext } from "@/lib/server/tenant-context";
import {
  completeClassroomLesson,
  createLearnerBookmark,
  createLearnerNote,
  deleteLearnerBookmark,
  deleteLearnerNote,
  getClassroomCertificate,
  getClassroomCommunity,
  getClassroomDashboard,
  getClassroomLesson,
  getClassroomProject,
  getClassroomQuiz,
  getClassroomResources,
  getClassroomSyllabus,
  getClassroomWorkspace,
  getLearnerHome,
  listLearnerBookmarks,
  listLearnerNotes,
  recordActivityEvent,
  submitClassroomProject,
  submitClassroomQuiz,
  updateLearnerNote,
  updateWorkspaceState,
} from "@/lib/server/learn";
import {
  getValidationMessage,
  lmsActivityEventSchema,
  lmsBookmarkSchema,
  lmsNoteSchema,
  lmsTaskSubmissionSchema,
  lmsWorkspaceStateSchema,
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
  const message = error instanceof Error ? error.message : "Unable to complete learning request.";
  if (message === "Forbidden") return NextResponse.json({ message }, { status: 403 });
  if (message.toLowerCase().includes("not found")) return NextResponse.json({ message }, { status: 404 });
  if (
    message.includes("required") ||
    message.includes("Maximum") ||
    message.includes("Select") ||
    message.includes("Learners cannot") ||
    message.includes("before submitting")
  ) {
    return NextResponse.json({ message }, { status: 400 });
  }
  return NextResponse.json({ message }, { status: 500 });
}

const getHandler: Handler = async (_request, auth, routeContext) => {
  try {
    const [a, b, c] = await segments(routeContext);
    if (!a) return response(await getLearnerHome(auth));
    if (a && !b) return response(await getClassroomDashboard(auth, a));
    if (a && b === "syllabus") return response(await getClassroomSyllabus(auth, a));
    if (a && b === "lesson" && c) return response(await getClassroomLesson(auth, a, c));
    if (a && b === "quiz" && c) return response(await getClassroomQuiz(auth, a, c));
    if (a && b === "project" && c) return response(await getClassroomProject(auth, a, c));
    if (a && b === "workspace") return response(await getClassroomWorkspace(auth, a));
    if (a && b === "resources") return response(await getClassroomResources(auth, a));
    if (a && b === "community") return response(await getClassroomCommunity(auth, a));
    if (a && b === "certificate") return response(await getClassroomCertificate(auth, a));
    if (a && b === "notes") return response(await listLearnerNotes(auth, a));
    if (a && b === "bookmarks") return response(await listLearnerBookmarks(auth, a));
    return NextResponse.json({ message: "Learning endpoint not found." }, { status: 404 });
  } catch (error) {
    return errorResponse(error);
  }
};

const postHandler: Handler = async (request, auth, routeContext) => {
  try {
    const [a, b, c, d] = await segments(routeContext);
    const body = await jsonBody(request);

    if (a && b === "lesson" && c && d === "complete") return response(await completeClassroomLesson(auth, a, c));
    if (a && b === "quiz" && c && d === "attempts") {
      return response(await submitClassroomQuiz(auth, a, c, (body as Record<string, unknown>).answers as Record<string, unknown> || {}));
    }
    if (a && b === "project" && c && d === "submit") {
      const parsed = validate(lmsTaskSubmissionSchema, body);
      if (!parsed.ok) return parsed.error;
      return response(await submitClassroomProject(auth, a, c, parsed.data));
    }
    if (a && b === "notes" && !c) {
      const parsed = validate(lmsNoteSchema, body);
      if (!parsed.ok) return parsed.error;
      return response(await createLearnerNote(auth, a, parsed.data));
    }
    if (a && b === "bookmarks" && !c) {
      const parsed = validate(lmsBookmarkSchema, body);
      if (!parsed.ok) return parsed.error;
      return response(await createLearnerBookmark(auth, a, parsed.data));
    }
    if (a && b === "activity") {
      const parsed = validate(lmsActivityEventSchema, body);
      if (!parsed.ok) return parsed.error;
      return response(await recordActivityEvent(auth, a, parsed.data));
    }
    return NextResponse.json({ message: "Learning endpoint not found." }, { status: 404 });
  } catch (error) {
    return errorResponse(error);
  }
};

const patchHandler: Handler = async (request, auth, routeContext) => {
  try {
    const [a, b, c] = await segments(routeContext);
    const body = await jsonBody(request);

    if (a && b === "workspace-state") {
      const parsed = validate(lmsWorkspaceStateSchema, body);
      if (!parsed.ok) return parsed.error;
      return response(await updateWorkspaceState(auth, a, parsed.data));
    }
    if (a && b === "notes" && c) {
      const parsed = validate(lmsNoteSchema.partial(), body);
      if (!parsed.ok) return parsed.error;
      return response(await updateLearnerNote(auth, c, parsed.data));
    }
    return NextResponse.json({ message: "Learning endpoint not found." }, { status: 404 });
  } catch (error) {
    return errorResponse(error);
  }
};

const deleteHandler: Handler = async (_request, auth, routeContext) => {
  try {
    const [a, b, c] = await segments(routeContext);
    if (a && b === "notes" && c) return response(await deleteLearnerNote(auth, c));
    if (a && b === "bookmarks" && c) return response(await deleteLearnerBookmark(auth, c));
    return NextResponse.json({ message: "Learning endpoint not found." }, { status: 404 });
  } catch (error) {
    return errorResponse(error);
  }
};

export const GET = withTenantContext(getHandler, { feature: "lms" });
export const POST = withTenantContext(postHandler, { feature: "lms" });
export const PATCH = withTenantContext(patchHandler, { feature: "lms" });
export const DELETE = withTenantContext(deleteHandler, { feature: "lms" });
