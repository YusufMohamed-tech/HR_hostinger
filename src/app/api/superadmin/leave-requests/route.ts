import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordPlatformAudit, requireSuperadmin } from "@/lib/superadmin/server";

const reviewableRoles = new Set(["hr_admin", "hr_recruitment"]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function leaveDays(startDateValue: unknown, endDateValue: unknown) {
  const startDate = typeof startDateValue === "string" ? new Date(startDateValue) : null;
  const endDate = typeof endDateValue === "string" ? new Date(endDateValue) : null;
  if (!startDate || !endDate || Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return 1;
  return Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1);
}

async function loadReviewableLeaveRequests() {
  const admin = createAdminClient();
  const requestsResult = await admin
    .from("leave_requests")
    .select("*, employee:employee_id(id, full_name, user_id, email, job_title)")
    .order("requested_at", { ascending: false });

  if (requestsResult.error) {
    return { data: null, error: requestsResult.error };
  }

  const requests = (requestsResult.data ?? []) as Record<string, unknown>[];
  const orgIds = Array.from(new Set(requests.map((request) => String(request.org_id || "")).filter(Boolean)));
  const userIds = Array.from(new Set(requests.map((request) => String(asRecord(request.employee).user_id || "")).filter(Boolean)));

  const [membersResult, organizationsResult] = await Promise.all([
    userIds.length
      ? admin.from("org_members").select("org_id, user_id, role").in("user_id", userIds)
      : Promise.resolve({ data: [], error: null }),
    orgIds.length
      ? admin.from("organizations").select("id, name, slug, status").in("id", orgIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (membersResult.error) return { data: null, error: membersResult.error };
  if (organizationsResult.error) return { data: null, error: organizationsResult.error };

  const membersByOrgUser = new Map(
    ((membersResult.data ?? []) as Record<string, unknown>[]).map((member) => [
      `${member.org_id}:${member.user_id}`,
      member,
    ])
  );
  const organizationsById = new Map(
    ((organizationsResult.data ?? []) as Record<string, unknown>[]).map((organization) => [
      String(organization.id || ""),
      organization,
    ])
  );

  return {
    data: requests
      .map((request) => {
        const employee = asRecord(request.employee);
        const userId = String(employee.user_id || "");
        const orgId = String(request.org_id || "");
        const member = membersByOrgUser.get(`${orgId}:${userId}`);
        const requesterRole = String(member?.role || "");
        return {
          ...request,
          requester_role: requesterRole,
          organization: organizationsById.get(orgId) ?? null,
          days: leaveDays(request.start_date, request.end_date),
        };
      })
      .filter((request) => reviewableRoles.has(String(request.requester_role || ""))),
    error: null,
  };
}

export async function GET() {
  const auth = await requireSuperadmin();
  if ("error" in auth) return auth.error;

  const result = await loadReviewableLeaveRequests();
  if (result.error) {
    return NextResponse.json({ message: result.error.message }, { status: 500 });
  }

  return NextResponse.json({ data: result.data });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireSuperadmin();
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const requestId = String(body.request_id || "").trim();
  const decision = String(body.decision || "").trim();
  const note = String(body.note || "").trim();

  if (!requestId) {
    return NextResponse.json({ message: "Leave request id is required." }, { status: 400 });
  }
  if (decision !== "approved" && decision !== "rejected") {
    return NextResponse.json({ message: "Decision must be approved or rejected." }, { status: 400 });
  }
  if (decision === "rejected" && !note) {
    return NextResponse.json({ message: "Rejection note is required." }, { status: 400 });
  }

  const admin = createAdminClient();
  const requestResult = await admin
    .from("leave_requests")
    .select("*, employee:employee_id(id, full_name, user_id, email)")
    .eq("id", requestId)
    .maybeSingle();

  if (requestResult.error) {
    return NextResponse.json({ message: requestResult.error.message }, { status: 500 });
  }
  if (!requestResult.data) {
    return NextResponse.json({ message: "Leave request was not found." }, { status: 404 });
  }

  const leaveRequest = requestResult.data as Record<string, unknown>;
  const currentStatus = String(leaveRequest.status || "");
  if (currentStatus !== "pending") {
    return NextResponse.json({ message: "Only pending leave requests can be reviewed." }, { status: 409 });
  }

  const employee = asRecord(leaveRequest.employee);
  const orgId = String(leaveRequest.org_id || "");
  const employeeId = String(leaveRequest.employee_id || "");
  const userId = String(employee.user_id || "");

  const memberResult = await admin
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();

  if (memberResult.error) {
    return NextResponse.json({ message: memberResult.error.message }, { status: 500 });
  }

  const requesterRole = String((memberResult.data as Record<string, unknown> | null)?.role || "");
  if (!reviewableRoles.has(requesterRole)) {
    return NextResponse.json({ message: "Only HR Admin and HR Recruitment leave requests can be reviewed here." }, { status: 403 });
  }

  const reviewResult = await admin.rpc("review_leave_request", {
    p_org_id: orgId,
    p_actor_user_id: auth.user.id,
    p_leave_request_id: requestId,
    p_command_id: crypto.randomUUID(),
    p_decision: decision as "approved" | "rejected",
    p_note: note || null,
  });

  if (reviewResult.error) {
    const status = reviewResult.error.code === "42501"
      ? 403
      : reviewResult.error.code === "23505"
        ? 409
        : reviewResult.error.code === "P0001"
          ? 422
          : 500;
    return NextResponse.json({ message: reviewResult.error.message }, { status });
  }

  await recordPlatformAudit({
    actorUserId: auth.user.id,
    action: decision === "approved" ? "leave_request.approved" : "leave_request.rejected",
    targetOrgId: orgId,
    targetUserId: userId || null,
    targetType: "leave_request",
    targetId: requestId,
    metadata: {
      employee_id: employeeId,
      requester_role: requesterRole,
      leave_type: String(leaveRequest.leave_type || ""),
      decision,
      note,
    },
  });

  return NextResponse.json({ data: reviewResult.data?.[0] ?? null });
}
