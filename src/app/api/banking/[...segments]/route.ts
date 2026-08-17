import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAccountingAccess } from "@/lib/accounting/permissions";
import {
  normalizeBankStatementEditInput,
  normalizeBankStatementReason,
} from "@/lib/banking/statement-actions";

type RouteContext = { params: Promise<{ segments?: string[] }> };

function db(admin: ReturnType<typeof createAdminClient>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return admin as any;
}

function json(data: unknown, status = 200) {
  return NextResponse.json({ data }, { status });
}

function errorResponse(error: unknown, status = 500) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code || "") : "";
  const resolvedStatus = status !== 500 ? status
    : code === "42501" ? 403
      : code === "P0002" || code === "PGRST116" ? 404
        : ["23505", "40001", "55000"].includes(code) ? 409
          : ["22007", "22023", "22P02", "23514"].includes(code) ? 400 : 500;
  return NextResponse.json(
    { message: error instanceof Error ? error.message : String(error || "حدث خطأ غير متوقع.") },
    { status: resolvedStatus }
  );
}

function databaseError(error: { message: string; code?: string }) {
  return Object.assign(new Error(error.message), { code: error.code });
}

async function segments(context: RouteContext) {
  return (await context.params).segments || [];
}

function requireText(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value.trim() || fallback;
  return fallback;
}

function uuidOrNull(value: unknown) {
  const valueText = String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(valueText)
    ? valueText
    : null;
}

function commandContext(request: NextRequest, body: Record<string, unknown>) {
  return {
    commandId: uuidOrNull(body.command_id) || uuidOrNull(request.headers.get("idempotency-key")) || randomUUID(),
    requestId: uuidOrNull(body.request_id) || uuidOrNull(request.headers.get("x-request-id")) || randomUUID(),
  };
}

async function executeStatementCommand(
  admin: ReturnType<typeof createAdminClient>,
  auth: { orgId: string; user: { id: string } },
  request: NextRequest,
  statementId: string,
  expectedVersion: number,
  action: "edit" | "recall" | "cancel",
  payload: Record<string, unknown>,
  body: Record<string, unknown>,
) {
  const command = commandContext(request, body);
  const { data, error } = await db(admin).rpc("execute_banking_statement_command", {
    p_org_id: auth.orgId,
    p_actor_user_id: auth.user.id,
    p_request_id: command.requestId,
    p_command_id: command.commandId,
    p_statement_id: statementId,
    p_expected_version: expectedVersion,
    p_action: action,
    p_payload: payload,
  });
  if (error) throw databaseError(error);
  if (!data || typeof data !== "object") throw new Error("Bank statement command returned no result.");
  return data as Record<string, unknown>;
}

async function addLineActivity(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  rows: Array<Record<string, unknown>>,
) {
  const ids = rows.map((row) => String(row.id || "")).filter(Boolean);
  if (ids.length === 0) return rows;
  const { data, error } = await db(admin)
    .from("banking_statement_lines")
    .select("statement_id")
    .eq("organization_id", orgId)
    .in("statement_id", ids)
    .neq("match_status", "unmatched");
  if (error) throw databaseError(error);
  const activeIds = new Set((data || []).map((line: Record<string, unknown>) => String(line.statement_id)));
  return rows.map((row) => ({ ...row, has_line_activity: activeIds.has(String(row.id)) }));
}

