import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordPlatformAudit, requireSuperadmin } from "@/lib/superadmin/server";

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

  if (!name) {
    return NextResponse.json({ message: "Organization name is required." }, { status: 400 });
  }

  const admin = createAdminClient();
  const createResult = await admin
    .from("organizations")
    .insert({
      name,
      slug: normalizeSlug(rawSlug),
      status,
    } as never)
    .select()
    .single();

  if (createResult.error) {
    return NextResponse.json({ message: createResult.error.message }, { status: 500 });
  }

  const organization = createResult.data as Record<string, unknown> | null;
  await recordPlatformAudit({
    actorUserId: auth.user.id,
    action: "organization.created",
    targetOrgId: String(organization?.id || ""),
    targetType: "organization",
    targetId: String(organization?.id || ""),
    metadata: {
      name,
      slug: String(organization?.slug || ""),
      status,
    },
  });

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

  if (!id) {
    return NextResponse.json({ message: "Organization id is required." }, { status: 400 });
  }

  const updateValues: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (name) updateValues.name = name;
  if (slug !== undefined) updateValues.slug = normalizeSlug(slug || name || id);
  if (status) updateValues.status = normalizeStatus(status);

  const admin = createAdminClient();
  const currentResult = await admin
    .from("organizations")
    .select("status")
    .eq("id", id)
    .maybeSingle();

  if (currentResult.error) {
    return NextResponse.json({ message: currentResult.error.message }, { status: 500 });
  }

  const updateResult = await admin
    .from("organizations")
    .update(updateValues as never)
    .eq("id", id)
    .select()
    .single();

  if (updateResult.error) {
    return NextResponse.json({ message: updateResult.error.message }, { status: 500 });
  }

  const summaryResult = await getOrganizationSummaries();
  if (summaryResult.error) {
    return NextResponse.json({ message: summaryResult.error.message }, { status: 500 });
  }

  const updatedSummary = (summaryResult.data ?? []).find(
    (organization) => String((organization as Record<string, unknown>).id ?? "") === id
  );

  const previousStatus = String((currentResult.data as Record<string, unknown> | null)?.status || "");
  const nextStatus = String(updateValues.status || previousStatus);
  const statusChanged = status && previousStatus.toLowerCase() !== nextStatus.toLowerCase();
  const action = statusChanged
    ? nextStatus.toLowerCase() === "suspended"
      ? "organization.suspended"
      : "organization.activated"
    : "organization.updated";

  await recordPlatformAudit({
    actorUserId: auth.user.id,
    action,
    targetOrgId: id,
    targetType: "organization",
    targetId: id,
    metadata: {
      updates: updateValues,
      previous_status: previousStatus || null,
      next_status: nextStatus || null,
    },
  });

  return NextResponse.json({ data: updatedSummary ?? updateResult.data });
}
