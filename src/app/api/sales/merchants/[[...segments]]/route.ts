import { NextRequest, NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { requireMerchantAccess } from "@/lib/server/merchant-auth";
import { inspectUpload, removeUploadedPaths } from "@/lib/server/upload-security";
import {
  assignSimsToMerchantByQuantitySchema,
  assignSimsToMerchantSchema,
  collectMerchantCashSchema,
  confirmMerchantPaymentSchema,
  createMerchantSchema,
  merchantRecordSaleSchema,
  merchantReturnSimSchema,
  merchantSimRequestSchema,
  reviewMerchantRequestSchema,
  simPackageSchema,
  updateMerchantSchema,
  updateSimPackageSchema,
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

type UntypedSupabase = {
  from: (table: string) => QueryBuilder;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<DbResult>;
};

type AdminAuthClient = {
  auth: {
    admin: {
      createUser: (attrs: Record<string, unknown>) => Promise<{
        data: { user: { id: string } | null };
        error: { message?: string } | null;
      }>;
      deleteUser: (userId: string) => Promise<{ error: { message?: string } | null }>;
      listUsers: (params: { page: number; perPage: number }) => Promise<{
        data: { users: Array<{ id: string; email?: string | null }> };
        error: { message?: string } | null;
      }>;
    };
  };
};

type StorageClient = {
  storage: {
    from: (bucket: string) => {
      upload: (
        path: string,
        file: File | Uint8Array,
        options?: { contentType?: string; upsert?: boolean }
      ) => Promise<{ data: { path: string } | null; error: { message?: string } | null }>;
      getPublicUrl: (path: string) => { data: { publicUrl: string } };
      createSignedUrl: (path: string, expiresIn: number) => Promise<{ data: { signedUrl?: string } | null; error: { message?: string } | null }>;
      remove: (paths: string[]) => Promise<{ error: { message?: string } | null }>;
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
  requestId: string;
};

type RouteContext = { params: Promise<{ segments?: string[] }> };

function database(admin: unknown) {
  return admin as UntypedSupabase;
}
function adminAuth(admin: unknown) {
  return admin as AdminAuthClient;
}
function storage(admin: unknown) {
  return admin as StorageClient;
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
function rpcStatus(code?: string) {
  if (code === "42501") return 403;
  if (code === "P0002") return 404;
  if (["22023", "23514"].includes(code || "")) return 400;
  if (["23505", "40001", "55000"].includes(code || "")) return 409;
  return 500;
}
function parseError(error: unknown) {
  if (error && typeof error === "object" && "issues" in error) {
    const issue = (error as { issues?: Array<{ message?: string }> }).issues?.[0];
    return issue?.message || "Invalid input";
  }
  return error instanceof Error ? error.message : "Invalid input";
}
async function segmentsOf(context: RouteContext) {
  return (await context.params).segments || [];
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

function hasOwn(record: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function normalizeSimPackagePayload(values: Record<string, unknown>, actorUserId: string, source: unknown) {
  const next = { ...values };
  const raw = row(source);

  const agentChainTypeProvided = hasOwn(raw, "agent_chain_commission_type");
  const legacyAgentTypeProvided = hasOwn(raw, "agent_commission_type");
  const agentChainValueProvided = hasOwn(raw, "agent_chain_commission_value");
  const legacyAgentValueProvided = hasOwn(raw, "agent_commission_value");

  if (agentChainTypeProvided || (!legacyAgentTypeProvided && next.agent_chain_commission_type != null)) {
    next.agent_commission_type = next.agent_chain_commission_type;
  } else if (legacyAgentTypeProvided) {
    next.agent_chain_commission_type = next.agent_commission_type;
  }

  if (agentChainValueProvided || (!legacyAgentValueProvided && next.agent_chain_commission_value != null)) {
    next.agent_commission_value = next.agent_chain_commission_value;
  } else if (legacyAgentValueProvided) {
    next.agent_chain_commission_value = next.agent_commission_value;
  }

  const commissionKeys = [
    "commission_currency",
    "total_commission_type",
    "total_commission_value",
    "agent_chain_commission_type",
    "agent_chain_commission_value",
    "agent_commission_type",
    "agent_commission_value",
    "merchant_commission_type",
    "merchant_commission_value",
    "direct_agent_commission_type",
    "direct_agent_commission_value",
    "commission_notes",
  ];
  if (commissionKeys.some((key) => hasOwn(raw, key))) {
    next.commission_updated_by = actorUserId;
    next.commission_updated_at = new Date().toISOString();
  }

  return next;
}

async function readBody(request: NextRequest) {
  return request.json().catch(() => ({}));
}

function inventoryCommandId(request: NextRequest, value?: string) {
  const candidate = value || request.headers.get("idempotency-key") || "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)
    ? candidate
    : crypto.randomUUID();
}

function safeFilename(name: string) {
  return name.replace(/[^\w.\-]+/g, "-").replace(/-+/g, "-").slice(0, 120) || "upload";
}

async function readPayload(request: NextRequest, fileField: string) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return { body: await readBody(request), file: null as File | null };
  }

  const form = await request.formData();
  const body: Record<string, unknown> = {};
  let file: File | null = null;
  form.forEach((value, key) => {
    if (key === fileField && value instanceof File && value.size > 0) {
      file = value;
    } else if (!(value instanceof File)) {
      body[key] = value;
    }
  });
  return { body, file };
}

const merchantImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const merchantPaymentTypes = new Set([...merchantImageTypes, "application/pdf"]);
const maxMerchantUploadBytes = 10 * 1024 * 1024;

async function uploadMerchantFile(auth: AuthContext, bucket: string, folder: string, file: File | null, isPublic: boolean) {
  if (!file) return null;
  const inspected = await inspectUpload(file, {
    allowedMimeTypes: bucket === "merchant-payment-proofs" ? merchantPaymentTypes : merchantImageTypes,
    maxBytes: maxMerchantUploadBytes,
  });
  const path = `${auth.orgId}/${folder}/${auth.requestId}/${crypto.randomUUID()}-${safeFilename(file.name)}`;
  const upload = await storage(auth.admin).storage.from(bucket).upload(path, inspected.bytes, {
    contentType: inspected.detectedMime,
    upsert: false,
  });
  if (upload.error || !upload.data) throw new Error(upload.error?.message || "Unable to upload file.");
  return {
    path: upload.data.path,
    value: isPublic ? storage(auth.admin).storage.from(bucket).getPublicUrl(upload.data.path).data.publicUrl : upload.data.path,
  };
}

async function signPaymentProof(auth: AuthContext, value: unknown) {
  const path = asString(value);
  if (!path || /^https?:\/\//i.test(path)) return path || null;
  if (!path.startsWith(`${auth.orgId}/payments/`)) return null;
  const signed = await storage(auth.admin).storage.from("merchant-payment-proofs").createSignedUrl(path, 600);
  if (signed.error) throw new Error(signed.error.message || "Unable to sign payment proof.");
  return signed.data?.signedUrl || null;
}

async function signPaymentRows(auth: AuthContext, values: Record<string, unknown>[]) {
  return Promise.all(values.map(async (value) => ({
    ...value,
    payment_proof_url: await signPaymentProof(auth, value.payment_proof_url),
  })));
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

async function resolveManagedAgentId(auth: AuthContext, agentId: string): Promise<string | null> {
  const result = await database(auth.admin)
    .from("field_agents")
    .select("id")
    .eq("organization_id", auth.orgId)
    .eq("id", agentId)
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
  if (auth.isMerchant) {
    const merchantSelfId = await resolveMerchantId(auth);
    return merchantSelfId && asString(merchant.id) === merchantSelfId ? merchant : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Packages
// ---------------------------------------------------------------------------
async function handlePackages(request: NextRequest, auth: AuthContext, segments: string[]) {
  const db = database(auth.admin);
  const packageId = segments[1] || "";

  if (!packageId) {
    if (request.method === "GET") {
      let query = db.from("sim_packages").select("*").eq("organization_id", auth.orgId);
      const status = asString(request.nextUrl.searchParams.get("status"));
      const provider = asString(request.nextUrl.searchParams.get("provider")) || "virgin";
      if (status) query = query.eq("status", status);
      if (provider) query = query.eq("provider", provider);
      const result = await query.order("sale_price", { ascending: true });
      if (result.error) return message(result.error.message, 500);
      return json(rows(result.data));
    }

    if (request.method === "POST") {
      if (!auth.isManager) return message("Only on-ground managers can manage packages.", 403);
      const body = await readBody(request);
      const parsed = simPackageSchema.safeParse(body);
      if (!parsed.success) return message(parseError(parsed.error), 400);
      const packageValues = normalizeSimPackagePayload(parsed.data, auth.user.id, body);
      const result = await db
        .from("sim_packages")
        .insert({
          ...packageValues,
          organization_id: auth.orgId,
          created_by: auth.user.id,
        })
        .select("*")
        .single();
      if (result.error) return message(result.error.message, 500);
      return json(row(result.data), 201);
    }

    return message("Method not allowed", 405);
  }

  if (request.method === "PATCH") {
    if (!auth.isManager) return message("Only on-ground managers can manage packages.", 403);
    const body = await readBody(request);
    const parsed = updateSimPackageSchema.safeParse(body);
    if (!parsed.success) return message(parseError(parsed.error), 400);
    const packageValues = normalizeSimPackagePayload(parsed.data, auth.user.id, body);
    const result = await db
      .from("sim_packages")
      .update(packageValues)
      .eq("organization_id", auth.orgId)
      .eq("id", packageId)
      .select("*")
      .single();
    if (result.error) return message(result.error.message, 500);
    return json(row(result.data));
  }

  return message("Method not allowed", 405);
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
      const { body, file } = await readPayload(request, "place_photo");
      const parsed = createMerchantSchema.safeParse(body);
      if (!parsed.success) return message(parseError(parsed.error), 400);

      let agentId: string | null = null;
      if (auth.isManager) {
        const requestedAgentId = asString((body as Record<string, unknown>).agent_id);
        agentId = requestedAgentId ? await resolveManagedAgentId(auth, requestedAgentId) : null;
      } else if (auth.isAgent) {
        agentId = await resolveAgentId(auth);
      }
      if (!agentId) return message("A valid owning agent is required.", 400);

      const email = parsed.data.email.toLowerCase();
      const commandId = parsed.data.command_id || crypto.randomUUID();
      const commandResult = await db.from("sales_identity_commands").select("identity_type, actor_user_id, status, result_snapshot")
        .eq("org_id", auth.orgId).eq("command_id", commandId).maybeSingle();
      if (commandResult.error) return message(commandResult.error.message, 500);
      if (commandResult.data) {
        const command = row(commandResult.data);
        if (command.identity_type !== "merchant" || command.actor_user_id !== auth.user.id) {
          return message("Command id was already used for another identity request.", 409);
        }
        if (command.status === "completed" && command.result_snapshot) return json(command.result_snapshot);
        return message("Merchant provisioning is already processing.", 409);
      }
      const existing = await findAuthUserIdByEmail(auth, email);
      if (existing) return message("البريد الإلكتروني مستخدم بالفعل.", 400);

      let placePhotoUrl: string | null = null;
      let placePhotoPath = "";
      try {
        const uploaded = await uploadMerchantFile(auth, "merchant-place-photos", "places", file, true);
        placePhotoUrl = uploaded?.value || null;
        placePhotoPath = uploaded?.path || "";
      } catch (error) {
        return message(error, 422);
      }

      const created = await adminAuth(auth.admin).auth.admin.createUser({
        email,
        password: parsed.data.password,
        email_confirm: true,
        user_metadata: { full_name: parsed.data.business_name, identity_command_id: commandId },
      });
      if (created.error || !created.data.user) {
        if (placePhotoPath) await removeUploadedPaths(auth.admin, "merchant-place-photos", [placePhotoPath]).catch(() => undefined);
        return message(created.error?.message || "تعذر إنشاء الحساب.", 500);
      }
      const userId = created.data.user.id;
      const cleanup = await db.rpc("enqueue_identity_auth_sync_job", {
        p_org_id: auth.orgId,
        p_target_user_id: userId,
        p_action: "delete",
        p_source_type: "provisioning_safety",
        p_source_id: commandId,
        p_reason: "Delete merchant Auth identity if database provisioning never completes.",
        p_actor_user_id: auth.user.id,
        p_request_id: auth.requestId,
        p_delay_seconds: 600,
      });
      if (cleanup.error || !row(cleanup.data).id) {
        if (placePhotoPath) await removeUploadedPaths(auth.admin, "merchant-place-photos", [placePhotoPath]).catch(() => undefined);
        await adminAuth(auth.admin).auth.admin.deleteUser(userId).catch(() => undefined);
        return message(cleanup.error?.message || "تعذر تأمين عملية إنشاء الحساب.", 500);
      }
      const cleanupJobId = String(row(cleanup.data).id);
      const result = await db.rpc("provision_sales_identity", {
        p_org_id: auth.orgId,
        p_actor_user_id: auth.user.id,
        p_request_id: auth.requestId,
        p_command_id: commandId,
        p_user_id: userId,
        p_identity_type: "merchant",
        p_payload: {
          email,
          display_name: parsed.data.business_name,
          agent_id: agentId,
          owner_name: parsed.data.owner_name || null,
          phone: parsed.data.phone || null,
          location: parsed.data.location || null,
          city: parsed.data.city || null,
          region: parsed.data.region || null,
          latitude: parsed.data.latitude ?? null,
          longitude: parsed.data.longitude ?? null,
          place_photo_url: placePhotoUrl,
          sim_price: parsed.data.sim_price,
          commission_rate: parsed.data.commission_rate,
        },
      });
      if (result.error) {
        if (placePhotoPath) await removeUploadedPaths(auth.admin, "merchant-place-photos", [placePhotoPath]).catch(() => undefined);
        return message(result.error.message, rpcStatus(result.error.code));
      }
      const cancellation = await db.rpc("cancel_identity_auth_sync_job", {
        p_job_id: cleanupJobId,
        p_reason: "Merchant identity provisioned successfully.",
      });
      if (cancellation.error) {
        console.error("Merchant identity cleanup cancellation requires reconciliation.", {
          cleanupJobId, userId, message: cancellation.error.message,
        });
      }
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
    return json(await signPaymentRows(auth, rows(result.data)));
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
    const safeUpdate = { ...parsed.data };
    delete safeUpdate.place_photo_url;
    const result = await db
      .from("merchants")
      .update(safeUpdate)
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

  async function autoSelectMerchantSims(input: {
    merchant_id: string;
    quantity: number;
    provider?: string;
    sim_type?: string;
  }) {
    const merchant = await merchantForCaller(auth, input.merchant_id);
    if (!merchant) return { error: { message: "Merchant not found.", status: 404 }, merchant: null, sims: [] };
    if (asString(merchant.status) === "suspended") {
      return { error: { message: "Cannot assign SIMs to a suspended merchant.", status: 400 }, merchant, sims: [] };
    }
    const ownerAgentId = asString(merchant.agent_id);
    let query = db
      .from("sim_units")
      .select("*")
      .eq("organization_id", auth.orgId)
      .eq("status", "with_agent")
      .eq("current_agent_id", ownerAgentId)
      .eq("provider", input.provider || "virgin");
    if (input.sim_type) query = query.eq("sim_type", input.sim_type);
    const simsResult = await query.order("assigned_at", { ascending: true }).limit(input.quantity);
    if (simsResult.error) {
      return { error: { message: simsResult.error.message || "Unable to load SIMs.", status: 500 }, merchant, sims: [] };
    }
    const sims = rows(simsResult.data);
    if (sims.length < input.quantity) {
      return { error: { message: "Not enough available SIMs in the agent stock.", status: 400 }, merchant, sims };
    }
    return { error: null, merchant, sims };
  }

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
    let currentQuery = db
      .from("sim_units")
      .select("*")
      .eq("organization_id", auth.orgId)
      .eq("current_merchant_id", merchantId);
    let soldQuery = db
      .from("sim_units")
      .select("*")
      .eq("organization_id", auth.orgId)
      .eq("sold_by_merchant_id", merchantId);
    const status = asString(request.nextUrl.searchParams.get("status"));
    if (status) {
      currentQuery = currentQuery.eq("status", status);
      soldQuery = soldQuery.eq("status", status);
    }
    const [currentResult, soldResult] = await Promise.all([
      currentQuery.order("merchant_assigned_at", { ascending: false }),
      soldQuery.order("sold_at", { ascending: false }),
    ]);
    if (currentResult.error) return message(currentResult.error.message, 500);
    if (soldResult.error) return message(soldResult.error.message, 500);
    const merged = new Map<string, Record<string, unknown>>();
    for (const sim of [...rows(currentResult.data), ...rows(soldResult.data)]) {
      const id = asString(row(sim).id);
      if (id) merged.set(id, row(sim));
    }
    return json(Array.from(merged.values()));
  }

  // POST /sims/assign — agent hands SIMs to a merchant
  if (action === "preview") {
    if (request.method !== "POST") return message("Method not allowed", 405);
    if (!auth.isAgent && !auth.isManager) return message("Only agents can assign SIMs to merchants.", 403);
    const body = await readBody(request);
    const parsed = assignSimsToMerchantByQuantitySchema.safeParse(body);
    if (!parsed.success) return message(parseError(parsed.error), 400);
    const selection = await autoSelectMerchantSims(parsed.data);
    if (selection.error) return message(selection.error.message, selection.error.status);
    return json({ sims: selection.sims });
  }

  if (action === "assign") {
    if (request.method !== "POST") return message("Method not allowed", 405);
    if (!auth.isAgent && !auth.isManager) return message("Only agents can assign SIMs to merchants.", 403);

    const body = await readBody(request);
    const quantityParsed = assignSimsToMerchantByQuantitySchema.safeParse(body);
    const parsed = quantityParsed.success ? null : assignSimsToMerchantSchema.safeParse(body);
    if (!quantityParsed.success && !parsed?.success) {
      return message(parseError(parsed?.error || quantityParsed.error), 400);
    }

    let commandId: string | undefined;
    let merchantId: string;
    let simIds: string[] = [];
    let quantity = 0;
    let provider = "virgin";
    let simType: string | null = null;
    let notes: string | null = null;
    if (quantityParsed.success) {
      commandId = quantityParsed.data.command_id;
      merchantId = quantityParsed.data.merchant_id;
      quantity = quantityParsed.data.quantity;
      provider = quantityParsed.data.provider;
      simType = quantityParsed.data.sim_type || null;
      notes = quantityParsed.data.notes || null;
    } else {
      if (!parsed?.success) return message("Invalid merchant SIM assignment.", 400);
      commandId = parsed.data.command_id;
      merchantId = parsed.data.merchant_id;
      simIds = parsed.data.sim_ids;
      notes = parsed.data.notes || null;
    }
    const result = await db.rpc("assign_sim_inventory_to_merchant", {
      p_org_id: auth.orgId,
      p_actor_user_id: auth.user.id,
      p_request_id: auth.requestId,
      p_command_id: inventoryCommandId(request, commandId),
      p_merchant_id: merchantId,
      p_sim_ids: simIds,
      p_quantity: quantity,
      p_provider: provider,
      p_sim_type: simType,
      p_notes: notes,
    });
    if (result.error) return message(result.error.message, rpcStatus(result.error.code));
    return json(row(result.data));
  }

  // POST /sims/sell — merchant records a sale
  if (action === "sell") {
    if (request.method !== "POST") return message("Method not allowed", 405);
    const body = await readBody(request);
    const parsed = merchantRecordSaleSchema.safeParse(body);
    if (!parsed.success) return message(parseError(parsed.error), 400);
    const { command_id, ...customer } = parsed.data;
    const rpc = await db.rpc("record_sim_sale", {
      p_org_id: auth.orgId,
      p_actor_user_id: auth.user.id,
      p_command_id: command_id || crypto.randomUUID(),
      p_request_id: auth.requestId,
      p_sim_unit_id: parsed.data.sim_unit_id,
      p_package_id: parsed.data.package_id,
      p_seller_type: "merchant",
      p_customer: customer,
    });
    if (rpc.error) return message(rpc.error.message, rpcStatus(rpc.error.code));
    const result = await db.from("sim_units").select("*")
      .eq("organization_id", auth.orgId).eq("id", parsed.data.sim_unit_id).single();
    if (result.error) return message(result.error.message, 500);
    return json(row(result.data));
  }

  // POST /sims/return — merchant returns a SIM to its agent
  if (action === "return") {
    if (request.method !== "POST") return message("Method not allowed", 405);

    const body = await readBody(request);
    const parsed = merchantReturnSimSchema.safeParse(body);
    if (!parsed.success) return message(parseError(parsed.error), 400);

    const rpc = await db.rpc("return_sim_unit", {
      p_org_id: auth.orgId,
      p_actor_user_id: auth.user.id,
      p_command_id: parsed.data.command_id || crypto.randomUUID(),
      p_request_id: auth.requestId,
      p_sim_unit_id: parsed.data.sim_unit_id,
      p_notes: parsed.data.notes ?? null,
    });
    if (rpc.error) return message(rpc.error.message, rpcStatus(rpc.error.code));
    return json(row(rows(rpc.data)[0]));
  }

  return message("Merchant route was not found.", 404);
}

// ---------------------------------------------------------------------------
// Cash collections (agent collects from merchant)
// ---------------------------------------------------------------------------
async function handleMerchantCollect(request: NextRequest, auth: AuthContext) {
  if (request.method !== "POST") return message("Method not allowed", 405);
  if (!auth.isAgent && !auth.isManager && !auth.isMerchant) {
    return message("Only traders, agents, or managers can submit payments.", 403);
  }

  const { body, file } = await readPayload(request, "payment_proof");
  const parsed = collectMerchantCashSchema.safeParse(body);
  if (!parsed.success) return message(parseError(parsed.error), 400);

  const merchantId = auth.isMerchant ? await resolveMerchantId(auth) : parsed.data.merchant_id;
  if (!merchantId) return message("No merchant profile found.", 404);

  const merchant = await merchantForCaller(auth, merchantId);
  if (!merchant) return message("Merchant not found.", 404);

  let paymentProofUrl: string | null = null;
  let paymentProofPath = "";
  if (file) {
    try {
      const uploaded = await uploadMerchantFile(auth, "merchant-payment-proofs", "payments", file, false);
      paymentProofUrl = uploaded?.value || null;
      paymentProofPath = uploaded?.path || "";
    } catch (error) {
      return message(error, 422);
    }
  }

  const result = await database(auth.admin).rpc("record_sales_cash_collection", {
    p_org_id: auth.orgId,
    p_actor_user_id: auth.user.id,
    p_request_id: auth.requestId,
    p_command_id: parsed.data.command_id || crypto.randomUUID(),
    p_collection_id: parsed.data.collection_id || crypto.randomUUID(),
    p_collection_type: "merchant",
    p_subject_id: merchantId,
    p_amount: parsed.data.amount,
    p_payment_method: parsed.data.payment_method,
    p_collection_date: parsed.data.collection_date || null,
    p_notes: parsed.data.notes || null,
    p_payment_proof_path: paymentProofUrl,
  });
  if (result.error) {
    if (paymentProofPath) await removeUploadedPaths(auth.admin, "merchant-payment-proofs", [paymentProofPath]).catch(() => undefined);
    return message(result.error.message, rpcStatus(result.error.code));
  }
  const saved = row(result.data);
  saved.payment_proof_url = await signPaymentProof(auth, saved.payment_proof_url);
  return json(saved, 201);
}

async function handleMerchantPayments(request: NextRequest, auth: AuthContext, segments: string[]) {
  const paymentId = segments[1] || "";
  if (!paymentId || segments[2] !== "confirm") return message("Merchant route was not found.", 404);
  if (request.method !== "PATCH") return message("Method not allowed", 405);
  if (!auth.isAgent && !auth.isManager) return message("Only agents or managers can confirm payments.", 403);

  const body = await readBody(request);
  const parsed = confirmMerchantPaymentSchema.safeParse(body);
  if (!parsed.success) return message(parseError(parsed.error), 400);

  const result = await database(auth.admin).rpc("transition_merchant_cash_collection", {
    p_org_id: auth.orgId,
    p_actor_user_id: auth.user.id,
    p_request_id: auth.requestId,
    p_command_id: parsed.data.command_id || crypto.randomUUID(),
    p_collection_id: paymentId,
    p_expected_version: parsed.data.expected_version,
    p_decision: parsed.data.status,
    p_rejection_reason: parsed.data.rejection_reason || null,
  });
  if (result.error) return message(result.error.message, rpcStatus(result.error.code));
  const saved = row(result.data);
  saved.payment_proof_url = await signPaymentProof(auth, saved.payment_proof_url);
  return json(saved);
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
    return message("Commission payments must be posted by Finance through an immutable settlement batch.", 410);
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
// Trader sale activation records
// ---------------------------------------------------------------------------
async function handleMerchantSales(request: NextRequest, auth: AuthContext) {
  if (request.method !== "GET") return message("Method not allowed", 405);
  if (!auth.isManager) return message("Only on-ground managers can view trader sale details.", 403);

  const db = database(auth.admin);
  const result = await db
    .from("sim_sales")
    .select("*")
    .eq("organization_id", auth.orgId)
    .eq("seller_type", "merchant")
    .order("sold_at", { ascending: false });
  if (result.error) return message(result.error.message, 500);

  const sales = rows(result.data);
  const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean)));
  const merchantIds = unique(sales.map((sale) => asString(sale.merchant_id)));
  const agentIds = unique(sales.map((sale) => asString(sale.agent_id)));
  const simIds = unique(sales.map((sale) => asString(sale.sim_unit_id)));
  const packageIds = unique(sales.map((sale) => asString(sale.package_id)));

  const [merchantResult, agentResult, simResult, packageResult] = await Promise.all([
    merchantIds.length
      ? db.from("merchants").select("id, business_name, owner_name, phone").eq("organization_id", auth.orgId).in("id", merchantIds)
      : Promise.resolve({ data: [], error: null }),
    agentIds.length
      ? db.from("field_agents").select("id, full_name, phone").eq("organization_id", auth.orgId).in("id", agentIds)
      : Promise.resolve({ data: [], error: null }),
    simIds.length
      ? db.from("sim_units").select("id, iccid, provider, sim_type").eq("organization_id", auth.orgId).in("id", simIds)
      : Promise.resolve({ data: [], error: null }),
    packageIds.length
      ? db.from("sim_packages").select("id, package_name, provider").eq("organization_id", auth.orgId).in("id", packageIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (merchantResult.error) return message(merchantResult.error.message, 500);
  if (agentResult.error) return message(agentResult.error.message, 500);
  if (simResult.error) return message(simResult.error.message, 500);
  if (packageResult.error) return message(packageResult.error.message, 500);

  const byId = (items: unknown[] | null | undefined) => {
    const map = new Map<string, Record<string, unknown>>();
    for (const item of rows(items)) {
      const entry = row(item);
      const id = asString(entry.id);
      if (id) map.set(id, entry);
    }
    return map;
  };
  const merchants = byId(merchantResult.data as unknown[] | null | undefined);
  const agents = byId(agentResult.data as unknown[] | null | undefined);
  const sims = byId(simResult.data as unknown[] | null | undefined);
  const packages = byId(packageResult.data as unknown[] | null | undefined);

  return json(
    sales.map((sale) => {
      const merchant = merchants.get(asString(sale.merchant_id));
      const agent = agents.get(asString(sale.agent_id));
      const sim = sims.get(asString(sale.sim_unit_id));
      const simPackage = packages.get(asString(sale.package_id));

      return {
        ...sale,
        merchant_name: asString(merchant?.business_name),
        merchant_owner_name: asString(merchant?.owner_name),
        merchant_phone: asString(merchant?.phone),
        agent_name: asString(agent?.full_name),
        agent_phone: asString(agent?.phone),
        sim_iccid: asString(sim?.iccid),
        sim_provider: asString(sim?.provider),
        sim_type: asString(sim?.sim_type),
        package_name: asString(simPackage?.package_name),
        package_provider: asString(simPackage?.provider),
      };
    })
  );
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

  const heldResult = await db
    .from("sim_units")
    .select("id, price")
    .eq("organization_id", auth.orgId)
    .eq("current_merchant_id", merchantId)
    .eq("status", "with_merchant");
  const soldResult = await db
    .from("sim_units")
    .select("id, sold_price")
    .eq("organization_id", auth.orgId)
    .eq("sold_by_merchant_id", merchantId)
    .eq("status", "sold");
  const collectionsResult = await db
    .from("merchant_cash_collections")
    .select("amount, status")
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
  const collections = rows(collectionsResult.data);
  const totalOwed = sold.reduce((s, r) => s + asNumber(r.sold_price), 0);
  const totalCollected = collections
    .filter((r) => asString(r.status) === "confirmed")
    .reduce((s, r) => s + asNumber(r.amount), 0);
  const pendingPayments = collections
    .filter((r) => asString(r.status) === "pending")
    .reduce((s, r) => s + asNumber(r.amount), 0);
  const unpaidCommission = rows(commissionsResult.data).reduce((s, r) => s + asNumber(r.commission_amount), 0);

  return json({
    merchant,
    balance: {
      total_owed: totalOwed,
      total_collected: totalCollected,
      pending_payments: pendingPayments,
      outstanding: totalOwed - totalCollected,
    },
    stock: {
      in_hand: held.length,
      sold_total: sold.length,
      in_hand_value: held.reduce((sum, sim) => sum + asNumber(sim.price), 0),
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
  const segments = await segmentsOf(context);
  const resource = segments[0] || "";

  if (resource === "packages") return handlePackages(request, auth, segments);
  if (resource === "sims") return handleMerchantSims(request, auth, segments);
  if (resource === "collect") return handleMerchantCollect(request, auth);
  if (resource === "payments") return handleMerchantPayments(request, auth, segments);
  if (resource === "requests") return handleMerchantRequests(request, auth, segments);
  if (resource === "commissions") return handleMerchantCommissions(request, auth, segments);
  if (resource === "sales") return handleMerchantSales(request, auth);
  if (resource === "me") return handleMerchantMe(request, auth, segments);
  if (resource === "analytics") return handleMerchantAnalytics(request, auth, segments);

  return handleMerchants(request, auth, segments);
}

async function authorize(request: NextRequest, context: RouteContext) {
  const auth = await requireMerchantAccess(request);
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
