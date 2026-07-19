import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSuperadmin } from "@/lib/superadmin/server";

type OrganizationRpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { code?: string; message: string } | null;
  }>;
};

function validUuid(value: unknown) {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function requestId(request: NextRequest) {
  const supplied = request.headers.get("x-request-id")?.trim();
  return validUuid(supplied) ? supplied as string : crypto.randomUUID();
}

function rpcStatus(code?: string) {
  if (code === "42501") return 403;
  if (code === "P0002" || code === "23503") return 404;
  if (code === "23505" || code === "40001") return 409;
  if (["22023", "23514", "23502"].includes(code || "")) return 400;
  return 500;
}

function normalizeSlug(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return normalized || `org-${Date.now()}`;
}

function normalizeStatus(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "deleted" || normalized === "soft_deleted") return "Deleted";
  if (normalized === "suspended" || normalized === "inactive" || normalized === "disabled") return "Suspended";
  return "Active";
}

async function getOrganizationSummaries() {
  const admin = createAdminClient();
  const organizationsResult = await admin
    .from("organizations")
    .select("*")
    .order("created_at", { ascending: false });

  if (organizationsResult.error) {
    return { data: null, error: organizationsResult.error };
  }

  const organizations = (organizationsResult.data ?? []) as Record<string, unknown>[];
  const orgIds = organizations.map((organization) => String(organization.id ?? "")).filter(Boolean);

  const [membersResult, employeesResult] = await Promise.all([
    orgIds.length > 0
      ? admin.from("org_members").select("org_id, role").in("org_id", orgIds)
      : Promise.resolve({ data: [], error: null }),
    orgIds.length > 0
      ? admin.from("employees").select("org_id").in("org_id", orgIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (membersResult.error) {
    return { data: null, error: membersResult.error };
  }

  if (employeesResult.error) {
    return { data: null, error: employeesResult.error };
  }

  const membersByOrg = new Map<string, Record<string, unknown>[]>();
  for (const member of (membersResult.data ?? []) as Record<string, unknown>[]) {
    const orgId = String(member.org_id ?? "");
    const bucket = membersByOrg.get(orgId) ?? [];
    bucket.push(member);
    membersByOrg.set(orgId, bucket);
  }

  const employeesByOrg = new Map<string, number>();
  for (const employee of (employeesResult.data ?? []) as Record<string, unknown>[]) {
    const orgId = String(employee.org_id ?? "");
    employeesByOrg.set(orgId, (employeesByOrg.get(orgId) ?? 0) + 1);
  }

  return {
    data: organizations.map((organization) => {
      const orgId = String(organization.id ?? "");
      const members = (membersByOrg.get(orgId) ?? []).filter((member) => String(member.role ?? "") !== "super_admin");
      return {
        ...organization,
        memberCount: members.length,
        employeeCount: employeesByOrg.get(orgId) ?? 0,
        adminCount: members.filter((member) => String(member.role ?? "") === "admin").length,
        hrAdminCount: members.filter((member) => String(member.role ?? "") === "hr_admin").length,
        hrRecruitmentCount: members.filter((member) => String(member.role ?? "") === "hr_recruitment").length,
      };
    }),
    error: null,
  };
}

export async function GET() {
  const auth = await requireSuperadmin();
  if ("error" in auth) return auth.error;

  const result = await getOrganizationSummaries();

  if (result.error) {
    return NextResponse.json({ message: result.error.message }, { status: 500 });
  }

  return NextResponse.json({ data: result.data });
}

export async function POST(request: NextRequest) {
  const auth = await requireSuperadmin();
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  const rawSlug = String(body.slug || body.name || "");
  const status = normalizeStatus(String(body.status || "Active"));
  const commandId = body.command_id;

  if (name.length < 2) {
    return NextResponse.json({ message: "Organization name must contain at least two characters." }, { status: 400 });
  }
  if (!validUuid(commandId)) {
    return NextResponse.json({ message: "A valid command id is required." }, { status: 400 });
  }

  const admin = createAdminClient();
  const command = await (admin as unknown as OrganizationRpcClient).rpc("execute_organization_command", {
    p_actor_user_id: auth.user.id,
    p_request_id: requestId(request),
    p_command_id: commandId,
    p_action: "platform_create",
    p_target_org_id: null,
    p_expected_org_version: 0,
    p_expected_settings_version: 0,
    p_payload: {
      name,
      slug: normalizeSlug(rawSlug),
      status,
    },
  });
  if (command.error) {
    return NextResponse.json(
      { message: command.error.message },
      { status: rpcStatus(command.error.code) }
    );
  }

  const organization = command.data as Record<string, unknown> | null;

  return NextResponse.json({
    data: {
      ...organization,
      memberCount: 0,
      employeeCount: 0,
      adminCount: 0,
      hrAdminCount: 0,
      hrRecruitmentCount: 0,
    },
  });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireSuperadmin();
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "").trim();
  const name = typeof body.name === "string" ? body.name.trim() : undefined;
  const slug = typeof body.slug === "string" ? body.slug.trim() : undefined;
  const status = typeof body.status === "string" ? body.status.trim() : undefined;
  const commandId = body.command_id;

  if (!id) {
    return NextResponse.json({ message: "Organization id is required." }, { status: 400 });
  }
  if (!validUuid(commandId)) {
    return NextResponse.json({ message: "A valid command id is required." }, { status: 400 });
  }

  const updateValues: Record<string, unknown> = {};

  if (name) updateValues.name = name;
  if (slug !== undefined) updateValues.slug = normalizeSlug(slug || name || id);
  if (status) updateValues.status = normalizeStatus(status);
  if (Object.keys(updateValues).length === 0) {
    return NextResponse.json({ message: "No supported updates were provided." }, { status: 400 });
  }

  const admin = createAdminClient();
  const currentResult = await admin
    .from("organizations")
    .select("version")
    .eq("id", id)
    .maybeSingle();

  if (currentResult.error) {
    return NextResponse.json({ message: currentResult.error.message }, { status: 500 });
  }

  if (!currentResult.data) {
    return NextResponse.json({ message: "Organization was not found." }, { status: 404 });
  }

  const command = await (admin as unknown as OrganizationRpcClient).rpc("execute_organization_command", {
    p_actor_user_id: auth.user.id,
    p_request_id: requestId(request),
    p_command_id: commandId,
    p_action: "platform_update",
    p_target_org_id: id,
    p_expected_org_version: Number(currentResult.data.version ?? 0),
    p_expected_settings_version: null,
    p_payload: updateValues,
  });
  if (command.error) {
    return NextResponse.json(
      { message: command.error.message },
      { status: rpcStatus(command.error.code) }
    );
  }

  const summaryResult = await getOrganizationSummaries();
  if (summaryResult.error) {
    return NextResponse.json({ message: summaryResult.error.message }, { status: 500 });
  }

  const updatedSummary = (summaryResult.data ?? []).find(
    (organization) => String((organization as Record<string, unknown>).id ?? "") === id
  );

  return NextResponse.json({ data: updatedSummary ?? command.data });
}