async function getStatementLinkedAccount(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  statementId: string,
) {
  const { data, error } = await db(admin)
    .from("banking_statements")
    .select("id, status, bank_account:bank_account_id!inner(linked_account_id, is_active)")
    .eq("id", statementId)
    .eq("organization_id", orgId)
    .in("status", ["imported", "in_progress"])
    .maybeSingle();
  if (error) throw databaseError(error);
  const relation = data?.bank_account;
  const bankAccount = Array.isArray(relation) ? relation[0] : relation;
  const linkedAccountId = requireText(bankAccount?.linked_account_id);
  if (!data) {
    throw Object.assign(new Error("لم يتم العثور على الكشف أو أنه ليس في حالة تسمح بالمطابقة."), { code: "23514" });
  }
  if (bankAccount?.is_active !== true) {
    throw Object.assign(new Error("الحساب البنكي المرتبط بهذا الكشف غير مفعل. فعّل الحساب من البنوك ← الحسابات البنكية."), { code: "23514" });
  }
  if (!linkedAccountId) {
    throw Object.assign(new Error("الحساب البنكي غير مرتبط بحساب في دليل الحسابات. اذهب إلى البنوك ← الحسابات البنكية ← عدّل الحساب واختر حسابًا من نوع نقدية/بنك في حقل «الحساب المرتبط». إذا لم يكن موجودًا، أنشئ حسابًا جديدًا بنوع أصول وتصنيف فرعي نقدية وبنك من دليل الحسابات أولًا."), { code: "23514" });
  }
  return linkedAccountId;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const parts = await segments(context);
  const auth = await requireAccountingAccess("view", request);
  if ("error" in auth) return auth.error;
  const admin = createAdminClient();

  try {
    if (parts[0] === "accounts") {
      if (parts[1]) {
        const { data, error } = await db(admin)
          .from("banking_accounts")
          .select("*")
          .eq("organization_id", auth.orgId)
          .eq("id", parts[1])
          .single();
        if (error) throw new Error(error.message);
        return json(data);
      }
      const { data, error } = await db(admin)
        .from("banking_accounts")
        .select("*, linked_account:linked_account_id(id, code, name_ar)")
        .eq("organization_id", auth.orgId)
        .order("bank_name", { ascending: true });
      if (error) throw new Error(error.message);
      return json(data || []);
    }

    if (parts[0] === "statements") {
      if (parts[1] && parts[2] === "lines") {
        const { data: parent, error: parentError } = await db(admin)
          .from("banking_statements")
          .select("id")
          .eq("organization_id", auth.orgId)
          .eq("id", parts[1])
          .neq("status", "cancelled")
          .maybeSingle();
        if (parentError) throw databaseError(parentError);
        if (!parent) return errorResponse("Bank statement not found.", 404);
        const { data, error } = await db(admin)
          .from("banking_statement_lines")
          .select("*")
          .eq("organization_id", auth.orgId)
          .eq("statement_id", parts[1])
          .order("transaction_date", { ascending: true });
        if (error) throw databaseError(error);
        return json(data || []);
      }
      if (parts[1]) {
        const { data, error } = await db(admin)
          .from("banking_statements")
          .select("*, bank_account:bank_account_id(id, name_ar, bank_name, account_number)")
          .eq("organization_id", auth.orgId)
          .eq("id", parts[1])
          .neq("status", "cancelled")
          .single();
        if (error) throw databaseError(error);
        const [decorated] = await addLineActivity(admin, auth.orgId, [data]);
        return json(decorated);
      }
      const bankAccountId = request.nextUrl.searchParams.get("bank_account_id");
      let query = db(admin)
        .from("banking_statements")
        .select("*, bank_account:bank_account_id(id, name_ar, bank_name)")
        .eq("organization_id", auth.orgId)
        .neq("status", "cancelled")
        .order("statement_date", { ascending: false });
      if (bankAccountId) query = query.eq("bank_account_id", bankAccountId);
      const { data, error } = await query;
      if (error) throw databaseError(error);
      return json(await addLineActivity(admin, auth.orgId, data || []));
    }

    if (parts[0] === "reconciliations") {
      if (parts[1]) {
        const { data, error } = await db(admin)
          .from("banking_reconciliations")
          .select("*, bank_account:bank_account_id(id, name_ar, bank_name, account_number)")
          .eq("organization_id", auth.orgId)
          .eq("id", parts[1])
          .single();
        if (error) throw new Error(error.message);
        return json(data);
      }
      const { data, error } = await db(admin)
        .from("banking_reconciliations")
        .select("*, bank_account:bank_account_id(id, name_ar, bank_name)")
        .eq("organization_id", auth.orgId)
        .order("reconciliation_date", { ascending: false });
      if (error) throw new Error(error.message);
      return json(data || []);
    }

    if (parts[0] === "match-suggestions") {
      const statementLineId = request.nextUrl.searchParams.get("line_id");
      if (!statementLineId) return errorResponse("line_id is required.", 400);

      const { data: line } = await db(admin)
        .from("banking_statement_lines")
        .select("statement_id, amount, transaction_date, description, reference")
        .eq("id", statementLineId)
        .eq("organization_id", auth.orgId)
        .single();
      if (!line) return errorResponse("Statement line not found.", 404);
      const linkedAccountId = await getStatementLinkedAccount(admin, auth.orgId, line.statement_id);

      const amount = Math.abs(Number(line.amount));
      const dateFrom = new Date(line.transaction_date);
      dateFrom.setDate(dateFrom.getDate() - 5);
      const dateTo = new Date(line.transaction_date);
      dateTo.setDate(dateTo.getDate() + 5);

      const { data: candidates } = await db(admin)
        .from("accounting_journal_lines")
        .select("id, debit, credit, description, journal_entry_id, account:account_id(code, name_ar), journal_entry:journal_entry_id!inner(status)")
        .eq("organization_id", auth.orgId)
        .eq("account_id", linkedAccountId)
        .eq("journal_entry.status", "posted")
        .or(`debit.eq.${amount},credit.eq.${amount}`)
        .limit(20);

      return json(candidates || []);
    }

    return errorResponse("Unknown banking endpoint.", 404);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const parts = await segments(context);
  if (parts[0] !== "statements" || !parts[1] || parts.length !== 2) {
    return errorResponse("Unknown banking endpoint.", 404);
  }
  const auth = await requireAccountingAccess("manage", request);
  if ("error" in auth) return auth.error;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const expectedVersion = Number(body.expected_version);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
    return errorResponse("expected_version is required.", 400);
  }
  const normalized = normalizeBankStatementEditInput(body);
  if (!normalized.ok) return errorResponse(normalized.error, 400);

  try {
    const result = await executeStatementCommand(
      createAdminClient(), auth, request, parts[1], expectedVersion,
      "edit", normalized.value, body,
    );
    return json(result);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const parts = await segments(context);
  if (parts[0] !== "statements" || !parts[1] || parts.length !== 2) {
    return errorResponse("Unknown banking endpoint.", 404);
  }
  const auth = await requireAccountingAccess("manage", request);
  if ("error" in auth) return auth.error;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const expectedVersion = Number(body.expected_version);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
    return errorResponse("expected_version is required.", 400);
  }
  const reason = normalizeBankStatementReason(body.reason, true);
  if (!reason.ok) return errorResponse(reason.error.replace("الاسترجاع", "الإلغاء"), 400);

  try {
    const result = await executeStatementCommand(
      createAdminClient(), auth, request, parts[1], expectedVersion,
      "cancel", { reason: reason.value }, body,
    );
    return json(result);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const parts = await segments(context);
  const isStatementRecall = parts[0] === "statements" && Boolean(parts[1]) && parts[2] === "recall";
  const auth = await requireAccountingAccess(isStatementRecall ? "post" : "manage", request);
  if ("error" in auth) return auth.error;
  const admin = createAdminClient();
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;

  try {
    if (isStatementRecall) {
      const expectedVersion = Number(body.expected_version);
      if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
        return errorResponse("expected_version is required.", 400);
      }
      const reason = normalizeBankStatementReason(body.reason, true);
      if (!reason.ok) return errorResponse(reason.error, 400);
      return json(await executeStatementCommand(
        admin, auth, request, parts[1], expectedVersion,
        "recall", { reason: reason.value }, body,
      ));
    }

    // Statement approve
    if (parts[0] === "statements" && parts[1] && parts[2] === "approve") {
      const { error } = await db(admin)
        .from("banking_statements")
        .update({ status: "approved", approved_by: auth.user.id, approved_at: new Date().toISOString() })
        .eq("id", parts[1])
        .eq("organization_id", auth.orgId)
        .in("status", ["in_progress", "imported"]);
      if (error) throw databaseError(error);
      return json({ ok: true });
    }

    // Statement submit (imported → in_progress)
    if (parts[0] === "statements" && parts[1] && parts[2] === "submit") {
      const { error } = await db(admin)
        .from("banking_statements")
        .update({ status: "in_progress", updated_by: auth.user.id, updated_at: new Date().toISOString() })
        .eq("id", parts[1])
        .eq("organization_id", auth.orgId)
        .eq("status", "imported");
      if (error) throw databaseError(error);
      return json({ ok: true });
    }

    // Statement archive
    if (parts[0] === "statements" && parts[1] && parts[2] === "archive") {
      const { error } = await db(admin)
        .from("banking_statements")
        .update({ status: "archived", archived_at: new Date().toISOString() })
        .eq("id", parts[1])
        .eq("organization_id", auth.orgId)
        .eq("status", "approved");
      if (error) throw databaseError(error);
      return json({ ok: true });
    }

    // Bank Accounts CRUD
    if (parts[0] === "accounts") {
      if (parts[1] && parts[2] === "deactivate") {
        const { error } = await db(admin)
          .from("banking_accounts")
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq("id", parts[1])
          .eq("organization_id", auth.orgId);
        if (error) throw new Error(error.message);
        return json({ ok: true });
      }
      const linkedAccountId = requireText(body.linked_account_id) || null;
      if (linkedAccountId) {
        const { data: linkedAccount, error: linkedAccountError } = await db(admin)
          .from("accounting_accounts")
          .select("id")
          .eq("id", linkedAccountId)
          .eq("organization_id", auth.orgId)
          .eq("is_active", true)
          .maybeSingle();
        if (linkedAccountError) throw databaseError(linkedAccountError);
        if (!linkedAccount) return errorResponse("The linked ledger account must be active and belong to the organization.", 400);
      }
      const payload = {
        organization_id: auth.orgId,
        name_ar: requireText(body.name_ar),
        name_en: requireText(body.name_en) || null,
        bank_name: requireText(body.bank_name),
        account_number: requireText(body.account_number),
        iban: requireText(body.iban) || null,
        swift_code: requireText(body.swift_code) || null,
        currency: requireText(body.currency) || "SAR",
        linked_account_id: linkedAccountId,
        opening_balance: Number(body.opening_balance || 0),
        opening_balance_date: requireText(body.opening_balance_date) || null,
        is_active: body.is_active !== false,
        created_by: auth.user.id,
      };
      if (parts[1]) {
        const { data, error } = await db(admin)
          .from("banking_accounts")
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq("id", parts[1])
          .eq("organization_id", auth.orgId)
          .select()
          .single();
        if (error) throw new Error(error.message);
        return json(data);
      }
      const { data, error } = await db(admin)
        .from("banking_accounts")
        .insert(payload)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return json(data, 201);
    }

    // Statement Import
    if (parts[0] === "statements" && parts[1] === "import") {
      const bankAccountId = requireText(body.bank_account_id);
      const lines = Array.isArray(body.lines) ? body.lines as Array<Record<string, unknown>> : [];
      if (!bankAccountId || lines.length === 0) return errorResponse("bank_account_id and lines are required.", 400);

      const { data: bankAccount, error: bankAccountError } = await db(admin)
        .from("banking_accounts")
        .select("id")
        .eq("id", bankAccountId)
        .eq("organization_id", auth.orgId)
        .eq("is_active", true)
        .maybeSingle();
      if (bankAccountError) throw databaseError(bankAccountError);
      if (!bankAccount) return errorResponse("The bank account must be active and belong to the organization.", 400);

      const statementDate = requireText(body.statement_date) || new Date().toISOString().slice(0, 10);
      const periodStart = requireText(body.period_start) || statementDate;
      const periodEnd = requireText(body.period_end) || statementDate;

      const { data: stmt, error: stmtErr } = await db(admin)
        .from("banking_statements")
        .insert({
          organization_id: auth.orgId,
          bank_account_id: bankAccountId,
          statement_date: statementDate,
          period_start: periodStart,
          period_end: periodEnd,
          opening_balance: Number(body.opening_balance || 0),
          closing_balance: Number(body.closing_balance || 0),
          file_name: requireText(body.file_name) || null,
          file_path: requireText(body.file_path) || null,
          import_format: requireText(body.import_format) || "csv",
          imported_by: auth.user.id,
          transaction_count: lines.length,
        })
        .select()
        .single();
      if (stmtErr) throw databaseError(stmtErr);

      const lineRows = lines.map((line) => ({
        organization_id: auth.orgId,
        statement_id: stmt.id,
        transaction_date: requireText(line.transaction_date) || statementDate,
        value_date: requireText(line.value_date) || null,
        description: requireText(line.description) || "—",
        reference: requireText(line.reference) || null,
        amount: Number(line.amount || 0),
        running_balance: line.running_balance != null ? Number(line.running_balance) : null,
        transaction_type: requireText(line.transaction_type) || null,
        payee: requireText(line.payee) || null,
      }));

      const { error: linesErr } = await db(admin)
        .from("banking_statement_lines")
        .insert(lineRows);
      if (linesErr) throw databaseError(linesErr);

      return json(stmt, 201);
    }

    // Manual match
    if (parts[0] === "statements" && parts[1] && parts[2] === "match") {
      const lineId = requireText(body.line_id);
      const journalLineId = requireText(body.journal_line_id);
      if (!lineId || !journalLineId) return errorResponse("line_id and journal_line_id are required.", 400);
      const linkedAccountId = await getStatementLinkedAccount(admin, auth.orgId, parts[1]);
      const { data: journalLine, error: journalLineError } = await db(admin)
        .from("accounting_journal_lines")
        .select("id, journal_entry:journal_entry_id!inner(status)")
        .eq("id", journalLineId)
        .eq("organization_id", auth.orgId)
        .eq("account_id", linkedAccountId)
        .eq("journal_entry.status", "posted")
        .maybeSingle();
      if (journalLineError) throw databaseError(journalLineError);
      if (!journalLine) return errorResponse("Choose a posted journal line for the linked bank ledger account.", 400);

      const { data: matchedLine, error } = await db(admin)
        .from("banking_statement_lines")
        .update({
          match_status: "manually_matched",
          matched_journal_line_id: journalLineId,
          matched_at: new Date().toISOString(),
          matched_by: auth.user.id,
          match_confidence: 1.0,
        })
        .eq("id", lineId)
        .eq("organization_id", auth.orgId)
        .eq("statement_id", parts[1])
        .select("id")
        .maybeSingle();
      if (error) throw databaseError(error);
      if (!matchedLine) return errorResponse("Statement line not found.", 404);

      return json({ ok: true });
    }

    // Unmatch
    if (parts[0] === "statements" && parts[1] && parts[2] === "unmatch") {
      const lineId = requireText(body.line_id);
      if (!lineId) return errorResponse("line_id is required.", 400);
      const { data: unmatchedLine, error } = await db(admin)
        .from("banking_statement_lines")
        .update({ match_status: "unmatched", matched_journal_line_id: null, matched_at: null, matched_by: null, match_confidence: null })
        .eq("id", lineId)
        .eq("organization_id", auth.orgId)
        .eq("statement_id", parts[1])
        .select("id")
        .maybeSingle();
      if (error) throw databaseError(error);
      if (!unmatchedLine) return errorResponse("Statement line not found.", 404);
      return json({ ok: true });
    }

    // Exclude line
    if (parts[0] === "statements" && parts[1] && parts[2] === "exclude") {
      const lineId = requireText(body.line_id);
      if (!lineId) return errorResponse("line_id is required.", 400);
      const { data: excludedLine, error } = await db(admin)
        .from("banking_statement_lines")
        .update({
          match_status: "excluded",
          matched_journal_line_id: null,
          matched_at: null,
          matched_by: null,
          match_confidence: null,
          notes: requireText(body.notes) || null,
        })
        .eq("id", lineId)
        .eq("organization_id", auth.orgId)
        .eq("statement_id", parts[1])
        .select("id")
        .maybeSingle();
      if (error) throw databaseError(error);
      if (!excludedLine) return errorResponse("Statement line not found.", 404);
      return json({ ok: true });
    }

    // Auto-match statement
    if (parts[0] === "statements" && parts[1] && parts[2] === "auto-match") {
      const linkedAccountId = await getStatementLinkedAccount(admin, auth.orgId, parts[1]);
      const [{ data: unmatchedLines }, { data: existingMatches, error: existingMatchesError }] = await Promise.all([
        db(admin)
        .from("banking_statement_lines")
        .select("id, amount, transaction_date, description, reference")
        .eq("statement_id", parts[1])
        .eq("organization_id", auth.orgId)
        .eq("match_status", "unmatched"),
        db(admin)
          .from("banking_statement_lines")
          .select("matched_journal_line_id")
          .eq("organization_id", auth.orgId)
          .not("matched_journal_line_id", "is", null),
      ]);
      if (existingMatchesError) throw databaseError(existingMatchesError);

      if (!unmatchedLines?.length) return json({ matched: 0, unmatched: 0 });

      let matchedCount = 0;
      const usedJournalLineIds = new Set(
        (existingMatches || []).map((line: Record<string, unknown>) => String(line.matched_journal_line_id)),
      );
      for (const line of unmatchedLines) {
        const amt = Math.abs(Number(line.amount));
        const txDate = String(line.transaction_date || "");
        const { data: candidates } = await db(admin)
          .from("accounting_journal_lines")
          .select("id, debit, credit, description, journal_entry:journal_entry_id!inner(status, entry_date)")
          .eq("organization_id", auth.orgId)
          .eq("account_id", linkedAccountId)
          .eq("journal_entry.status", "posted")
          .or(`debit.eq.${amt},credit.eq.${amt}`)
          .limit(10);

        const availableCandidates = (candidates || []).filter(
          (candidate: Record<string, unknown>) => !usedJournalLineIds.has(String(candidate.id)),
        );

        let bestMatch: Record<string, unknown> | null = null;
        if (availableCandidates.length === 1) {
          bestMatch = availableCandidates[0];
        } else if (availableCandidates.length > 1 && txDate) {
          const withinWindow = availableCandidates.filter((c: Record<string, unknown>) => {
            const entryDate = String((c.journal_entry as Record<string, unknown>)?.entry_date || "");
            if (!entryDate) return false;
            const diff = Math.abs(Date.parse(entryDate) - Date.parse(txDate));
            return diff <= 3 * 86_400_000;
          });
          if (withinWindow.length === 1) bestMatch = withinWindow[0];
        }

        if (bestMatch) {
          const { error: matchError } = await db(admin)
            .from("banking_statement_lines")
            .update({
              match_status: "matched",
              matched_journal_line_id: bestMatch.id,
              matched_at: new Date().toISOString(),
              matched_by: auth.user.id,
              match_confidence: availableCandidates.length === 1 ? 0.9 : 0.75,
            })
            .eq("id", line.id)
            .eq("organization_id", auth.orgId)
            .eq("statement_id", parts[1]);
          if (matchError) throw databaseError(matchError);
          usedJournalLineIds.add(String(bestMatch.id));
          matchedCount++;
        }
      }

      if (matchedCount > 0) {
        await db(admin)
          .from("banking_statements")
          .update({ status: "in_progress", updated_at: new Date().toISOString(), updated_by: auth.user.id })
          .eq("id", parts[1])
          .eq("organization_id", auth.orgId)
          .eq("status", "imported");
      }

      return json({ matched: matchedCount, unmatched: unmatchedLines.length - matchedCount });
    }

    // Reconciliations
    if (parts[0] === "reconciliations") {
      if (parts[1] && parts[2] === "complete") {
        const { error } = await db(admin)
          .from("banking_reconciliations")
          .update({ status: "completed", completed_at: new Date().toISOString(), completed_by: auth.user.id })
          .eq("id", parts[1])
          .eq("organization_id", auth.orgId);
        if (error) throw new Error(error.message);
        return json({ ok: true });
      }
      if (parts[1] && parts[2] === "approve") {
        const { error } = await db(admin)
          .from("banking_reconciliations")
          .update({ status: "approved", approved_at: new Date().toISOString(), approved_by: auth.user.id })
          .eq("id", parts[1])
          .eq("organization_id", auth.orgId);
        if (error) throw new Error(error.message);
        return json({ ok: true });
      }
      const payload = {
        organization_id: auth.orgId,
        bank_account_id: requireText(body.bank_account_id),
        statement_id: requireText(body.statement_id) || null,
        reconciliation_date: requireText(body.reconciliation_date) || new Date().toISOString().slice(0, 10),
        statement_balance: Number(body.statement_balance || 0),
        ledger_balance: Number(body.ledger_balance || 0),
        difference: Number(body.statement_balance || 0) - Number(body.ledger_balance || 0),
        notes: requireText(body.notes) || null,
      };
      if (parts[1]) {
        const { data, error } = await db(admin)
          .from("banking_reconciliations")
          .update(payload)
          .eq("id", parts[1])
          .eq("organization_id", auth.orgId)
          .select()
          .single();
        if (error) throw new Error(error.message);
        return json(data);
      }
      const { data, error } = await db(admin)
        .from("banking_reconciliations")
        .insert(payload)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return json(data, 201);
    }

    return errorResponse("Unknown banking endpoint.", 404);
  } catch (err) {
    return errorResponse(err);
  }
}
