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
  reviewRequestSchema,
  simBoxImportSchema,
  simRequestSchema,
  updateAgentSchema,
} from "@/lib/field-agents/schemas";
import { normalizeProvider, validateSimBoxImportInput } from "@/lib/sim-box-import";

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

type StorageClient = {
  storage: {
    from: (bucket: string) => {
      upload: (
        path: string,
        body: Buffer,
        options?: { contentType?: string; upsert?: boolean }
      ) => Promise<{ data: { path: string } | null; error: { message?: string } | null }>;
    };
  };
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

function database(admin: unknown) {
  return admin as UntypedSupabase;
}

function adminAuth(admin: unknown) {
  return admin as AdminAuthClient;
}

function storage(admin: unknown) {
  return admin as StorageClient;
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
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function safeFilename(name: string) {
  return name.replace(/[^\w.\-]+/g, "-").replace(/-+/g, "-").slice(0, 120) || "upload";
}

function calculateCommission(type: string, value: number, salePrice: number) {
  if (type === "flat") return Math.round(value * 100) / 100;
  return Math.round(salePrice * (value / 100) * 100) / 100;
}

async function readBody(request: NextRequest) {
  return request.json().catch(() => ({}));
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

async function insertTransfer(
  auth: AuthContext,
  values: {
    sim_unit_id: string;
    transfer_type: string;
    from_agent_id?: string | null;
    to_agent_id?: string | null;
    notes?: string | null;
  }
) {
  await database(auth.admin).from("sim_transfers").insert({
    organization_id: auth.orgId,
    sim_unit_id: values.sim_unit_id,
    transfer_type: values.transfer_type,
    from_agent_id: values.from_agent_id ?? null,
    to_agent_id: values.to_agent_id ?? null,
    performed_by: auth.user.id,
    notes: values.notes ?? null,
  });
}

async function uploadSimBoxImage(auth: AuthContext, file: File, buffer: Buffer) {
  const path = `orgs/${auth.orgId}/sales/sim-box-imports/temp/${Date.now()}-${safeFilename(file.name)}`;
  const upload = await storage(auth.admin).storage.from("sim-box-imports").upload(path, buffer, {
    contentType: file.type || undefined,
    upsert: false,
  });
  if (upload.error || !upload.data) throw new Error(upload.error?.message || "Unable to upload SIM box image.");
  return upload.data.path;
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

async function validateAssignedAgent(auth: AuthContext, agentId: string, incomingCount: number) {
  const db = database(auth.admin);
  const agentResult = await db
    .from("field_agents")
    .select("id, status, max_sim_capacity")
    .eq("organization_id", auth.orgId)
    .eq("id", agentId)
    .maybeSingle();
  if (agentResult.error) throw new Error(agentResult.error.message || "Unable to validate assigned agent.");
  if (!agentResult.data) return { error: "Assigned agent was not found." };
  const agent = row(agentResult.data);
  if (asString(agent.status) === "suspended") return { error: "Cannot assign imported SIMs to a suspended agent." };

  const capacity = agent.max_sim_capacity;
  if (capacity !== null && capacity !== undefined) {
    const inHand = await db
      .from("sim_units")
      .select("id")
      .eq("organization_id", auth.orgId)
      .eq("current_agent_id", agentId)
      .eq("status", "with_agent");
    if (inHand.error) throw new Error(inHand.error.message || "Unable to validate agent capacity.");
    if (rows(inHand.data).length + incomingCount > asNumber(capacity)) {
      return { error: "Import exceeds the agent SIM capacity." };
    }
  }

  return { error: null };
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
        user_metadata: { full_name: parsed.data.full_name },
      });
      if (created.error || !created.data.user) {
        return message(created.error?.message || "تعذر إنشاء الحساب.", 500);
      }
      const userId = created.data.user.id;

      // 2. Profile.
      const profileResult = await db
        .from("profiles")
        .upsert(
          {
            user_id: userId,
            org_id: auth.orgId,
            full_name: parsed.data.full_name,
            email,
            title: "مندوب ميداني",
            account_status: "active",
          },
          { onConflict: "user_id" }
        );
      if (profileResult.error) return message(profileResult.error.message, 500);

      // 3. Org membership with the field_agent role.
      const memberResult = await db
        .from("org_members")
        .upsert(
          {
            org_id: auth.orgId,
            user_id: userId,
            role: "field_agent",
          },
          { onConflict: "org_id,user_id" }
        );
      if (memberResult.error) return message(memberResult.error.message, 500);

      // 4. Field agent profile.
      const insertPayload: Record<string, unknown> = {
        organization_id: auth.orgId,
        user_id: userId,
        full_name: parsed.data.full_name,
        phone: parsed.data.phone,
        national_id: parsed.data.national_id,
        commission_rate: parsed.data.commission_rate,
        sim_price: parsed.data.sim_price,
        created_by: auth.user.id,
      };
      if (parsed.data.region) insertPayload.region = parsed.data.region;
      if (parsed.data.max_sim_capacity !== undefined) insertPayload.max_sim_capacity = parsed.data.max_sim_capacity;

      const result = await db.from("field_agents").insert(insertPayload).select("*").single();
      if (result.error) return message(result.error.message, 500);
      return json(row(result.data), 201);
    }

    return message("Method not allowed", 405);
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

    const payload = parsed.data.sims.map((sim) => ({
      organization_id: auth.orgId,
      iccid: sim.iccid,
      provider: sim.provider,
      sim_type: sim.sim_type,
      price: sim.price,
      status: "in_stock",
      added_by: auth.user.id,
    }));

    const result = await db.from("sim_units").insert(payload).select("id");
    if (result.error) return message(result.error.message, 500);

    const inserted = rows(result.data);
    for (const sim of inserted) {
      await insertTransfer(auth, {
        sim_unit_id: asString(sim.id),
        transfer_type: "initial_import",
      });
    }
    return json({ imported: inserted.length }, 201);
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

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData().catch(() => null);
      if (!form) return message("Multipart form data is required.", 400);
      const file = form.get("image");
      if (file instanceof File && file.size > 0) {
        if (!file.type.startsWith("image/")) return message("Only image files are supported.", 400);
        if (file.size > 10 * 1024 * 1024) return message("Image must be 10MB or smaller.", 400);
        try {
          imagePath = await uploadSimBoxImage(auth, file, Buffer.from(await file.arrayBuffer()));
        } catch (error) {
          return message(error, 500);
        }
      }
      imagePath = imagePath || formString(form, "image_path");
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

    const warnings = [...validation.warnings, ...rawNotes];
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

    let duplicates: string[] = [];
    try {
      duplicates = await duplicateKitCodes(auth, normalizedProvider, validation.kitCodes);
    } catch (error) {
      return message(error, 500);
    }
    if (duplicates.length > 0 && parsed.data.import_duplicate_strategy !== "skip") {
      return NextResponse.json(
        { message: "Duplicate kit codes found.", duplicates },
        { status: 409 }
      );
    }

    const nonDuplicateKitCodes = validation.kitCodes.filter((kitCode) => !duplicates.includes(kitCode));
    const assignedAgentId = asString(parsed.data.assigned_agent_id) || null;
    if (assignedAgentId) {
      try {
        const agentCheck = await validateAssignedAgent(auth, assignedAgentId, nonDuplicateKitCodes.length);
        if (agentCheck.error) return message(agentCheck.error, 400);
      } catch (error) {
        return message(error, 500);
      }
    }

    const generatedPreview = validation.kitCodes.map((kitCode, index) => ({
      sequence: index + 1,
      kit_code: kitCode,
      is_duplicate: duplicates.includes(kitCode),
    }));

    const now = new Date().toISOString();
    const batchResult = await db
      .from("sim_import_batches")
      .insert({
        organization_id: auth.orgId,
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
        generated_preview: generatedPreview,
        status: "confirmed",
        imported_count: nonDuplicateKitCodes.length,
        duplicate_count: duplicates.length,
        assigned_agent_id: assignedAgentId,
        created_by: auth.user.id,
        confirmed_by: auth.user.id,
        confirmed_at: now,
      })
      .select("*")
      .single();
    if (batchResult.error) return message(batchResult.error.message, 500);

    const batch = row(batchResult.data);
    const insertPayload = nonDuplicateKitCodes.map((kitCode) => ({
      organization_id: auth.orgId,
      iccid: kitCode,
      kit_code: kitCode,
      provider: normalizedProvider,
      sim_type: "prepaid",
      price: 0,
      status: assignedAgentId ? "with_agent" : "in_stock",
      current_agent_id: assignedAgentId,
      assigned_at: assignedAgentId ? now : null,
      current_merchant_id: null,
      import_batch_id: asString(batch.id),
      dealer_box_number: parsed.data.dealer_box_number ?? null,
      box_sequence: validation.kitCodes.indexOf(kitCode) + 1,
      import_source: "box_ocr",
      added_by: auth.user.id,
    }));

    let inserted: Record<string, unknown>[] = [];
    if (insertPayload.length > 0) {
      const simResult = await db.from("sim_units").insert(insertPayload).select("id");
      if (simResult.error) {
        const status = simResult.error.code === "23505" ? 409 : 500;
        return message(simResult.error.message, status);
      }
      inserted = rows(simResult.data);
    }

    for (const sim of inserted) {
      const simId = asString(sim.id);
      await insertTransfer(auth, {
        sim_unit_id: simId,
        transfer_type: "initial_import",
        notes: `SIM box import ${asString(batch.id)}`,
      });
      if (assignedAgentId) {
        await insertTransfer(auth, {
          sim_unit_id: simId,
          transfer_type: "assign_to_agent",
          to_agent_id: assignedAgentId,
          notes: `Direct assignment from SIM box import ${asString(batch.id)}`,
        });
      }
    }

    return json({
      batch,
      inserted_count: inserted.length,
      skipped_duplicates: duplicates,
      assigned_agent_id: assignedAgentId,
    }, 201);
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

    let agentId = "";
    let notes: string | null = null;
    let simIds: string[] = [];
    if (quantityParsed.success) {
      agentId = quantityParsed.data.agent_id;
      notes = quantityParsed.data.notes ?? null;
    } else if (parsed?.success) {
      agentId = parsed.data.agent_id;
      notes = parsed.data.notes ?? null;
      simIds = parsed.data.sim_ids;
    }

    // Confirm target agent belongs to the org.
    const agentResult = await db
      .from("field_agents")
      .select("id, status, max_sim_capacity")
      .eq("organization_id", auth.orgId)
      .eq("id", agentId)
      .maybeSingle();
    if (agentResult.error) return message(agentResult.error.message, 500);
    if (!agentResult.data) return message("Agent not found.", 404);
    if (asString(row(agentResult.data).status) === "suspended") {
      return message("Cannot assign SIMs to a suspended agent.", 400);
    }

    if (quantityParsed.success) {
      let availableQuery = db
        .from("sim_units")
        .select("id")
        .eq("organization_id", auth.orgId)
        .eq("status", "in_stock")
        .eq("provider", quantityParsed.data.provider)
        .order("created_at", { ascending: true })
        .limit(quantityParsed.data.quantity);
      if (quantityParsed.data.sim_type) {
        availableQuery = availableQuery.eq("sim_type", quantityParsed.data.sim_type);
      }
      const available = await availableQuery;
      if (available.error) return message(available.error.message, 500);
      const selected = rows(available.data);
      if (selected.length < quantityParsed.data.quantity) {
        return message("Not enough SIMs available in stock for this quantity.", 400);
      }
      simIds = selected.map((sim) => asString(sim.id));
    }

    // Confirm all SIMs are in stock and belong to the org.
    const simsResult = await db
      .from("sim_units")
      .select("id, status")
      .eq("organization_id", auth.orgId)
      .in("id", simIds);
    if (simsResult.error) return message(simsResult.error.message, 500);
    const found = rows(simsResult.data);
    if (found.length !== simIds.length) {
      return message("Some SIMs were not found.", 400);
    }
    if (found.some((sim) => asString(sim.status) !== "in_stock")) {
      return message("All SIMs must be in stock to assign.", 400);
    }

    // Enforce capacity if configured.
    const capacity = row(agentResult.data).max_sim_capacity;
    if (capacity !== null && capacity !== undefined) {
      const inHand = await db
        .from("sim_units")
        .select("id")
        .eq("organization_id", auth.orgId)
        .eq("current_agent_id", agentId)
        .eq("status", "with_agent");
      const current = rows(inHand.data).length;
      if (current + simIds.length > asNumber(capacity)) {
        return message("Assignment exceeds the agent SIM capacity.", 400);
      }
    }

    const update = await db
      .from("sim_units")
      .update({
        status: "with_agent",
        current_agent_id: agentId,
        assigned_at: new Date().toISOString(),
      })
      .eq("organization_id", auth.orgId)
      .in("id", simIds)
      .select("id");
    if (update.error) return message(update.error.message, 500);

    for (const simId of simIds) {
      await insertTransfer(auth, {
        sim_unit_id: simId,
        transfer_type: "assign_to_agent",
        to_agent_id: agentId,
        notes,
      });
    }
    return json({ assigned: simIds.length });
  }

  // POST /sims/sell  (agent or manager)
  if (action === "sell") {
    if (request.method !== "POST") return message("Method not allowed", 405);

    const body = await readBody(request);
    const parsed = recordSaleSchema.safeParse(body);
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
    if (asString(sim.status) !== "with_agent") {
      return message("Only SIMs held by an agent can be sold.", 400);
    }

    const sellingAgentId = asString(sim.current_agent_id);
    if (!auth.isManager) {
      const myAgentId = await resolveAgentId(auth);
      if (!myAgentId || myAgentId !== sellingAgentId) {
        return message("You can only sell SIMs assigned to you.", 403);
      }
    }

    const packageResult = await db
      .from("sim_packages")
      .select("*")
      .eq("organization_id", auth.orgId)
      .eq("id", parsed.data.package_id)
      .eq("status", "active")
      .maybeSingle();
    if (packageResult.error) return message(packageResult.error.message, 500);
    if (!packageResult.data) return message("Package not found.", 404);
    const simPackage = row(packageResult.data);
    if (asString(sim.provider || "virgin") !== asString(simPackage.provider || "virgin")) {
      return message("Package provider must match the SIM provider.", 400);
    }
    const salePrice = asNumber(simPackage.sale_price);
    const commissionType = asString(simPackage.agent_commission_type) || "percentage";
    const commissionValue = asNumber(simPackage.agent_commission_value);
    const commissionAmount = calculateCommission(commissionType, commissionValue, salePrice);

    const update = await db
      .from("sim_units")
      .update({
        status: "sold",
        sold_at: new Date().toISOString(),
        sold_by_agent_id: sellingAgentId,
        sold_price: salePrice,
        sold_package_id: parsed.data.package_id,
        sold_package_name: asString(simPackage.package_name),
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
      from_agent_id: sellingAgentId,
    });

    await db.from("agent_commissions").insert({
      organization_id: auth.orgId,
      agent_id: sellingAgentId,
      sim_unit_id: parsed.data.sim_unit_id,
      sim_package_id: parsed.data.package_id,
      sale_price: salePrice,
      commission_type: commissionType,
      commission_rate: commissionValue,
      commission_amount: commissionAmount,
    });

    await db.from("sim_sales").insert({
      organization_id: auth.orgId,
      sim_unit_id: parsed.data.sim_unit_id,
      package_id: parsed.data.package_id,
      seller_type: "agent",
      agent_id: sellingAgentId,
      merchant_id: null,
      sale_price: salePrice,
      customer_name: parsed.data.customer_name ?? null,
      agent_commission_type: commissionType,
      agent_commission_value: commissionValue,
      agent_commission_amount: commissionAmount,
      created_by: auth.user.id,
    });

    return json(row(update.data));
  }

  // POST /sims/return  (agent or manager)
  if (action === "return") {
    if (request.method !== "POST") return message("Method not allowed", 405);

    const body = await readBody(request);
    const parsed = returnSimSchema.safeParse(body);
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
    if (asString(sim.status) !== "with_agent") {
      return message("Only SIMs held by an agent can be returned.", 400);
    }

    const holdingAgentId = asString(sim.current_agent_id);
    if (!auth.isManager) {
      const myAgentId = await resolveAgentId(auth);
      if (!myAgentId || myAgentId !== holdingAgentId) {
        return message("You can only return SIMs assigned to you.", 403);
      }
    }

    const update = await db
      .from("sim_units")
      .update({
        status: "in_stock",
        current_agent_id: null,
        assigned_at: null,
      })
      .eq("organization_id", auth.orgId)
      .eq("id", parsed.data.sim_unit_id)
      .select("*")
      .single();
    if (update.error) return message(update.error.message, 500);

    await insertTransfer(auth, {
      sim_unit_id: parsed.data.sim_unit_id,
      transfer_type: "return_to_stock",
      from_agent_id: holdingAgentId,
      notes: parsed.data.notes ?? null,
    });

    return json(row(update.data));
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

  const result = await database(auth.admin)
    .from("agent_cash_collections")
    .insert({
      ...parsed.data,
      organization_id: auth.orgId,
      collected_by: auth.user.id,
    })
    .select("*")
    .single();
  if (result.error) return message(result.error.message, 500);
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
    if (!auth.isManager) return message("Field agent manager access is required.", 403);

    const result = await db
      .from("agent_commissions")
      .update({
        is_paid: true,
        paid_at: new Date().toISOString(),
        paid_by: auth.user.id,
      })
      .eq("organization_id", auth.orgId)
      .eq("id", commissionId)
      .select("*")
      .single();
    if (result.error) return message(result.error.message, 500);
    return json(row(result.data));
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
  const segments = segmentsOf(context);
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
  const auth = await requireFieldAgentAccess();
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
