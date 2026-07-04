import { NextRequest, NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { requireMerchantAccess } from "@/lib/server/merchant-auth";
import {
  assignSimsToMerchantSchema,
  collectMerchantCashSchema,
  createMerchantSchema,
  merchantRecordSaleSchema,
  merchantReturnSimSchema,
  merchantSimRequestSchema,
  reviewMerchantRequestSchema,
  updateMerchantSchema,
} from "@/lib/merchants/schemas";

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
  in: (column: string, values: unknown[]) => QueryBuilder;
  is: (column: string, value: unknown) => QueryBuilder;
  order: (column: string, options?: Record<string, unknown>) => QueryBuilder;
  limit: (count: number) => QueryBuilder;
  maybeSingle: () => Promise<DbResult>;
  single: () => Promise<DbResult>;
  then: PromiseLike<DbResult>["then"];
};

type UntypedSupabase = { from: (table: string) => QueryBuilder };

type AdminAuthClient = {
  auth: {
    admin: {
      createUser: (attrs: Record<string, unknown>) => Promise<{
        data: { user: { id: string } | null };
        error: { message?: string } | null;
      }>;
      listUsers: (params: { page: number; perPage: number }) => Promise<{
        data: { users: Array<{ id: string; email?: string | null }> };
        error: { message?: string } | null;
      }>;
    };
  };
};

type AuthContext = {
  user: User;
  orgId: string;
  role: string;
  isManager: boolean;
  isAgent: boolean;
  isMerchant: boolean;
  admin: unknown;
};

type RouteContext = { params?: { segments?: string[] } };

