import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAccountingAccess } from "@/lib/accounting/permissions";

type RouteContext = { params: Promise<{ segments?: string[] }> };

function db(admin: ReturnType<typeof createAdminClient>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return admin as any;
}

function json(data: unknown, status = 200) {
  return NextResponse.json({ data }, { status });
}

function errorResponse(error: unknown, status = 500) {
  return NextResponse.json(
    { message: error instanceof Error ? error.message : String(error || "حدث خطأ غير متوقع.") },
    { status }
  );
}

async function segments(context: RouteContext) {
  return (await context.params).segments || [];
}

function requireText(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value.trim() || fallback;
  return fallback;
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
        const { data, error } = await db(admin)
          .from("banking_statement_lines")
          .select("*")
          .eq("organization_id", auth.orgId)
          .eq("statement_id", parts[1])
          .order("transaction_date", { ascending: true });
        if (error) throw new Error(error.message);
        return json(data || []);
      }
      if (parts[1]) {
        const { data, error } = await db(admin)
          .from("banking_statements")
          .select("*, bank_account:bank_account_id(id, name_ar, bank_name, account_number)")
          .eq("organization_id", auth.orgId)
          .eq("id", parts[1])
          .single();
        if (error) throw new Error(error.message);
        return json(data);
      }
      const bankAccountId = request.nextUrl.searchParams.get("bank_account_id");
      let query = db(admin)
        .from("banking_statements")
        .select("*, bank_account:bank_account_id(id, name_ar, bank_name)")
        .eq("organization_id", auth.orgId)
        .order("statement_date", { ascending: false });
      if (bankAccountId) query = query.eq("bank_account_id", bankAccountId);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return json(data || []);
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
        .select("amount, transaction_date, description, reference")
        .eq("id", statementLineId)
        .eq("organization_id", auth.orgId)
        .single();
      if (!line) return errorResponse("Statement line not found.", 404);

      const amount = Math.abs(Number(line.amount));
      const dateFrom = new Date(line.transaction_date);
      dateFrom.setDate(dateFrom.getDate() - 5);
      const dateTo = new Date(line.transaction_date);
      dateTo.setDate(dateTo.getDate() + 5);

      const { data: candidates } = await db(admin)
        .from("accounting_journal_lines")
        .select("id, debit, credit, description, journal_entry_id, account:account_id(code, name_ar)")
        .eq("organization_id", auth.orgId)
        .or(`debit.eq.${amount},credit.eq.${amount}`)
        .limit(20);

      return json(candidates || []);
    }

    return errorResponse("Unknown banking endpoint.", 404);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const parts = await segments(context);
  const auth = await requireAccountingAccess("manage", request);
  if ("error" in auth) return auth.error;
  const admin = createAdminClient();
  const body = await request.json().catch(() => ({}));

  try {
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
      const payload = {
        organization_id: auth.orgId,
        name_ar: requireText(body.name_ar),
        name_en: requireText(body.name_en) || null,
        bank_name: requireText(body.bank_name),
        account_number: requireText(body.account_number),
        iban: requireText(body.iban) || null,
        swift_code: requireText(body.swift_code) || null,
        currency: requireText(body.currency) || "SAR",
        linked_account_id: requireText(body.linked_account_id) || null,
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
      if (stmtErr) throw new Error(stmtErr.message);

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
      if (linesErr) throw new Error(linesErr.message);

      return json(stmt, 201);
    }

    // Manual match
    if (parts[0] === "statements" && parts[1] && parts[2] === "match") {
      const lineId = requireText(body.line_id);
      const journalLineId = requireText(body.journal_line_id);
      if (!lineId || !journalLineId) return errorResponse("line_id and journal_line_id are required.", 400);

      const { error } = await db(admin)
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
        .eq("statement_id", parts[1]);
      if (error) throw new Error(error.message);

      // Update statement matched count
      const { data: countData } = await db(admin)
        .from("banking_statement_lines")
        .select("id", { count: "exact" })
        .eq("statement_id", parts[1])
        .eq("organization_id", auth.orgId)
        .in("match_status", ["matched", "manually_matched"]);
      await db(admin)
        .from("banking_statements")
        .update({ matched_count: countData?.length || 0, status: "in_progress" })
        .eq("id", parts[1])
        .eq("organization_id", auth.orgId);

      return json({ ok: true });
    }

    // Unmatch
    if (parts[0] === "statements" && parts[1] && parts[2] === "unmatch") {
      const lineId = requireText(body.line_id);
      if (!lineId) return errorResponse("line_id is required.", 400);
      const { error } = await db(admin)
        .from("banking_statement_lines")
        .update({ match_status: "unmatched", matched_journal_line_id: null, matched_at: null, matched_by: null, match_confidence: null })
        .eq("id", lineId)
        .eq("organization_id", auth.orgId);
      if (error) throw new Error(error.message);
      return json({ ok: true });
    }

    // Exclude line
    if (parts[0] === "statements" && parts[1] && parts[2] === "exclude") {
      const lineId = requireText(body.line_id);
      if (!lineId) return errorResponse("line_id is required.", 400);
      const { error } = await db(admin)
        .from("banking_statement_lines")
        .update({ match_status: "excluded", notes: requireText(body.notes) || null })
        .eq("id", lineId)
        .eq("organization_id", auth.orgId);
      if (error) throw new Error(error.message);
      return json({ ok: true });
    }

    // Auto-match statement
    if (parts[0] === "statements" && parts[1] && parts[2] === "auto-match") {
      const { data: unmatchedLines } = await db(admin)
        .from("banking_statement_lines")
        .select("id, amount, transaction_date, description, reference")
        .eq("statement_id", parts[1])
        .eq("organization_id", auth.orgId)
        .eq("match_status", "unmatched");

      if (!unmatchedLines?.length) return json({ matched: 0, unmatched: 0 });

      let matchedCount = 0;
      for (const line of unmatchedLines) {
        const amt = Math.abs(Number(line.amount));
        const { data: candidates } = await db(admin)
          .from("accounting_journal_lines")
          .select("id, debit, credit, description")
          .eq("organization_id", auth.orgId)
          .or(`debit.eq.${amt},credit.eq.${amt}`)
          .limit(5);

        if (candidates && candidates.length === 1) {
          await db(admin)
            .from("banking_statement_lines")
            .update({
              match_status: "matched",
              matched_journal_line_id: candidates[0].id,
              matched_at: new Date().toISOString(),
              matched_by: auth.user.id,
              match_confidence: 0.85,
            })
            .eq("id", line.id)
            .eq("organization_id", auth.orgId);
          matchedCount++;
        }
      }

      await db(admin)
        .from("banking_statements")
        .update({ matched_count: matchedCount, status: "in_progress" })
        .eq("id", parts[1])
        .eq("organization_id", auth.orgId);

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
