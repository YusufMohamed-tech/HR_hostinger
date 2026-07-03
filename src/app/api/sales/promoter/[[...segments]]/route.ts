import { NextRequest, NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { requirePromoterAccess, requirePromoterAdmin } from "@/lib/server/promoter-auth";
import { recommendationSnapshot, recommendOffer } from "@/lib/promoter/recommendation";
import {
  promoterCampaignSchema,
  promoterLeadCaptureSchema,
  promoterLeadPatchSchema,
  promoterReferenceSchema,
  promoterSettingsSchema,
  telecomOfferSchema,
} from "@/lib/promoter/schemas";
import type { PromoterSettings, TelecomOffer } from "@/types/promoter";

export const dynamic = "force-dynamic";

type DbResult = {
  data: unknown;
  error: { message?: string; code?: string } | null;
  count?: number | null;
};

type QueryBuilder = {
  select: (...args: unknown[]) => QueryBuilder;
  insert: (...args: unknown[]) => QueryBuilder;
  update: (...args: unknown[]) => QueryBuilder;
  delete: (...args: unknown[]) => QueryBuilder;
  upsert: (...args: unknown[]) => QueryBuilder;
  eq: (column: string, value: unknown) => QueryBuilder;
  neq: (column: string, value: unknown) => QueryBuilder;
  gte: (column: string, value: unknown) => QueryBuilder;
  lte: (column: string, value: unknown) => QueryBuilder;
  in: (column: string, values: unknown[]) => QueryBuilder;
  is: (column: string, value: unknown) => QueryBuilder;
  order: (column: string, options?: Record<string, unknown>) => QueryBuilder;
  limit: (count: number) => QueryBuilder;
  maybeSingle: () => Promise<DbResult>;
  single: () => Promise<DbResult>;
  then: PromiseLike<DbResult>["then"];
};

type UntypedSupabase = {
  from: (table: string) => QueryBuilder;
};

type AuthContext = {
  user: User;
  orgId: string;
  role: string;
  isManager: boolean;
  admin: unknown;
};

type RouteContext = {
  params?: {
    segments?: string[];
  };
};

const managerRoles = new Set(["admin", "hr_admin", "sales_manager"]);
const defaultWeights = { savings: 0.6, data: 0.2, bundle: 0.1, priority: 0.1 };

function database(admin: unknown) {
  return admin as UntypedSupabase;
}

function json(data: unknown, status = 200) {
  return NextResponse.json({ data }, { status });
}

function message(error: unknown, status = 500) {
  return NextResponse.json(
    { message: error instanceof Error ? error.message : String(error || "Promoter request failed.") },
    { status }
  );
}

function parseError(error: unknown) {
  if (error && typeof error === "object" && "issues" in error) {
    const issue = (error as { issues?: Array<{ message?: string }> }).issues?.[0];
    return issue?.message || "Invalid input";
  }
  return error instanceof Error ? error.message : "Invalid input";
}

function segmentsOf(context: RouteContext) {
  return context.params?.segments || [];
}

function row(value: unknown) {
  return (value || {}) as Record<string, unknown>;
}

function rows(value: unknown) {
  return Array.isArray(value) ? value as Record<string, unknown>[] : [];
}

function asString(value: unknown) {
  return String(value || "").trim();
}

function asNumber(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function dateFilter(value: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function isManagerRole(role: string) {
  return managerRoles.has(role);
}

function canAccessLead(auth: AuthContext, lead: Record<string, unknown>) {
  return isManagerRole(auth.role)
    || String(lead.promoter_id || "") === auth.user.id
    || String(lead.assigned_agent_id || "") === auth.user.id;
}

function offerFromRow(value: Record<string, unknown>): TelecomOffer {
  return {
    id: asString(value.id),
    organization_id: asString(value.organization_id),
    company_id: value.company_id ? asString(value.company_id) : null,
    product_id: value.product_id ? asString(value.product_id) : null,
    name_ar: asString(value.name_ar),
    name_en: value.name_en ? asString(value.name_en) : null,
    offer_target: asString(value.offer_target) as TelecomOffer["offer_target"],
    monthly_price: asNumber(value.monthly_price),
    contract_months: value.contract_months === null || value.contract_months === undefined ? null : asNumber(value.contract_months),
    data_gb: value.data_gb === null || value.data_gb === undefined ? null : asNumber(value.data_gb),
    minutes: value.minutes === null || value.minutes === undefined ? null : asNumber(value.minutes),
    sim_count: value.sim_count === null || value.sim_count === undefined ? null : asNumber(value.sim_count),
    benefits_ar: Array.isArray(value.benefits_ar) ? value.benefits_ar.map(String) : [],
    benefits_en: Array.isArray(value.benefits_en) ? value.benefits_en.map(String) : [],
    eligibility: row(value.eligibility) as TelecomOffer["eligibility"],
    priority: asNumber(value.priority),
    is_active: value.is_active !== false,
    created_by: value.created_by ? asString(value.created_by) : null,
    created_at: asString(value.created_at),
    updated_at: asString(value.updated_at),
  };
}

function parseListText(value: unknown) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value || "")
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function readBody(request: NextRequest) {
  return request.json().catch(() => ({}));
}

async function loadSettings(auth: AuthContext, companyId?: string | null): Promise<PromoterSettings> {
  let query = database(auth.admin)
    .from("promoter_settings")
    .select("*")
    .eq("organization_id", auth.orgId)
    .limit(1);

  query = companyId ? query.eq("company_id", companyId) : query.is("company_id", null);
  const result = await query.maybeSingle();
  if (result.error) throw new Error(result.error.message || "Unable to load promoter settings.");

  const settings = row(result.data);
  return {
    id: asString(settings.id),
    organization_id: auth.orgId,
    company_id: settings.company_id ? asString(settings.company_id) : null,
    weights: (row(settings.weights) as PromoterSettings["weights"]) || defaultWeights,
    consent_version: asString(settings.consent_version) || "v1",
    consent_text_ar: settings.consent_text_ar ? asString(settings.consent_text_ar) : null,
    consent_text_en: settings.consent_text_en ? asString(settings.consent_text_en) : null,
    created_at: asString(settings.created_at),
    updated_at: asString(settings.updated_at),
  };
}

async function insertLeadEvent(auth: AuthContext, leadId: string, eventType: string, meta?: Record<string, unknown>) {
  await database(auth.admin).from("promoter_lead_events").insert({
    organization_id: auth.orgId,
    lead_id: leadId,
    event_type: eventType,
    actor_id: auth.user.id,
    meta: meta || {},
  });
}

async function notifyAgent(auth: AuthContext, assignedAgentId: string, leadId: string, fullName: string) {
  if (!assignedAgentId) return;
  await database(auth.admin).from("notifications").insert({
    org_id: auth.orgId,
    user_id: assignedAgentId,
    title: "عميل ترويجي جديد",
    body: fullName,
    type: "sales",
    link: `/sales/leads?lead=${encodeURIComponent(leadId)}`,
    is_read: false,
  });
}

async function handleOffers(request: NextRequest, auth: AuthContext, segments: string[]) {
  const offerId = segments[1] || "";
  const db = database(auth.admin);

  if (request.method === "GET") {
    const activeOnly = request.nextUrl.searchParams.get("active_only") !== "false";
    const companyId = asString(request.nextUrl.searchParams.get("company_id"));
    let query = db
      .from("telecom_offers")
      .select("*")
      .eq("organization_id", auth.orgId)
      .order("priority", { ascending: false })
      .order("name_ar", { ascending: true });
    if (activeOnly) query = query.eq("is_active", true);
    if (companyId) query = query.eq("company_id", companyId);
    const result = await query;
    if (result.error) return message(result.error.message, 500);
    return json(rows(result.data));
  }

  if (request.method === "POST") {
    if (!auth.isManager) return message("Promoter manager access is required.", 403);
    const body = await readBody(request);
    const parsed = telecomOfferSchema.safeParse({
      ...body,
      benefits_ar: parseListText(row(body).benefits_ar),
      benefits_en: parseListText(row(body).benefits_en),
    });
    if (!parsed.success) return message(parseError(parsed.error), 400);

    const result = await db.from("telecom_offers").insert({
      ...parsed.data,
      organization_id: auth.orgId,
      created_by: auth.user.id,
    }).select("*").single();
    if (result.error) return message(result.error.message, 500);
    return json(result.data, 201);
  }

  if (!offerId) return message("Offer id is required.", 400);
  if (!auth.isManager) return message("Promoter manager access is required.", 403);

  if (request.method === "PATCH") {
    const body = await readBody(request);
    const parsed = telecomOfferSchema.partial().safeParse({
      ...body,
      benefits_ar: "benefits_ar" in row(body) ? parseListText(row(body).benefits_ar) : undefined,
      benefits_en: "benefits_en" in row(body) ? parseListText(row(body).benefits_en) : undefined,
    });
    if (!parsed.success) return message(parseError(parsed.error), 400);
    const result = await db
      .from("telecom_offers")
      .update(parsed.data)
      .eq("organization_id", auth.orgId)
      .eq("id", offerId)
      .select("*")
      .single();
    if (result.error) return message(result.error.message, 500);
    return json(result.data);
  }

  if (request.method === "DELETE") {
    const result = await db
      .from("telecom_offers")
      .update({ is_active: false })
      .eq("organization_id", auth.orgId)
      .eq("id", offerId)
      .select("id")
      .single();
    if (result.error) return message(result.error.message, 500);
    return json(result.data);
  }

  return message("Method not allowed", 405);
}

async function handleReference(request: NextRequest, auth: AuthContext) {
  const db = database(auth.admin);

  if (request.method === "GET") {
    const kind = asString(request.nextUrl.searchParams.get("kind"));
    let query = db
      .from("promoter_reference_values")
      .select("*")
      .eq("organization_id", auth.orgId)
      .order("kind", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("label_ar", { ascending: true });
    if (kind) query = query.eq("kind", kind);
    const result = await query;
    if (result.error) return message(result.error.message, 500);
    return json(rows(result.data));
  }

  if (!auth.isManager) return message("Promoter manager access is required.", 403);
  const body = await readBody(request);
  const parsed = promoterReferenceSchema.safeParse(body);
  if (!parsed.success) return message(parseError(parsed.error), 400);

  if (request.method === "POST") {
    const result = await db.from("promoter_reference_values").insert({
      ...parsed.data,
      organization_id: auth.orgId,
    }).select("*").single();
    if (result.error) return message(result.error.message, 500);
    return json(result.data, 201);
  }

  if (request.method === "PATCH") {
    if (!parsed.data.id) return message("Reference id is required.", 400);
    const { id, ...values } = parsed.data;
    const result = await db
      .from("promoter_reference_values")
      .update(values)
      .eq("organization_id", auth.orgId)
      .eq("id", id)
      .select("*")
      .single();
    if (result.error) return message(result.error.message, 500);
    return json(result.data);
  }

  return message("Method not allowed", 405);
}

async function handleSettings(request: NextRequest, auth: AuthContext) {
  const companyId = asString(request.nextUrl.searchParams.get("company_id")) || null;
  const db = database(auth.admin);

  if (request.method === "GET") {
    return json(await loadSettings(auth, companyId));
  }

  if (request.method !== "PATCH") return message("Method not allowed", 405);
  if (!auth.isManager) return message("Promoter manager access is required.", 403);

  const parsed = promoterSettingsSchema.safeParse(await readBody(request));
  if (!parsed.success) return message(parseError(parsed.error), 400);
  const nextCompanyId = parsed.data.company_id || null;
  let current = db.from("promoter_settings").select("id").eq("organization_id", auth.orgId).limit(1);
  current = nextCompanyId ? current.eq("company_id", nextCompanyId) : current.is("company_id", null);
  const currentResult = await current.maybeSingle();
  if (currentResult.error) return message(currentResult.error.message, 500);

  const payload = {
    organization_id: auth.orgId,
    company_id: nextCompanyId,
    weights: parsed.data.weights,
    consent_version: parsed.data.consent_version,
    consent_text_ar: parsed.data.consent_text_ar || null,
    consent_text_en: parsed.data.consent_text_en || null,
  };

  const result = currentResult.data
    ? await db.from("promoter_settings").update(payload).eq("id", asString(row(currentResult.data).id)).select("*").single()
    : await db.from("promoter_settings").insert(payload).select("*").single();
  if (result.error) return message(result.error.message, 500);
  return json(result.data);
}

async function handleCampaigns(request: NextRequest, auth: AuthContext) {
  const db = database(auth.admin);

  if (request.method === "GET") {
    const activeOnly = request.nextUrl.searchParams.get("active_only") === "true";
    const companyId = asString(request.nextUrl.searchParams.get("company_id"));
    let query = db
      .from("promoter_campaigns")
      .select("*")
      .eq("organization_id", auth.orgId)
      .order("created_at", { ascending: false });
    if (activeOnly) query = query.eq("is_active", true);
    if (companyId) query = query.eq("company_id", companyId);
    const result = await query;
    if (result.error) return message(result.error.message, 500);
    return json(rows(result.data));
  }

  if (!auth.isManager) return message("Promoter manager access is required.", 403);
  const parsed = promoterCampaignSchema.safeParse(await readBody(request));
  if (!parsed.success) return message(parseError(parsed.error), 400);

  if (request.method === "POST") {
    const result = await db.from("promoter_campaigns").insert({
      ...parsed.data,
      organization_id: auth.orgId,
    }).select("*").single();
    if (result.error) return message(result.error.message, 500);
    return json(result.data, 201);
  }

  if (request.method === "PATCH") {
    if (!parsed.data.id) return message("Campaign id is required.", 400);
    const { id, ...values } = parsed.data;
    const result = await db
      .from("promoter_campaigns")
      .update(values)
      .eq("organization_id", auth.orgId)
      .eq("id", id)
      .select("*")
      .single();
    if (result.error) return message(result.error.message, 500);
    return json(result.data);
  }

  return message("Method not allowed", 405);
}

async function queryLeads(request: NextRequest, auth: AuthContext) {
  const search = request.nextUrl.searchParams;
  const db = database(auth.admin);
  let query = db
    .from("promoter_leads")
    .select("*")
    .eq("organization_id", auth.orgId)
    .order("created_at", { ascending: false });

  if (!isManagerRole(auth.role)) {
    query = auth.role === "promoter" ? query.eq("promoter_id", auth.user.id) : query.eq("assigned_agent_id", auth.user.id);
  }
  const status = asString(search.get("status"));
  const city = asString(search.get("city"));
  const operator = asString(search.get("operator"));
  const campaignId = asString(search.get("campaign_id"));
  const dateFrom = dateFilter(search.get("date_from"));
  const dateTo = dateFilter(search.get("date_to"));
  if (status && status !== "all") query = query.eq("status", status);
  if (city) query = query.eq("city", city);
  if (operator) query = query.eq("current_operator", operator);
  if (campaignId) query = query.eq("campaign_id", campaignId);
  if (dateFrom) query = query.gte("created_at", `${dateFrom}T00:00:00.000Z`);
  if (dateTo) query = query.lte("created_at", `${dateTo}T23:59:59.999Z`);

  const result = await query;
  if (result.error) throw new Error(result.error.message || "Unable to load leads.");
  return rows(result.data);
}

function leadsCsv(leads: Record<string, unknown>[]) {
  const headers = ["created_at", "full_name", "mobile", "city", "current_operator", "status", "estimated_savings"];
  const body = leads.map((lead) => headers.map((header) => `"${String(lead[header] || "").replace(/"/g, '""')}"`).join(","));
  return [headers.join(","), ...body].join("\n");
}

async function handleLeads(request: NextRequest, auth: AuthContext, segments: string[]) {
  const db = database(auth.admin);
  const leadId = segments[1] === "export" ? "" : segments[1] || "";

  if (request.method === "GET" && segments[1] === "export") {
    const leads = await queryLeads(request, auth);
    return new NextResponse(leadsCsv(leads), {
      headers: {
        "Content-Type": "text/csv;charset=utf-8",
        "Content-Disposition": `attachment; filename="promoter-leads.csv"`,
      },
    });
  }

  if (request.method === "GET" && leadId) {
    const result = await db
      .from("promoter_leads")
      .select("*")
      .eq("organization_id", auth.orgId)
      .eq("id", leadId)
      .maybeSingle();
    if (result.error) return message(result.error.message, 500);
    const lead = row(result.data);
    if (!lead.id) return message("Lead was not found.", 404);
    if (!canAccessLead(auth, lead)) return message("Forbidden", 403);
    return json(lead);
  }

  if (request.method === "GET") {
    try {
      return json(await queryLeads(request, auth));
    } catch (error) {
      return message(error, 500);
    }
  }

  if (request.method === "POST") {
    const parsed = promoterLeadCaptureSchema.safeParse(await readBody(request));
    if (!parsed.success) return message(parseError(parsed.error), 400);

    const settings = await loadSettings(auth, parsed.data.company_id);
    const offersResult = await db
      .from("telecom_offers")
      .select("*")
      .eq("organization_id", auth.orgId)
      .eq("is_active", true);
    if (offersResult.error) return message(offersResult.error.message, 500);

    const offers = rows(offersResult.data).map(offerFromRow);
    const recommendation = recommendOffer(parsed.data, offers, settings.weights);
    const snapshot = recommendationSnapshot(recommendation);
    const manualOffer = parsed.data.pushed_offer_id || null;
    const selectedOfferId = manualOffer || recommendation.best?.offer.id || null;
    const estimatedSavings = recommendation.best?.estimatedSavings || 0;

    const result = await db.from("promoter_leads").insert({
      ...parsed.data,
      organization_id: auth.orgId,
      promoter_id: auth.user.id,
      recommended_offer_id: recommendation.best?.offer.id || null,
      pushed_offer_id: manualOffer,
      estimated_savings: estimatedSavings,
      recommendation_source: manualOffer ? "manual" : "auto",
      recommendation_snapshot: snapshot,
      status: selectedOfferId ? (parsed.data.assigned_agent_id ? "sent_to_agent" : "recommended") : "captured",
      consent_version: parsed.data.consent_version || settings.consent_version,
      consent_at: new Date().toISOString(),
    }).select("*").single();
    if (result.error) return message(result.error.message, 500);

    const lead = row(result.data);
    await insertLeadEvent(auth, asString(lead.id), "captured", { selected_offer_id: selectedOfferId });
    if (selectedOfferId) await insertLeadEvent(auth, asString(lead.id), manualOffer ? "manual_offer_pushed" : "recommended", snapshot);
    if (parsed.data.assigned_agent_id) {
      await insertLeadEvent(auth, asString(lead.id), "sent_to_agent", { assigned_agent_id: parsed.data.assigned_agent_id });
      await notifyAgent(auth, parsed.data.assigned_agent_id, asString(lead.id), parsed.data.full_name);
    }

    return json(lead, 201);
  }

  if (request.method === "PATCH") {
    if (!leadId) return message("Lead id is required.", 400);
    const parsed = promoterLeadPatchSchema.safeParse(await readBody(request));
    if (!parsed.success) return message(parseError(parsed.error), 400);

    const currentResult = await db
      .from("promoter_leads")
      .select("*")
      .eq("organization_id", auth.orgId)
      .eq("id", leadId)
      .maybeSingle();
    if (currentResult.error) return message(currentResult.error.message, 500);
    const current = row(currentResult.data);
    if (!current.id) return message("Lead was not found.", 404);
    if (!canAccessLead(auth, current)) return message("Forbidden", 403);
    if (!isManagerRole(auth.role) && auth.role !== "sales") return message("Only managers or assigned agents can update leads.", 403);

    const values: Record<string, unknown> = { ...parsed.data };
    if (parsed.data.status && parsed.data.status !== current.status) {
      values.agent_reviewed_at = parsed.data.agent_reviewed_at || new Date().toISOString();
    }

    const result = await db
      .from("promoter_leads")
      .update(values)
      .eq("organization_id", auth.orgId)
      .eq("id", leadId)
      .select("*")
      .single();
    if (result.error) return message(result.error.message, 500);

    const next = row(result.data);
    const eventType = asString(parsed.data.status) || (parsed.data.assigned_agent_id ? "sent_to_agent" : "updated");
    await insertLeadEvent(auth, leadId, eventType, values);
    if (parsed.data.assigned_agent_id && parsed.data.assigned_agent_id !== current.assigned_agent_id) {
      await notifyAgent(auth, parsed.data.assigned_agent_id, leadId, asString(next.full_name));
    }
    return json(next);
  }

  return message("Method not allowed", 405);
}

async function handleDashboard(request: NextRequest, auth: AuthContext) {
  if (!auth.isManager) return message("Promoter manager access is required.", 403);
  const leads = await queryLeads(request, auth);
  const total = leads.length;
  const converted = leads.filter((lead) => lead.status === "converted").length;
  const sentToAgent = leads.filter((lead) => lead.status === "sent_to_agent" || lead.status === "converted").length;
  const estimatedSavings = leads.reduce((sum, lead) => sum + asNumber(lead.estimated_savings), 0);

  const group = (key: string) => {
    const map = new Map<string, number>();
    for (const lead of leads) {
      const value = asString(lead[key]) || "غير محدد";
      map.set(value, (map.get(value) || 0) + 1);
    }
    return Array.from(map.entries()).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
  };

  return json({
    leads: total,
    sentToAgent,
    converted,
    conversionRate: total ? Math.round((converted / total) * 100) : 0,
    estimatedSavings,
    byStatus: group("status"),
    byCity: group("city"),
    byOperator: group("current_operator"),
    byOffer: group("recommended_offer_id"),
    byPromoter: group("promoter_id"),
  });
}

async function dispatch(request: NextRequest, auth: AuthContext, context: RouteContext) {
  const segments = segmentsOf(context);
  const resource = segments[0] || "dashboard";

  if (resource === "offers") return handleOffers(request, auth, segments);
  if (resource === "reference") return handleReference(request, auth);
  if (resource === "settings") return handleSettings(request, auth);
  if (resource === "campaigns") return handleCampaigns(request, auth);
  if (resource === "leads") return handleLeads(request, auth, segments);
  if (resource === "dashboard") return handleDashboard(request, auth);
  return message("Promoter route was not found.", 404);
}

async function authorize(request: NextRequest, context: RouteContext) {
  const segments = segmentsOf(context);
  const resource = segments[0] || "dashboard";
  const method = request.method;
  const managerOnly = resource === "dashboard"
    || resource === "settings" && method !== "GET"
    || resource === "offers" && method !== "GET"
    || resource === "reference" && method !== "GET"
    || resource === "campaigns" && method !== "GET";

  const auth = managerOnly
    ? await requirePromoterAdmin()
    : await requirePromoterAccess({ captureOnly: resource === "leads" && method === "POST" });
  if ("error" in auth) return auth.error;
  return dispatch(request, auth, context);
}

export function GET(request: NextRequest, context: RouteContext) {
  return authorize(request, context);
}

export function POST(request: NextRequest, context: RouteContext) {
  return authorize(request, context);
}

export function PATCH(request: NextRequest, context: RouteContext) {
  return authorize(request, context);
}

export function DELETE(request: NextRequest, context: RouteContext) {
  return authorize(request, context);
}