function database(admin: unknown) {
  return admin as UntypedSupabase;
}
function adminAuth(admin: unknown) {
  return admin as AdminAuthClient;
}
function json(data: unknown, status = 200) {
  return NextResponse.json({ data }, { status });
}
function message(error: unknown, status = 500) {
  return NextResponse.json(
    { message: error instanceof Error ? error.message : String(error || "Merchant request failed.") },
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
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}
function asString(value: unknown) {
  return String(value || "").trim();
}
function asNumber(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}
async function readBody(request: NextRequest) {
  return request.json().catch(() => ({}));
}

async function resolveAgentId(auth: AuthContext): Promise<string | null> {
  const result = await database(auth.admin)
    .from("field_agents")
    .select("id")
    .eq("organization_id", auth.orgId)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (result.error || !result.data) return null;
  return asString(row(result.data).id) || null;
}

async function resolveMerchantId(auth: AuthContext): Promise<string | null> {
  const result = await database(auth.admin)
    .from("merchants")
    .select("id")
    .eq("organization_id", auth.orgId)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (result.error || !result.data) return null;
  return asString(row(result.data).id) || null;
}

async function findAuthUserIdByEmail(auth: AuthContext, email: string): Promise<string | null> {
  const target = email.toLowerCase();
  let page = 1;
  const perPage = 100;
  for (let i = 0; i < 50; i += 1) {
    const { data, error } = await adminAuth(auth.admin).auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(error.message || "Unable to look up users.");
    const found = data.users.find((candidate) => (candidate.email || "").toLowerCase() === target);
    if (found) return found.id;
    if (data.users.length < perPage) return null;
    page += 1;
  }
  return null;
}

async function insertTransfer(
  auth: AuthContext,
  values: {
    sim_unit_id: string;
    transfer_type: string;
    from_agent_id?: string | null;
    to_agent_id?: string | null;
    from_merchant_id?: string | null;
    to_merchant_id?: string | null;
    notes?: string | null;
  }
) {
  await database(auth.admin).from("sim_transfers").insert({
    organization_id: auth.orgId,
    sim_unit_id: values.sim_unit_id,
    transfer_type: values.transfer_type,
    from_agent_id: values.from_agent_id ?? null,
    to_agent_id: values.to_agent_id ?? null,
    from_merchant_id: values.from_merchant_id ?? null,
    to_merchant_id: values.to_merchant_id ?? null,
    performed_by: auth.user.id,
    notes: values.notes ?? null,
  });
}

// Confirms the merchant belongs to the current agent (or the caller is a manager).
async function merchantForCaller(auth: AuthContext, merchantId: string) {
  const result = await database(auth.admin)
    .from("merchants")
    .select("*")
    .eq("organization_id", auth.orgId)
    .eq("id", merchantId)
    .maybeSingle();
  if (result.error || !result.data) return null;
  const merchant = row(result.data);
  if (auth.isManager) return merchant;
  if (auth.isAgent) {
    const agentId = await resolveAgentId(auth);
    return agentId && asString(merchant.agent_id) === agentId ? merchant : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Merchants collection / detail
// ---------------------------------------------------------------------------
async function handleMerchants(request: NextRequest, auth: AuthContext, segments: string[]) {
  const db = database(auth.admin);
  const merchantId = segments[0] && segments[0] !== "" ? segments[0] : "";

  if (!merchantId) {
    if (request.method === "GET") {
      let query = db.from("merchants").select("*").eq("organization_id", auth.orgId);
      if (auth.isAgent) {
        const agentId = await resolveAgentId(auth);
        if (!agentId) return json([]);
        query = query.eq("agent_id", agentId);
      } else if (auth.isMerchant) {
        const merchantSelfId = await resolveMerchantId(auth);
        if (!merchantSelfId) return json([]);
        query = query.eq("id", merchantSelfId);
      }
      const result = await query.order("created_at", { ascending: false });
      if (result.error) return message(result.error.message, 500);
      return json(rows(result.data));
    }

    if (request.method === "POST") {
      // Agent (or manager) creates a merchant login + profile.
      if (!auth.isAgent && !auth.isManager) {
        return message("Only agents or managers can create merchants.", 403);
      }
      const body = await readBody(request);
      const parsed = createMerchantSchema.safeParse(body);
      if (!parsed.success) return message(parseError(parsed.error), 400);

      let agentId: string | null = null;
      if (auth.isAgent) {
        agentId = await resolveAgentId(auth);
      } else {
        agentId = asString((body as Record<string, unknown>).agent_id) || null;
      }
      if (!agentId) return message("A valid owning agent is required.", 400);

      const email = parsed.data.email.toLowerCase();
      const existing = await findAuthUserIdByEmail(auth, email);
      if (existing) return message("البريد الإلكتروني مستخدم بالفعل.", 400);

      const created = await adminAuth(auth.admin).auth.admin.createUser({
        email,
        password: parsed.data.password,
        email_confirm: true,
        user_metadata: { full_name: parsed.data.business_name },
      });
      if (created.error || !created.data.user) {
        return message(created.error?.message || "تعذر إنشاء الحساب.", 500);
      }
      const userId = created.data.user.id;

      const profileResult = await db.from("profiles").upsert(
        {
          user_id: userId,
          org_id: auth.orgId,
          full_name: parsed.data.business_name,
          email,
          title: "تاجر",
          account_status: "active",
        },
        { onConflict: "user_id" }
      );
      if (profileResult.error) return message(profileResult.error.message, 500);

      const memberResult = await db.from("org_members").upsert(
        { org_id: auth.orgId, user_id: userId, role: "merchant" },
        { onConflict: "org_id,user_id" }
      );
      if (memberResult.error) return message(memberResult.error.message, 500);

      const insertPayload: Record<string, unknown> = {
        organization_id: auth.orgId,
        agent_id: agentId,
        user_id: userId,
        business_name: parsed.data.business_name,
        sim_price: parsed.data.sim_price,
        commission_rate: parsed.data.commission_rate,
        created_by: auth.user.id,
      };
      if (parsed.data.owner_name) insertPayload.owner_name = parsed.data.owner_name;
      if (parsed.data.phone) insertPayload.phone = parsed.data.phone;
      if (parsed.data.location) insertPayload.location = parsed.data.location;

      const result = await db.from("merchants").insert(insertPayload).select("*").single();
      if (result.error) return message(result.error.message, 500);
      return json(row(result.data), 201);
    }

    return message("Method not allowed", 405);
  }

  // /merchants/[id]/collections
  if (segments[1] === "collections") {
    if (request.method !== "GET") return message("Method not allowed", 405);
    const merchant = await merchantForCaller(auth, merchantId);
    if (!merchant) return message("Merchant not found.", 404);
    const result = await db
      .from("merchant_cash_collections")
      .select("*")
      .eq("organization_id", auth.orgId)
      .eq("merchant_id", merchantId)
      .order("collection_date", { ascending: false });
    if (result.error) return message(result.error.message, 500);
    return json(rows(result.data));
  }

  // /merchants/[id]
  if (request.method === "GET") {
    const merchant = await merchantForCaller(auth, merchantId);
    if (!merchant) return message("Merchant not found.", 404);
    return json(merchant);
  }

  if (request.method === "PATCH") {
    const merchant = await merchantForCaller(auth, merchantId);
    if (!merchant) return message("Merchant not found.", 404);
    const body = await readBody(request);
    const parsed = updateMerchantSchema.safeParse(body);
    if (!parsed.success) return message(parseError(parsed.error), 400);
    const result = await db
      .from("merchants")
      .update(parsed.data)
      .eq("organization_id", auth.orgId)
      .eq("id", merchantId)
      .select("*")
      .single();
    if (result.error) return message(result.error.message, 500);
    return json(row(result.data));
  }

  return message("Method not allowed", 405);
}

// ---------------------------------------------------------------------------
// SIM movement + merchant sales
// ---------------------------------------------------------------------------
async function handleMerchantSims(request: NextRequest, auth: AuthContext, segments: string[]) {
  const db = database(auth.admin);
  const action = segments[1] || "";

  // GET /sims — merchant's own SIMs
  if (!action) {
    if (request.method !== "GET") return message("Method not allowed", 405);
    const merchantId = auth.isMerchant
      ? await resolveMerchantId(auth)
      : asString(request.nextUrl.searchParams.get("merchant_id"));
    if (!merchantId) return json([]);
    if (!auth.isMerchant) {
      const merchant = await merchantForCaller(auth, merchantId);
      if (!merchant) return message("Merchant not found.", 404);
    }
    let query = db
      .from("sim_units")
      .select("*")
      .eq("organization_id", auth.orgId)
      .eq("current_merchant_id", merchantId);
    const status = asString(request.nextUrl.searchParams.get("status"));
    if (status) query = query.eq("status", status);
    const result = await query.order("merchant_assigned_at", { ascending: false });
    if (result.error) return message(result.error.message, 500);
    return json(rows(result.data));
  }

  // POST /sims/assign — agent hands SIMs to a merchant
  if (action === "assign") {
    if (request.method !== "POST") return message("Method not allowed", 405);
    if (!auth.isAgent && !auth.isManager) return message("Only agents can assign SIMs to merchants.", 403);

    const body = await readBody(request);
    const parsed = assignSimsToMerchantSchema.safeParse(body);
    if (!parsed.success) return message(parseError(parsed.error), 400);

    const merchant = await merchantForCaller(auth, parsed.data.merchant_id);
    if (!merchant) return message("Merchant not found.", 404);
    if (asString(merchant.status) === "suspended") {
      return message("Cannot assign SIMs to a suspended merchant.", 400);
    }
    const ownerAgentId = asString(merchant.agent_id);

    const simsResult = await db
      .from("sim_units")
      .select("id, status, current_agent_id")
      .eq("organization_id", auth.orgId)
      .in("id", parsed.data.sim_ids);
    if (simsResult.error) return message(simsResult.error.message, 500);
    const found = rows(simsResult.data);
    if (found.length !== parsed.data.sim_ids.length) return message("Some SIMs were not found.", 400);
    if (found.some((sim) => asString(sim.status) !== "with_agent")) {
      return message("All SIMs must be held by the agent to hand over.", 400);
    }
    if (found.some((sim) => asString(sim.current_agent_id) !== ownerAgentId)) {
      return message("You can only hand over SIMs that you hold.", 403);
    }

    const update = await db
      .from("sim_units")
      .update({
        status: "with_merchant",
        current_merchant_id: parsed.data.merchant_id,
        merchant_assigned_at: new Date().toISOString(),
      })
      .eq("organization_id", auth.orgId)
      .in("id", parsed.data.sim_ids)
      .select("id");
    if (update.error) return message(update.error.message, 500);

    for (const simId of parsed.data.sim_ids) {
      await insertTransfer(auth, {
        sim_unit_id: simId,
        transfer_type: "assign_to_merchant",
        from_agent_id: ownerAgentId,
        to_merchant_id: parsed.data.merchant_id,
        notes: parsed.data.notes ?? null,
      });
    }
    return json({ assigned: parsed.data.sim_ids.length });
  }

  // POST /sims/sell — merchant records a sale
  if (action === "sell") {
    if (request.method !== "POST") return message("Method not allowed", 405);

    const body = await readBody(request);
    const parsed = merchantRecordSaleSchema.safeParse(body);
    if (!parsed.success) return message(parseError(parsed.error), 400);

    const simResult = await db
      .from("sim_units")
      .select("*")
      .eq("organization_id", auth.orgId)
      .eq("id", parsed.data.sim_unit_id)
      .maybeSingle();
    if (simResult.error) return message(simResult.error.message, 500);
    if (!simResult.data) return message("SIM not found.", 404);
    const sim = row(simResult.data);
    if (asString(sim.status) !== "with_merchant") {
      return message("Only SIMs held by a merchant can be sold.", 400);
    }

    const sellingMerchantId = asString(sim.current_merchant_id);
    if (auth.isMerchant) {
      const myMerchantId = await resolveMerchantId(auth);
      if (!myMerchantId || myMerchantId !== sellingMerchantId) {
        return message("You can only sell SIMs assigned to you.", 403);
      }
    } else {
      const merchant = await merchantForCaller(auth, sellingMerchantId);
      if (!merchant) return message("Merchant not found.", 404);
    }

    const merchantResult = await db
      .from("merchants")
      .select("agent_id, commission_rate, status")
      .eq("organization_id", auth.orgId)
      .eq("id", sellingMerchantId)
      .maybeSingle();
    if (merchantResult.error) return message(merchantResult.error.message, 500);
    const merchant = row(merchantResult.data);
    if (asString(merchant.status) === "suspended") {
      return message("Cannot record sales for a suspended merchant.", 400);
    }
    const ownerAgentId = asString(merchant.agent_id);
    const merchantRate = asNumber(merchant.commission_rate);
    const merchantCommission = Math.round(parsed.data.sold_price * (merchantRate / 100) * 100) / 100;

    const agentResult = await db
      .from("field_agents")
      .select("commission_rate")
      .eq("organization_id", auth.orgId)
      .eq("id", ownerAgentId)
      .maybeSingle();
    const agentRate = asNumber(row(agentResult.data).commission_rate);
    const agentCommission = Math.round(parsed.data.sold_price * (agentRate / 100) * 100) / 100;

    const update = await db
      .from("sim_units")
      .update({
        status: "sold",
        sold_at: new Date().toISOString(),
        sold_by_merchant_id: sellingMerchantId,
        sold_by_agent_id: ownerAgentId,
        sold_price: parsed.data.sold_price,
        customer_name: parsed.data.customer_name ?? null,
      })
      .eq("organization_id", auth.orgId)
      .eq("id", parsed.data.sim_unit_id)
      .select("*")
      .single();
    if (update.error) return message(update.error.message, 500);

    await insertTransfer(auth, {
      sim_unit_id: parsed.data.sim_unit_id,
      transfer_type: "sold",
      from_merchant_id: sellingMerchantId,
    });

    // Merchant reward (paid by agent).
    await db.from("merchant_commissions").insert({
      organization_id: auth.orgId,
      merchant_id: sellingMerchantId,
      agent_id: ownerAgentId,
      sim_unit_id: parsed.data.sim_unit_id,
      sale_price: parsed.data.sold_price,
      commission_rate: merchantRate,
      commission_amount: merchantCommission,
    });

    // Agent reward (paid by HR).
    await db.from("agent_commissions").insert({
      organization_id: auth.orgId,
      agent_id: ownerAgentId,
      sim_unit_id: parsed.data.sim_unit_id,
      sale_price: parsed.data.sold_price,
      commission_rate: agentRate,
      commission_amount: agentCommission,
    });

    return json(row(update.data));
  }

  // POST /sims/return — merchant returns a SIM to its agent
  if (action === "return") {
    if (request.method !== "POST") return message("Method not allowed", 405);

    const body = await readBody(request);
    const parsed = merchantReturnSimSchema.safeParse(body);
    if (!parsed.success) return message(parseError(parsed.error), 400);

    const simResult = await db
      .from("sim_units")
      .select("*")
      .eq("organization_id", auth.orgId)
      .eq("id", parsed.data.sim_unit_id)
      .maybeSingle();
    if (simResult.error) return message(simResult.error.message, 500);
    if (!simResult.data) return message("SIM not found.", 404);
    const sim = row(simResult.data);
    if (asString(sim.status) !== "with_merchant") {
      return message("Only SIMs held by a merchant can be returned.", 400);
    }
    const holdingMerchantId = asString(sim.current_merchant_id);
    if (auth.isMerchant) {
      const myMerchantId = await resolveMerchantId(auth);
      if (!myMerchantId || myMerchantId !== holdingMerchantId) {
        return message("You can only return SIMs assigned to you.", 403);
      }
    } else {
      const merchant = await merchantForCaller(auth, holdingMerchantId);
      if (!merchant) return message("Merchant not found.", 404);
    }

    const update = await db
      .from("sim_units")
      .update({
        status: "with_agent",
        current_merchant_id: null,
        merchant_assigned_at: null,
      })
      .eq("organization_id", auth.orgId)
      .eq("id", parsed.data.sim_unit_id)
      .select("*")
      .single();
    if (update.error) return message(update.error.message, 500);

    await insertTransfer(auth, {
      sim_unit_id: parsed.data.sim_unit_id,
      transfer_type: "return_from_merchant",
      from_merchant_id: holdingMerchantId,
      to_agent_id: asString(sim.current_agent_id) || null,
      notes: parsed.data.notes ?? null,
    });

    return json(row(update.data));
  }

  return message("Merchant route was not found.", 404);
}

// ---------------------------------------------------------------------------
// Cash collections (agent collects from merchant)
// ---------------------------------------------------------------------------
async function handleMerchantCollect(request: NextRequest, auth: AuthContext) {
  if (request.method !== "POST") return message("Method not allowed", 405);
  if (!auth.isAgent && !auth.isManager) return message("Only agents can collect cash.", 403);

  const body = await readBody(request);
  const parsed = collectMerchantCashSchema.safeParse(body);
  if (!parsed.success) return message(parseError(parsed.error), 400);

  const merchant = await merchantForCaller(auth, parsed.data.merchant_id);
  if (!merchant) return message("Merchant not found.", 404);

  const result = await database(auth.admin)
    .from("merchant_cash_collections")
    .insert({
      organization_id: auth.orgId,
      merchant_id: parsed.data.merchant_id,
      agent_id: asString(merchant.agent_id),
      amount: parsed.data.amount,
      payment_method: parsed.data.payment_method,
      collection_date: parsed.data.collection_date,
      notes: parsed.data.notes ?? null,
      collected_by: auth.user.id,
    })
    .select("*")
    .single();
  if (result.error) return message(result.error.message, 500);
  return json(row(result.data), 201);
}

// ---------------------------------------------------------------------------
// Merchant re-orders
// ---------------------------------------------------------------------------
async function handleMerchantRequests(request: NextRequest, auth: AuthContext, segments: string[]) {
  const db = database(auth.admin);
  const requestId = segments[1] || "";

  if (requestId && segments[2] === "review") {
    if (request.method !== "PATCH") return message("Method not allowed", 405);
    if (!auth.isAgent && !auth.isManager) return message("Only agents review requests.", 403);
    const body = await readBody(request);
    const parsed = reviewMerchantRequestSchema.safeParse(body);
    if (!parsed.success) return message(parseError(parsed.error), 400);
    const result = await db
      .from("merchant_sim_requests")
      .update({
        status: parsed.data.status,
        review_note: parsed.data.review_note ?? null,
        reviewed_by: auth.user.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("organization_id", auth.orgId)
      .eq("id", requestId)
      .select("*")
      .single();
    if (result.error) return message(result.error.message, 500);
    return json(row(result.data));
  }

  if (!requestId) {
    if (request.method === "GET") {
      let query = db.from("merchant_sim_requests").select("*").eq("organization_id", auth.orgId);
      if (auth.isMerchant) {
        const merchantId = await resolveMerchantId(auth);
        if (!merchantId) return json([]);
        query = query.eq("merchant_id", merchantId);
      } else if (auth.isAgent) {
        const agentId = await resolveAgentId(auth);
        if (!agentId) return json([]);
        query = query.eq("agent_id", agentId);
      } else {
        const status = asString(request.nextUrl.searchParams.get("status"));
        if (status) query = query.eq("status", status);
      }
      const result = await query.order("created_at", { ascending: false });
      if (result.error) return message(result.error.message, 500);
      return json(rows(result.data));
    }

    if (request.method === "POST") {
      if (!auth.isMerchant) return message("Only merchants can request SIMs.", 403);
      const merchantId = await resolveMerchantId(auth);
      if (!merchantId) return message("No merchant profile found.", 404);
      const merchantResult = await db
        .from("merchants")
        .select("agent_id")
        .eq("organization_id", auth.orgId)
        .eq("id", merchantId)
        .maybeSingle();
      const agentId = asString(row(merchantResult.data).agent_id);
      const body = await readBody(request);
      const parsed = merchantSimRequestSchema.safeParse(body);
      if (!parsed.success) return message(parseError(parsed.error), 400);
      const result = await db
        .from("merchant_sim_requests")
        .insert({
          organization_id: auth.orgId,
          merchant_id: merchantId,
          agent_id: agentId,
          quantity: parsed.data.quantity,
          sim_type: parsed.data.sim_type ?? null,
          notes: parsed.data.notes ?? null,
        })
        .select("*")
        .single();
      if (result.error) return message(result.error.message, 500);
      return json(row(result.data), 201);
    }
  }

  return message("Method not allowed", 405);
}

// ---------------------------------------------------------------------------
// Merchant commissions
// ---------------------------------------------------------------------------
async function handleMerchantCommissions(request: NextRequest, auth: AuthContext, segments: string[]) {
  const db = database(auth.admin);
  const commissionId = segments[1] || "";

  if (commissionId && segments[2] === "pay") {
    if (request.method !== "PATCH") return message("Method not allowed", 405);
    if (!auth.isAgent && !auth.isManager) return message("Only agents pay merchant commissions.", 403);
    const result = await db
      .from("merchant_commissions")
      .update({ is_paid: true, paid_at: new Date().toISOString(), paid_by: auth.user.id })
      .eq("organization_id", auth.orgId)
      .eq("id", commissionId)
      .select("*")
      .single();
    if (result.error) return message(result.error.message, 500);
    return json(row(result.data));
  }

  if (!commissionId) {
    if (request.method !== "GET") return message("Method not allowed", 405);
    let query = db.from("merchant_commissions").select("*").eq("organization_id", auth.orgId);
    if (auth.isMerchant) {
      const merchantId = await resolveMerchantId(auth);
      if (!merchantId) return json([]);
      query = query.eq("merchant_id", merchantId);
    } else if (auth.isAgent) {
      const agentId = await resolveAgentId(auth);
      if (!agentId) return json([]);
      query = query.eq("agent_id", agentId);
    } else {
      const merchantFilter = asString(request.nextUrl.searchParams.get("merchant_id"));
      if (merchantFilter) query = query.eq("merchant_id", merchantFilter);
    }
    const result = await query.order("created_at", { ascending: false });
    if (result.error) return message(result.error.message, 500);
    return json(rows(result.data));
  }

  return message("Method not allowed", 405);
}

// ---------------------------------------------------------------------------
// Merchant self dashboard
// ---------------------------------------------------------------------------
async function handleMerchantMe(request: NextRequest, auth: AuthContext, segments: string[]) {
  if (segments[1] !== "dashboard") return message("Merchant route was not found.", 404);
  if (request.method !== "GET") return message("Method not allowed", 405);
  const db = database(auth.admin);
  const merchantId = await resolveMerchantId(auth);
  if (!merchantId) return message("No merchant profile found for this user.", 404);

  const merchantResult = await db
    .from("merchants")
    .select("*")
    .eq("organization_id", auth.orgId)
    .eq("id", merchantId)
    .maybeSingle();
  if (merchantResult.error) return message(merchantResult.error.message, 500);
  if (!merchantResult.data) return message("Merchant not found.", 404);
  const merchant = row(merchantResult.data);
  const simPrice = asNumber(merchant.sim_price);

  const heldResult = await db
    .from("sim_units")
    .select("id, price")
    .eq("organization_id", auth.orgId)
    .eq("current_merchant_id", merchantId)
    .eq("status", "with_merchant");
  const soldResult = await db
    .from("sim_units")
    .select("id")
    .eq("organization_id", auth.orgId)
    .eq("sold_by_merchant_id", merchantId)
    .eq("status", "sold");
  const collectionsResult = await db
    .from("merchant_cash_collections")
    .select("amount")
    .eq("organization_id", auth.orgId)
    .eq("merchant_id", merchantId);
  const requestsResult = await db
    .from("merchant_sim_requests")
    .select("id")
    .eq("organization_id", auth.orgId)
    .eq("merchant_id", merchantId)
    .eq("status", "pending");
  const commissionsResult = await db
    .from("merchant_commissions")
    .select("commission_amount")
    .eq("organization_id", auth.orgId)
    .eq("merchant_id", merchantId)
    .eq("is_paid", false);

  const held = rows(heldResult.data);
  const sold = rows(soldResult.data);
  const totalOwed = sold.length * simPrice;
  const totalCollected = rows(collectionsResult.data).reduce((s, r) => s + asNumber(r.amount), 0);
  const unpaidCommission = rows(commissionsResult.data).reduce((s, r) => s + asNumber(r.commission_amount), 0);

  return json({
    merchant,
    balance: {
      total_owed: totalOwed,
      total_collected: totalCollected,
      outstanding: totalOwed - totalCollected,
    },
    stock: {
      in_hand: held.length,
      sold_total: sold.length,
      in_hand_value: held.length * simPrice,
    },
    pending_requests: rows(requestsResult.data).length,
    unpaid_commission: unpaidCommission,
  });
}

// ---------------------------------------------------------------------------
// Analytics: best resellers
// ---------------------------------------------------------------------------
async function handleMerchantAnalytics(request: NextRequest, auth: AuthContext, segments: string[]) {
  if (segments[1] !== "resellers") return message("Merchant route was not found.", 404);
  if (request.method !== "GET") return message("Method not allowed", 405);
  if (!auth.isAgent && !auth.isManager) return message("Manager or agent access required.", 403);

  const db = database(auth.admin);
  let merchantsQuery = db.from("merchants").select("id, business_name, agent_id").eq("organization_id", auth.orgId);
  if (auth.isAgent) {
    const agentId = await resolveAgentId(auth);
    if (!agentId) return json([]);
    merchantsQuery = merchantsQuery.eq("agent_id", agentId);
  }
  const merchantsResult = await merchantsQuery;
  const merchants = rows(merchantsResult.data);

  const soldResult = await db
    .from("sim_units")
    .select("sold_by_merchant_id, sold_price")
    .eq("organization_id", auth.orgId)
    .eq("status", "sold");
  const sold = rows(soldResult.data);

  const ranking = merchants
    .map((merchant) => {
      const mid = asString(merchant.id);
      const mine = sold.filter((sim) => asString(sim.sold_by_merchant_id) === mid);
      return {
        merchant_id: mid,
        business_name: asString(merchant.business_name),
        sold_total: mine.length,
        sold_value: mine.reduce((s, sim) => s + asNumber(sim.sold_price), 0),
      };
    })
    .sort((a, b) => b.sold_total - a.sold_total);

  return json(ranking);
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------
async function dispatch(request: NextRequest, auth: AuthContext, context: RouteContext) {
  const segments = segmentsOf(context);
  const resource = segments[0] || "";

  if (resource === "sims") return handleMerchantSims(request, auth, segments);
  if (resource === "collect") return handleMerchantCollect(request, auth);
  if (resource === "requests") return handleMerchantRequests(request, auth, segments);
  if (resource === "commissions") return handleMerchantCommissions(request, auth, segments);
  if (resource === "me") return handleMerchantMe(request, auth, segments);
  if (resource === "analytics") return handleMerchantAnalytics(request, auth, segments);

  return handleMerchants(request, auth, segments);
}

async function authorize(request: NextRequest, context: RouteContext) {
  const auth = await requireMerchantAccess();
  if ("error" in auth) return auth.error;
  return dispatch(request, auth as AuthContext, context);
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
