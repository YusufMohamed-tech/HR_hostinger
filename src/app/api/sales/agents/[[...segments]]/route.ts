import { NextRequest, NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { requireFieldAgentAccess } from "@/lib/server/field-agent-auth";
import {
  assignSimsByQuantitySchema,
  assignSimsSchema,
  collectCashSchema,
  createAgentSchema,
  importSimsSchema,
  recordSaleSchema,
  returnSimSchema,
  voidSimSaleSchema,
  reviewRequestSchema,
  simBoxImportSchema,
  simRequestSchema,
  updateAgentSchema,
} from "@/lib/field-agents/schemas";
import { normalizeProvider, validateSimBoxImportInput } from "@/lib/sim-box-import";
import { inspectUpload } from "@/lib/server/upload-security";
import { storeObject } from "@/lib/server/file-storage";

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

type AuthContext = {
  user: User;
  orgId: string;
  role: string;
  isManager: boolean;
  admin: unknown;
  requestId: string;
};

type RouteContext = {
  params: Promise<{
    segments?: string[];
  }>;
};

function database(admin: unknown) {
  return admin as UntypedSupabase;
}

function adminAuth(admin: unknown) {
  return admin as AdminAuthClient;
}

// Returns the auth user id for an email, or null if none exists.
async function findAuthUserIdByEmail(auth: AuthContext, email: string): Promise<string | null> {
  const target = email.toLowerCase();
  let page = 1;
  const perPage = 100;
  // Bounded scan; orgs here are small enough that a few pages suffice.
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

function json(data: unknown, status = 200) {
  return NextResponse.json({ data }, { status });
}

function message(error: unknown, status = 500) {
  return NextResponse.json(
    { message: error instanceof Error ? error.message : String(error || "Field agent request failed.") },
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

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function mapById(value: unknown) {
  const map = new Map<string, Record<string, unknown>>();
  for (const item of rows(value)) {
    const entry = row(item);
    const id = asString(entry.id);
    if (id) map.set(id, entry);
  }
  return map;
}

function asString(value: unknown) {
  return String(value || "").trim();
}

function asNumber(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function safeFilename(name: string) {
  return name.replace(/[^\w.\-]+/g, "-").replace(/-+/g, "-").slice(0, 120) || "upload";
}

async function readBody(request: NextRequest) {
  return request.json().catch(() => ({}));
}

function inventoryCommandId(request: NextRequest, value?: string) {
  const header = request.headers.get("idempotency-key") || "";
  const candidate = value || header;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)
    ? candidate
    : crypto.randomUUID();
}

function formString(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function formNumber(form: FormData, key: string) {
  const value = formString(form, key);
  if (!value) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// Resolves the field_agents.id row that belongs to the current auth user.
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

async function uploadSimBoxImage(auth: AuthContext, file: File, buffer: Buffer, contentType: string) {
  const path = `orgs/${auth.orgId}/sales/sim-box-imports/temp/${auth.requestId}/${crypto.randomUUID()}-${safeFilename(file.name)}`;
  const uploaded = await storeObject(auth.admin as Parameters<typeof storeObject>[0], {
    bucket: "sim-box-imports", path, bytes: buffer,
    contentType, upsert: false,
  });
  return uploaded.path;
}

async function duplicateKitCodes(auth: AuthContext, provider: string, kitCodes: string[]) {
  if (kitCodes.length === 0) return [];
  const result = await database(auth.admin)
    .from("sim_units")
    .select("kit_code")
    .eq("organization_id", auth.orgId)
    .eq("provider", provider)
    .in("kit_code", kitCodes);
  if (result.error) throw new Error(result.error.message || "Unable to validate duplicate kit codes.");

  const byKitCode = new Set(rows(result.data).map((item) => asString(item.kit_code)).filter(Boolean));

  // The legacy schema still has UNIQUE(organization_id, iccid). Since OCR imports
  // mirror kit_code into iccid for compatibility, protect the insert from that
  // older uniqueness constraint too.
  const iccidResult = await database(auth.admin)
    .from("sim_units")
    .select("iccid")
    .eq("organization_id", auth.orgId)
    .in("iccid", kitCodes);
  if (iccidResult.error) throw new Error(iccidResult.error.message || "Unable to validate duplicate ICCIDs.");
  for (const item of rows(iccidResult.data)) {
    const iccid = asString(item.iccid);
    if (iccid) byKitCode.add(iccid);
  }

  return kitCodes.filter((kitCode) => byKitCode.has(kitCode));
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------
async function handleAgents(request: NextRequest, auth: AuthContext, segments: string[]) {
  if (!auth.isManager) return message("Field agent manager access is required.", 403);
  const db = database(auth.admin);
  const agentId = segments[0] && segments[0] !== "" ? segments[0] : "";

  // /agents  (collection)
  if (!agentId) {
    if (request.method === "GET") {
      const result = await db
        .from("field_agents")
        .select("*")
        .eq("organization_id", auth.orgId)
        .order("created_at", { ascending: false });
      if (result.error) return message(result.error.message, 500);
      return json(rows(result.data));
    }

    if (request.method === "POST") {
      const body = await readBody(request);
      const parsed = createAgentSchema.safeParse(body);
      if (!parsed.success) return message(parseError(parsed.error), 400);

      const email = parsed.data.email.toLowerCase();
      const commandId = parsed.data.command_id || crypto.randomUUID();

      const commandResult = await db.from("sales_identity_commands").select("identity_type, actor_user_id, status, result_snapshot")
        .eq("org_id", auth.orgId).eq("command_id", commandId).maybeSingle();
      if (commandResult.error) return message(commandResult.error.message, 500);
      if (commandResult.data) {
        const command = row(commandResult.data);
        if (command.identity_type !== "field_agent" || command.actor_user_id !== auth.user.id) {
          return message("Command id was already used for another identity request.", 409);
        }
        if (command.status === "completed" && command.result_snapshot) return json(command.result_snapshot);
        return message("Field-agent provisioning is already processing.", 409);
      }

      // Reject if the email is already in use to avoid altering an existing account.
      const existingUserId = await findAuthUserIdByEmail(auth, email);
      if (existingUserId) {
        return message("البريد الإلكتروني مستخدم بالفعل.", 400);
      }

      // 1. Create the auth account.
      const created = await adminAuth(auth.admin).auth.admin.createUser({
        email,
        password: parsed.data.password,
        email_confirm: true,
        user_metadata: { full_name: parsed.data.full_name, identity_command_id: commandId },
      });
      if (created.error || !created.data.user) {
        return message(created.error?.message || "تعذر إنشاء الحساب.", 500);
      }
      const userId = created.data.user.id;
      const cleanup = await db.rpc("enqueue_identity_auth_sync_job", {
        p_org_id: auth.orgId,
        p_target_user_id: userId,
        p_action: "delete",
        p_source_type: "provisioning_safety",
        p_source_id: commandId,
        p_reason: "Delete field-agent Auth identity if database provisioning never completes.",
        p_actor_user_id: auth.user.id,
        p_request_id: auth.requestId,
        p_delay_seconds: 600,
      });
      if (cleanup.error || !row(cleanup.data).id) {
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
        p_identity_type: "field_agent",
        p_payload: {
          email,
          display_name: parsed.data.full_name,
          phone: parsed.data.phone,
          national_id: parsed.data.national_id,
          region: parsed.data.region || null,
          commission_rate: parsed.data.commission_rate,
          sim_price: parsed.data.sim_price,
          max_sim_capacity: parsed.data.max_sim_capacity ?? null,
        },
      });
      if (result.error) {
        return message(result.error.message, rpcStatus(result.error.code));
      }
      const cancellation = await db.rpc("cancel_identity_auth_sync_job", {
        p_job_id: cleanupJobId,
        p_reason: "Field-agent identity provisioned successfully.",
      });
      if (cancellation.error) {
        console.error("Field-agent identity cleanup cancellation requires reconciliation.", {
          cleanupJobId, userId, message: cancellation.error.message,
        });
      }
      return json(row(result.data), 201);
    }

    return message("Method not allowed", 405);
  }

  // /agents/[id]/sales
  if (segments[1] === "sales") {
    if (request.method !== "GET") return message("Method not allowed", 405);

    const agentResult = await db
      .from("field_agents")
      .select("*")
      .eq("organization_id", auth.orgId)
      .eq("id", agentId)
      .maybeSingle();
    if (agentResult.error) return message(agentResult.error.message, 500);
    if (!agentResult.data) return message("Agent not found.", 404);
    const agent = row(agentResult.data);

    let query = db
      .from("sim_sales")
      .select("*")
      .eq("organization_id", auth.orgId)
      .eq("agent_id", agentId);

    const sellerType = asString(request.nextUrl.searchParams.get("seller_type"));
    if (sellerType === "agent" || sellerType === "merchant") {
      query = query.eq("seller_type", sellerType);
    }

    const result = await query.order("sold_at", { ascending: false }).limit(500);
    if (result.error) return message(result.error.message, 500);

    const sales = rows(result.data);
    const merchantIds = uniqueStrings(sales.map((sale) => asString(sale.merchant_id)));
    const simIds = uniqueStrings(sales.map((sale) => asString(sale.sim_unit_id)));
    const packageIds = uniqueStrings(sales.map((sale) => asString(sale.package_id)));

    const [merchantResult, simResult, packageResult] = await Promise.all([
      merchantIds.length
        ? db
            .from("merchants")
            .select("id, business_name, owner_name, phone")
            .eq("organization_id", auth.orgId)
            .in("id", merchantIds)
        : Promise.resolve({ data: [], error: null }),
      simIds.length
        ? db
            .from("sim_units")
            .select("id, iccid, provider, sim_type")
            .eq("organization_id", auth.orgId)
            .in("id", simIds)
        : Promise.resolve({ data: [], error: null }),
      packageIds.length
        ? db
            .from("sim_packages")
            .select("id, package_name, provider")
            .eq("organization_id", auth.orgId)
            .in("id", packageIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (merchantResult.error) return message(merchantResult.error.message, 500);
    if (simResult.error) return message(simResult.error.message, 500);
    if (packageResult.error) return message(packageResult.error.message, 500);

    const merchants = mapById(merchantResult.data);
    const sims = mapById(simResult.data);
    const packages = mapById(packageResult.data);

    const directSales = sales.filter((sale) => asString(sale.seller_type) === "agent");
    const merchantSales = sales.filter((sale) => asString(sale.seller_type) === "merchant");
    const sum = (items: Record<string, unknown>[], key: string) =>
      items.reduce((total, item) => total + asNumber(item[key]), 0);

    return json({
      agent,
      summary: {
        total_count: sales.length,
        direct_count: directSales.length,
        merchant_count: merchantSales.length,
        total_value: sum(sales, "sale_price"),
        direct_value: sum(directSales, "sale_price"),
        merchant_value: sum(merchantSales, "sale_price"),
        agent_commission_amount: sum(sales, "agent_commission_amount"),
        merchant_commission_amount: sum(sales, "merchant_commission_amount"),
        direct_agent_commission_amount: sum(sales, "direct_agent_commission_amount"),
      },
      sales: sales.map((sale) => {
        const merchant = merchants.get(asString(sale.merchant_id));
        const sim = sims.get(asString(sale.sim_unit_id));
        const simPackage = packages.get(asString(sale.package_id));

        return {
          ...sale,
          merchant_name: asString(merchant?.business_name),
          merchant_owner_name: asString(merchant?.owner_name),
          merchant_phone: asString(merchant?.phone),
          agent_name: asString(agent.full_name),
          agent_phone: asString(agent.phone),
          sim_iccid: asString(sim?.iccid),
          sim_provider: asString(sim?.provider),
          sim_type: asString(sim?.sim_type),
          package_name: asString(simPackage?.package_name),
          package_provider: asString(simPackage?.provider),
        };
      }),
    });
  }

  // /agents/[id]/collections
  if (segments[1] === "collections") {
    if (request.method !== "GET") return message("Method not allowed", 405);
    const result = await db
      .from("agent_cash_collections")
      .select("*")
      .eq("organization_id", auth.orgId)
      .eq("agent_id", agentId)
      .order("collection_date", { ascending: false });
    if (result.error) return message(result.error.message, 500);
    return json(rows(result.data));
  }

  // /agents/[id]
  if (request.method === "GET") {
    const result = await db
      .from("field_agents")
      .select("*")
      .eq("organization_id", auth.orgId)
      .eq("id", agentId)
      .maybeSingle();
    if (result.error) return message(result.error.message, 500);
    if (!result.data) return message("Agent not found.", 404);
    return json(row(result.data));
  }

  if (request.method === "PATCH") {
    const body = await readBody(request);
    const parsed = updateAgentSchema.safeParse(body);
    if (!parsed.success) return message(parseError(parsed.error), 400);

    const result = await db
      .from("field_agents")
      .update(parsed.data)
      .eq("organization_id", auth.orgId)
      .eq("id", agentId)
      .select("*")
      .single();
    if (result.error) return message(result.error.message, 500);
    return json(row(result.data));
  }

  return message("Method not allowed", 405);
}

// ---------------------------------------------------------------------------
// SIM inventory
// ---------------------------------------------------------------------------
async function handleSims(request: NextRequest, auth: AuthContext, segments: string[]) {
  const db = database(auth.admin);
  const action = segments[1] || "";

  // GET /sims  (managers: all; agents: own)
  if (!action) {
    if (request.method !== "GET") return message("Method not allowed", 405);
    let query = db.from("sim_units").select("*").eq("organization_id", auth.orgId);

    const status = asString(request.nextUrl.searchParams.get("status"));
    const agentFilter = asString(request.nextUrl.searchParams.get("agent_id"));

    if (auth.isManager) {
      if (status) query = query.eq("status", status);
      if (agentFilter) query = query.eq("current_agent_id", agentFilter);
    } else {
      const myAgentId = await resolveAgentId(auth);
      if (!myAgentId) return json([]);
      query = query.eq("current_agent_id", myAgentId);
      if (status) query = query.eq("status", status);
    }

    const result = await query.order("created_at", { ascending: false });
    if (result.error) return message(result.error.message, 500);
    return json(rows(result.data));
  }

  // POST /sims/import  (manager)
  if (action === "import") {
    if (request.method !== "POST") return message("Method not allowed", 405);
    if (!auth.isManager) return message("Field agent manager access is required.", 403);

    const body = await readBody(request);
    const parsed = importSimsSchema.safeParse(body);
    if (!parsed.success) return message(parseError(parsed.error), 400);

    const result = await db.rpc("execute_sim_inventory_command", {
      p_org_id: auth.orgId,
      p_actor_user_id: auth.user.id,
      p_request_id: auth.requestId,
      p_command_id: inventoryCommandId(request, parsed.data.command_id),
      p_action: "inventory_import",
      p_payload: { sims: parsed.data.sims },
    });
    if (result.error) return message(result.error.message, rpcStatus(result.error.code));
    return json(row(result.data), 201);
  }

  // POST /sims/box-preview  (manager)
  if (action === "box-preview") {
    if (request.method !== "POST") return message("Method not allowed", 405);
    if (!auth.isManager) return message("Field agent manager access is required.", 403);

    const contentType = request.headers.get("content-type") || "";
    let imagePath = "";
    let provider = "";
    let orderNumber = "";
    let batchNumber = "";
    let barcodeText = "";
    let firstKitcode = "";
    let lastKitcode = "";
    let quantity: number | null = null;
    let dealerBoxNumber: number | null = null;
    let dealerBoxTotal: number | null = null;
    let confidence: number | null = null;
    let rawOcrText = "";
    let rawNotes: string[] = [];
    const storageWarnings: string[] = [];

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData().catch(() => null);
      if (!form) return message("Multipart form data is required.", 400);
      const file = form.get("image");
      if (file instanceof File && file.size > 0) {
        try {
          const inspected = await inspectUpload(file, {
            allowedMimeTypes: new Set(["image/jpeg", "image/png", "image/webp"]),
            maxBytes: 10 * 1024 * 1024,
          });
          imagePath = await uploadSimBoxImage(auth, file, Buffer.from(inspected.bytes), inspected.detectedMime);
        } catch (error) {
          return message(error, 422);
        }
      }
      imagePath = imagePath || formString(form, "image_path");
      if (imagePath && !imagePath.startsWith(`orgs/${auth.orgId}/sales/sim-box-imports/`)) {
        return message("SIM box image path is not tenant scoped.", 403);
      }
      provider = formString(form, "provider");
      orderNumber = formString(form, "order_number");
      batchNumber = formString(form, "batch_number");
      barcodeText = formString(form, "barcode_text");
      firstKitcode = formString(form, "first_kitcode");
      lastKitcode = formString(form, "last_kitcode");
      quantity = formNumber(form, "quantity");
      dealerBoxNumber = formNumber(form, "dealer_box_number");
      dealerBoxTotal = formNumber(form, "dealer_box_total");
      confidence = formNumber(form, "confidence");
      rawOcrText = formString(form, "raw_ocr_text");
      const rawNotesText = formString(form, "raw_notes");
      if (rawNotesText) {
        try {
          const parsedNotes = JSON.parse(rawNotesText);
          rawNotes = Array.isArray(parsedNotes) ? parsedNotes.map(String).filter(Boolean) : [];
        } catch {
          rawNotes = [rawNotesText];
        }
      }
    } else {
      const body = row(await readBody(request));
      imagePath = asString(body.image_path);
      provider = asString(body.provider);
      orderNumber = asString(body.order_number);
      batchNumber = asString(body.batch_number);
      barcodeText = asString(body.barcode_text);
      firstKitcode = asString(body.first_kitcode);
      lastKitcode = asString(body.last_kitcode);
      quantity = body.quantity == null || body.quantity === "" ? null : asNumber(body.quantity);
      dealerBoxNumber = body.dealer_box_number == null || body.dealer_box_number === "" ? null : asNumber(body.dealer_box_number);
      dealerBoxTotal = body.dealer_box_total == null || body.dealer_box_total === "" ? null : asNumber(body.dealer_box_total);
      confidence = body.confidence == null || body.confidence === "" ? null : asNumber(body.confidence);
      rawOcrText = asString(body.raw_ocr_text);
      rawNotes = Array.isArray(body.raw_notes) ? body.raw_notes.map(String).filter(Boolean) : [];
    }

    const normalizedProvider = normalizeProvider(provider || "virgin");
    const validation = validateSimBoxImportInput({
      provider: normalizedProvider,
      first_kitcode: firstKitcode,
      last_kitcode: lastKitcode,
      quantity: quantity || 0,
    });

    let duplicateKitCodeList: string[] = [];
    if (validation.kitCodes.length > 0) {
      try {
        duplicateKitCodeList = await duplicateKitCodes(auth, normalizedProvider, validation.kitCodes);
      } catch (error) {
        return message(error, 500);
      }
    }

    const warnings = [...validation.warnings, ...rawNotes, ...storageWarnings];
    if (confidence !== null && confidence > 0 && confidence < 65) {
      warnings.push("OCR confidence is low; review all fields before importing.");
    }
    if (duplicateKitCodeList.length > 0) {
      warnings.push("Some generated kit codes already exist and may block import.");
    }

    return json({
      extracted: {
        provider: normalizedProvider,
        order_number: orderNumber || null,
        batch_number: batchNumber || null,
        barcode_text: barcodeText || null,
        first_kitcode: firstKitcode || null,
        last_kitcode: lastKitcode || null,
        quantity: quantity || null,
        dealer_box_number: dealerBoxNumber,
        dealer_box_total: dealerBoxTotal,
        confidence: confidence ?? undefined,
        raw_notes: rawNotes,
        raw_ocr_text: rawOcrText || undefined,
      },
      generation: {
        step: validation.step,
        generated_count: validation.kitCodes.length,
        kit_codes: validation.kitCodes,
      },
      validation: {
        is_valid: validation.errors.length === 0 && duplicateKitCodeList.length === 0,
        errors: validation.errors,
        warnings,
        duplicate_kit_codes: duplicateKitCodeList,
        duplicate_count: duplicateKitCodeList.length,
      },
      image_path: imagePath,
    });
  }

  // POST /sims/box-import  (manager)
  if (action === "box-import") {
    if (request.method !== "POST") return message("Method not allowed", 405);
    if (!auth.isManager) return message("Field agent manager access is required.", 403);

    const body = await readBody(request);
    const parsed = simBoxImportSchema.safeParse(body);
    if (!parsed.success) return message(parseError(parsed.error), 400);

    const normalizedProvider = normalizeProvider(parsed.data.provider);
    const validation = validateSimBoxImportInput({
      provider: normalizedProvider,
      first_kitcode: parsed.data.first_kitcode,
      last_kitcode: parsed.data.last_kitcode,
      quantity: parsed.data.quantity,
      step: parsed.data.step,
    });
    if (!validation.isValid) return message(validation.errors.join(" "), 400);

    const assignedAgentId = asString(parsed.data.assigned_agent_id) || null;
    const result = await db.rpc("execute_sim_inventory_command", {
      p_org_id: auth.orgId,
      p_actor_user_id: auth.user.id,
      p_request_id: auth.requestId,
      p_command_id: inventoryCommandId(request, parsed.data.command_id),
      p_action: "inventory_box_import",
      p_payload: {
        provider: normalizedProvider,
        order_number: parsed.data.order_number || null,
        batch_number: parsed.data.batch_number || null,
        barcode_text: parsed.data.barcode_text || null,
        dealer_box_number: parsed.data.dealer_box_number ?? null,
        dealer_box_total: parsed.data.dealer_box_total ?? null,
        first_kitcode: validation.firstKitcode,
        last_kitcode: validation.lastKitcode,
        quantity: validation.quantity,
        step: validation.step,
        image_path: parsed.data.image_path || null,
        extracted_json: parsed.data.extracted_json || {},
        assigned_agent_id: assignedAgentId,
        kit_codes: validation.kitCodes,
        skip_duplicates: parsed.data.import_duplicate_strategy === "skip",
      },
    });
    if (result.error) return message(result.error.message, rpcStatus(result.error.code));
    return json(row(result.data), 201);
  }

  // GET /sims/import-batches and /sims/import-batches/[batchId]
  if (action === "import-batches") {
    if (request.method !== "GET") return message("Method not allowed", 405);
    const batchId = segments[2] || "";

    if (batchId) {
      const batchResult = await db
        .from("sim_import_batches")
        .select("*")
        .eq("organization_id", auth.orgId)
        .eq("id", batchId)
        .maybeSingle();
      if (batchResult.error) return message(batchResult.error.message, 500);
      if (!batchResult.data) return message("Import batch not found.", 404);
      const batch = row(batchResult.data);
      if (!auth.isManager) {
        const myAgentId = await resolveAgentId(auth);
        if (!myAgentId || asString(batch.assigned_agent_id) !== myAgentId) return message("Forbidden", 403);
      }
      const simsResult = await db
        .from("sim_units")
        .select("*")
        .eq("organization_id", auth.orgId)
        .eq("import_batch_id", batchId)
        .order("box_sequence", { ascending: true });
      if (simsResult.error) return message(simsResult.error.message, 500);
      return json({ batch, sims: rows(simsResult.data) });
    }

    let query = db.from("sim_import_batches").select("*").eq("organization_id", auth.orgId);
    if (auth.isManager) {
      const provider = asString(request.nextUrl.searchParams.get("provider"));
      const batchNumber = asString(request.nextUrl.searchParams.get("batch_number"));
      const orderNumber = asString(request.nextUrl.searchParams.get("order_number"));
      const status = asString(request.nextUrl.searchParams.get("status"));
      const assignedAgentId = asString(request.nextUrl.searchParams.get("assigned_agent_id"));
      if (provider) query = query.eq("provider", provider);
      if (batchNumber) query = query.eq("batch_number", batchNumber);
      if (orderNumber) query = query.eq("order_number", orderNumber);
      if (status) query = query.eq("status", status);
      if (assignedAgentId) query = query.eq("assigned_agent_id", assignedAgentId);
    } else {
      const myAgentId = await resolveAgentId(auth);
      if (!myAgentId) return json([]);
      query = query.eq("assigned_agent_id", myAgentId);
    }

    const result = await query.order("created_at", { ascending: false }).limit(100);
    if (result.error) return message(result.error.message, 500);
    return json(rows(result.data));
  }

  // POST /sims/assign  (manager)
  if (action === "assign") {
    if (request.method !== "POST") return message("Method not allowed", 405);
    if (!auth.isManager) return message("Field agent manager access is required.", 403);

    const body = await readBody(request);
    const quantityParsed = assignSimsByQuantitySchema.safeParse(body);
    const parsed = quantityParsed.success ? null : assignSimsSchema.safeParse(body);
    if (!quantityParsed.success && !parsed?.success) {
      return message(parseError(parsed?.error || quantityParsed.error), 400);
    }

    let commandId: string | undefined;
    let payload: Record<string, unknown>;
    if (quantityParsed.success) {
      commandId = quantityParsed.data.command_id;
      payload = {
        agent_id: quantityParsed.data.agent_id,
        quantity: quantityParsed.data.quantity,
        provider: quantityParsed.data.provider,
        sim_type: quantityParsed.data.sim_type || null,
        notes: quantityParsed.data.notes || null,
      };
    } else {
      if (!parsed?.success) return message("Invalid SIM assignment.", 400);
      commandId = parsed.data.command_id;
      payload = {
        agent_id: parsed.data.agent_id,
        sim_ids: parsed.data.sim_ids,
        notes: parsed.data.notes || null,
      };
    }
    const result = await db.rpc("execute_sim_inventory_command", {
      p_org_id: auth.orgId,
      p_actor_user_id: auth.user.id,
      p_request_id: auth.requestId,
      p_command_id: inventoryCommandId(request, commandId),
      p_action: "inventory_assign",
      p_payload: payload,
    });
    if (result.error) return message(result.error.message, rpcStatus(result.error.code));
    return json(row(result.data));
  }

  // POST /sims/sell  (agent or manager)
  if (action === "sell") {
    if (request.method !== "POST") return message("Method not allowed", 405);
    const body = await readBody(request);
    const parsed = recordSaleSchema.safeParse(body);
    if (!parsed.success) return message(parseError(parsed.error), 400);
    const rpc = await db.rpc("record_sim_sale", {
      p_org_id: auth.orgId,
      p_actor_user_id: auth.user.id,
      p_command_id: parsed.data.command_id || crypto.randomUUID(),
      p_request_id: auth.requestId,
      p_sim_unit_id: parsed.data.sim_unit_id,
      p_package_id: parsed.data.package_id,
      p_seller_type: "agent",
      p_customer: { customer_name: parsed.data.customer_name ?? null },
    });
    if (rpc.error) return message(rpc.error.message, rpcStatus(rpc.error.code));
    const result = await db.from("sim_units").select("*")
      .eq("organization_id", auth.orgId).eq("id", parsed.data.sim_unit_id).single();
    if (result.error) return message(result.error.message, 500);
    return json(row(result.data));
  }

  // POST /sims/return  (agent or manager)
  if (action === "return") {
    if (request.method !== "POST") return message("Method not allowed", 405);
    const body = await readBody(request);
    const parsed = returnSimSchema.safeParse(body);
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

  // POST /sims/void — manager-only immutable sale reversal.
  if (action === "void") {
    if (request.method !== "POST") return message("Method not allowed", 405);
    if (!auth.isManager) return message("Field agent manager access is required.", 403);
    const body = await readBody(request);
    const parsed = voidSimSaleSchema.safeParse(body);
    if (!parsed.success) return message(parseError(parsed.error), 400);
    const rpc = await db.rpc("void_sim_sale", {
      p_org_id: auth.orgId,
      p_actor_user_id: auth.user.id,
      p_command_id: parsed.data.command_id || crypto.randomUUID(),
      p_request_id: auth.requestId,
      p_sale_id: parsed.data.sale_id,
      p_expected_version: parsed.data.expected_version,
      p_reason: parsed.data.reason,
    });
    if (rpc.error) return message(rpc.error.message, rpcStatus(rpc.error.code));
    return json(row(rows(rpc.data)[0]));
  }

  return message("Field agent route was not found.", 404);
}

// ---------------------------------------------------------------------------
// Transfers
// ---------------------------------------------------------------------------
async function handleTransfers(request: NextRequest, auth: AuthContext) {
  if (!auth.isManager) return message("Field agent manager access is required.", 403);
  if (request.method !== "GET") return message("Method not allowed", 405);

  let query = database(auth.admin)
    .from("sim_transfers")
    .select("*")
    .eq("organization_id", auth.orgId);

  const simId = asString(request.nextUrl.searchParams.get("sim_unit_id"));
  if (simId) query = query.eq("sim_unit_id", simId);

  const result = await query.order("transfer_date", { ascending: false }).limit(500);
  if (result.error) return message(result.error.message, 500);
  return json(rows(result.data));
}

// ---------------------------------------------------------------------------
// Cash collections
// ---------------------------------------------------------------------------
async function handleCollect(request: NextRequest, auth: AuthContext) {
  if (!auth.isManager) return message("Field agent manager access is required.", 403);
  if (request.method !== "POST") return message("Method not allowed", 405);

  const body = await readBody(request);
  const parsed = collectCashSchema.safeParse(body);
  if (!parsed.success) return message(parseError(parsed.error), 400);

  const result = await database(auth.admin).rpc("record_sales_cash_collection", {
    p_org_id: auth.orgId,
    p_actor_user_id: auth.user.id,
    p_request_id: auth.requestId,
    p_command_id: parsed.data.command_id || crypto.randomUUID(),
    p_collection_id: parsed.data.collection_id || crypto.randomUUID(),
    p_collection_type: "agent",
    p_subject_id: parsed.data.agent_id,
    p_amount: parsed.data.amount,
    p_payment_method: parsed.data.payment_method,
    p_collection_date: parsed.data.collection_date,
    p_notes: parsed.data.notes || null,
    p_payment_proof_path: null,
  });
  if (result.error) return message(result.error.message, rpcStatus(result.error.code));
  return json(row(result.data), 201);
}

// ---------------------------------------------------------------------------
// SIM requests
// ---------------------------------------------------------------------------
async function handleRequests(request: NextRequest, auth: AuthContext, segments: string[]) {
  const db = database(auth.admin);
  const requestId = segments[1] || "";

  // /requests/[id]/review  (manager)
  if (requestId && segments[2] === "review") {
    if (request.method !== "PATCH") return message("Method not allowed", 405);
    if (!auth.isManager) return message("Field agent manager access is required.", 403);

    const body = await readBody(request);
    const parsed = reviewRequestSchema.safeParse(body);
    if (!parsed.success) return message(parseError(parsed.error), 400);

    const result = await db
      .from("agent_sim_requests")
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

  // /requests  (collection)
  if (!requestId) {
    if (request.method === "GET") {
      let query = db
        .from("agent_sim_requests")
        .select("*")
        .eq("organization_id", auth.orgId);

      if (!auth.isManager) {
        const myAgentId = await resolveAgentId(auth);
        if (!myAgentId) return json([]);
        query = query.eq("agent_id", myAgentId);
      } else {
        const status = asString(request.nextUrl.searchParams.get("status"));
        if (status) query = query.eq("status", status);
      }

      const result = await query.order("created_at", { ascending: false });
      if (result.error) return message(result.error.message, 500);
      return json(rows(result.data));
    }

    if (request.method === "POST") {
      const myAgentId = await resolveAgentId(auth);
      if (!myAgentId) return message("Only field agents can request SIMs.", 403);

      const body = await readBody(request);
      const parsed = simRequestSchema.safeParse(body);
      if (!parsed.success) return message(parseError(parsed.error), 400);

      const result = await db
        .from("agent_sim_requests")
        .insert({
          ...parsed.data,
          organization_id: auth.orgId,
          agent_id: myAgentId,
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
// Commissions
// ---------------------------------------------------------------------------
async function handleCommissions(request: NextRequest, auth: AuthContext, segments: string[]) {
  const db = database(auth.admin);
  const commissionId = segments[1] || "";

  // /commissions/[id]/pay  (manager)
  if (commissionId && segments[2] === "pay") {
    if (request.method !== "PATCH") return message("Method not allowed", 405);
    return message("Commission payments must be posted by Finance through an immutable settlement batch.", 410);
  }

  // /commissions  (list)
  if (!commissionId) {
    if (request.method !== "GET") return message("Method not allowed", 405);
    let query = db
      .from("agent_commissions")
      .select("*")
      .eq("organization_id", auth.orgId);

    if (!auth.isManager) {
      const myAgentId = await resolveAgentId(auth);
      if (!myAgentId) return json([]);
      query = query.eq("agent_id", myAgentId);
    } else {
      const agentFilter = asString(request.nextUrl.searchParams.get("agent_id"));
      if (agentFilter) query = query.eq("agent_id", agentFilter);
      const paid = asString(request.nextUrl.searchParams.get("is_paid"));
      if (paid === "true") query = query.eq("is_paid", true);
      if (paid === "false") query = query.eq("is_paid", false);
    }

    const result = await query.order("created_at", { ascending: false });
    if (result.error) return message(result.error.message, 500);
    return json(rows(result.data));
  }

  return message("Method not allowed", 405);
}

// ---------------------------------------------------------------------------
// Agent self dashboard
// ---------------------------------------------------------------------------
async function handleMe(request: NextRequest, auth: AuthContext, segments: string[]) {
  if (segments[1] !== "dashboard") return message("Field agent route was not found.", 404);
  if (request.method !== "GET") return message("Method not allowed", 405);

  const db = database(auth.admin);
  const myAgentId = await resolveAgentId(auth);
  if (!myAgentId) return message("No field agent profile found for this user.", 404);

  const agentResult = await db
    .from("field_agents")
    .select("*")
    .eq("organization_id", auth.orgId)
    .eq("id", myAgentId)
    .maybeSingle();
  if (agentResult.error) return message(agentResult.error.message, 500);
  if (!agentResult.data) return message("Agent not found.", 404);

  const simsResult = await db
    .from("sim_units")
    .select("status, sold_price")
    .eq("organization_id", auth.orgId)
    .eq("sold_by_agent_id", myAgentId);
  const heldResult = await db
    .from("sim_units")
    .select("id, price")
    .eq("organization_id", auth.orgId)
    .eq("current_agent_id", myAgentId)
    .eq("status", "with_agent");
  const collectionsResult = await db
    .from("agent_cash_collections")
    .select("amount")
    .eq("organization_id", auth.orgId)
    .eq("agent_id", myAgentId);
  const requestsResult = await db
    .from("agent_sim_requests")
    .select("id")
    .eq("organization_id", auth.orgId)
    .eq("agent_id", myAgentId)
    .eq("status", "pending");
  const commissionsResult = await db
    .from("agent_commissions")
    .select("commission_amount")
    .eq("organization_id", auth.orgId)
    .eq("agent_id", myAgentId)
    .eq("is_paid", false);

  const agent = row(agentResult.data);
  const soldRows = rows(simsResult.data).filter((sim) => asString(sim.status) === "sold");
  const totalSoldValue = soldRows.reduce((sum, sim) => sum + asNumber(sim.sold_price), 0);
  const held = rows(heldResult.data);
  const totalCollected = rows(collectionsResult.data).reduce((sum, item) => sum + asNumber(item.amount), 0);
  const unpaidCommission = rows(commissionsResult.data).reduce(
    (sum, item) => sum + asNumber(item.commission_amount),
    0
  );

  return json({
    agent,
    balance: {
      total_sold_value: totalSoldValue,
      total_collected: totalCollected,
      outstanding: totalSoldValue - totalCollected,
    },
    stock: {
      in_hand: held.length,
      sold_total: soldRows.length,
      in_hand_value: held.reduce((sum, sim) => sum + asNumber(sim.price), 0),
    },
    pending_requests: rows(requestsResult.data).length,
    unpaid_commission: unpaidCommission,
  });
}

// ---------------------------------------------------------------------------
// Stock overview
// ---------------------------------------------------------------------------
async function handleStock(request: NextRequest, auth: AuthContext, segments: string[]) {
  if (segments[1] !== "overview") return message("Field agent route was not found.", 404);
  if (request.method !== "GET") return message("Method not allowed", 405);
  if (!auth.isManager) return message("Field agent manager access is required.", 403);

  const db = database(auth.admin);
  const simsResult = await db
    .from("sim_units")
    .select("status, price, current_agent_id")
    .eq("organization_id", auth.orgId);
  if (simsResult.error) return message(simsResult.error.message, 500);
  const sims = rows(simsResult.data);

  const agentsResult = await db
    .from("field_agents")
    .select("id, full_name")
    .eq("organization_id", auth.orgId);
  const agentNames = new Map<string, string>();
  for (const agent of rows(agentsResult.data)) {
    agentNames.set(asString(agent.id), asString(agent.full_name));
  }

  const counts = { in_stock: 0, with_agent: 0, with_merchant: 0, sold: 0, returned: 0 };
  let totalValueInStock = 0;
  const byAgent = new Map<string, number>();

  for (const sim of sims) {
    const status = asString(sim.status);
    if (status === "in_stock") {
      counts.in_stock += 1;
      totalValueInStock += asNumber(sim.price);
    } else if (status === "with_agent") {
      counts.with_agent += 1;
      const agentId = asString(sim.current_agent_id);
      if (agentId) byAgent.set(agentId, (byAgent.get(agentId) || 0) + 1);
    } else if (status === "with_merchant") {
      counts.with_merchant += 1;
      const agentId = asString(sim.current_agent_id);
      if (agentId) byAgent.set(agentId, (byAgent.get(agentId) || 0) + 1);
    } else if (status === "sold") {
      counts.sold += 1;
    } else if (status === "returned") {
      counts.returned += 1;
    }
  }

  return json({
    in_stock: counts.in_stock,
    with_agents: counts.with_agent,
    with_merchants: counts.with_merchant,
    sold: counts.sold,
    returned: counts.returned,
    total_value_in_stock: totalValueInStock,
    by_agent: Array.from(byAgent.entries())
      .map(([agentId, count]) => ({
        agent_id: agentId,
        full_name: agentNames.get(agentId) || "",
        count,
      }))
      .sort((a, b) => b.count - a.count),
  });
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------
async function dispatch(request: NextRequest, auth: AuthContext, context: RouteContext) {
  const segments = await segmentsOf(context);
  const resource = segments[0] || "";

  if (resource === "sims") return handleSims(request, auth, segments);
  if (resource === "transfers") return handleTransfers(request, auth);
  if (resource === "collect") return handleCollect(request, auth);
  if (resource === "requests") return handleRequests(request, auth, segments);
  if (resource === "commissions") return handleCommissions(request, auth, segments);
  if (resource === "me") return handleMe(request, auth, segments);
  if (resource === "stock") return handleStock(request, auth, segments);

  // Empty resource or a bare id → agents handler.
  return handleAgents(request, auth, segments);
}

async function authorize(request: NextRequest, context: RouteContext) {
  const auth = await requireFieldAgentAccess(undefined, request);
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
