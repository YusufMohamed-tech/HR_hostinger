import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContext } from "@/lib/server/tenant-context";
import type { TenantAuthContext } from "@/lib/server/tenant-context";
import { inspectUpload, removeUploadedPaths, UploadSecurityError } from "@/lib/server/upload-security";

const allowedAttachmentTypes = new Set([
  "image/jpeg", "image/png", "image/gif", "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/plain",
]);
const maxAttachmentBytes = 10 * 1024 * 1024;

type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
};
type RecordMap = Record<string, unknown>;

function safeFilename(name: string) {
  return name.replace(/[^\w.\-()[\]\u0600-\u06FF ]+/g, "_").slice(0, 160) || "attachment";
}

function parseJsonArray(value: FormDataEntryValue | null) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

async function signAttachments(auth: TenantAuthContext, attachments: RecordMap[]) {
  return Promise.all(attachments.map(async (attachment) => {
    const path = String(attachment.path || "");
    if (!path || attachment.scan_status !== "clean") return { ...attachment, url: "" };
    const signed = await auth.admin.storage.from("chat-attachments").createSignedUrl(path, 3600);
    return { ...attachment, bucket: "chat-attachments", url: signed.data?.signedUrl || "" };
  }));
}

async function getOrgUsers(auth: TenantAuthContext) {
  const [members, profiles, employees] = await Promise.all([
    auth.admin.from("org_members").select("org_id, user_id, role").eq("org_id", auth.orgId).limit(500),
    auth.admin.from("profiles").select("org_id, user_id, full_name, email, title, account_status").eq("org_id", auth.orgId).limit(500),
    auth.admin.from("employees").select("org_id, id, user_id, full_name, employee_code, job_title, status").eq("org_id", auth.orgId).limit(500),
  ]);
  for (const result of [members, profiles, employees]) if (result.error) throw new Error(result.error.message);
  const profileMap = new Map((profiles.data || []).map((row) => [String(row.user_id), row as RecordMap]));
  const employeeMap = new Map((employees.data || []).map((row) => [String(row.user_id), row as RecordMap]));
  return (members.data || []).map((member) => {
    const profile = profileMap.get(String(member.user_id)) || {};
    const employee = employeeMap.get(String(member.user_id)) || {};
    return {
      org_id: auth.orgId, user_id: String(member.user_id), employee_id: String(employee.id || ""), role: String(member.role),
      full_name: String(employee.full_name || profile.full_name || profile.email || "مستخدم"), email: String(profile.email || ""),
      title: String(employee.job_title || profile.title || ""), employee_code: String(employee.employee_code || ""),
      status: String(profile.account_status || employee.status || "active"),
    };
  });
}

function rpcStatus(code?: string) {
  if (code === "42501") return 403;
  if (code === "P0002") return 404;
  if (code === "23505") return 409;
  if (code === "22023" || code === "23514") return 422;
  return 500;
}

export async function GET(request: NextRequest) {
  const auth = await requireTenantContext({ feature: "chat" }, request);
  if ("error" in auth) return auth.error;
  const params = new URL(request.url).searchParams;
  const requestedConversationId = params.get("conversation_id") || "";
  const before = params.get("before");
  const beforeId = params.get("before_id");
  const limit = Math.min(Math.max(Number(params.get("limit") || 50), 1), 100);
  try {
    const [inboxResult, availableUsers] = await Promise.all([
      (auth.admin as unknown as RpcClient).rpc("chat_inbox_snapshot", {
        p_org_id: auth.orgId, p_actor_user_id: auth.user.id, p_limit: 100,
      }),
      getOrgUsers(auth),
    ]);
    if (inboxResult.error) throw new Error(inboxResult.error.message);
    const conversations = Array.isArray(inboxResult.data) ? inboxResult.data as RecordMap[] : [];
    const conversationId = requestedConversationId || String(conversations[0]?.id || "");
    let page: RecordMap[] = [];
    if (conversationId) {
      const messagesResult = await (auth.admin as unknown as RpcClient).rpc("chat_message_page", {
        p_org_id: auth.orgId, p_actor_user_id: auth.user.id, p_conversation_id: conversationId,
        p_before: before || null, p_before_id: beforeId || null, p_limit: limit,
      });
      if (messagesResult.error) return NextResponse.json({ message: messagesResult.error.message, requestId: auth.requestId }, { status: rpcStatus(messagesResult.error.code) });
      const userMap = new Map(availableUsers.map((user) => [user.user_id, user]));
      page = await Promise.all(((messagesResult.data || []) as RecordMap[]).map(async (message) => ({
        ...message,
        body: message.deleted_at ? null : message.body,
        attachments: message.deleted_at ? [] : await signAttachments(auth, Array.isArray(message.attachments) ? message.attachments as RecordMap[] : []),
        sender: userMap.get(String(message.sender_user_id || "")) || null,
      })));
      page.reverse();
    }
    const signedConversations = await Promise.all(conversations.map(async (conversation) => {
      const latest = conversation.latest_message as RecordMap | null;
      const signedLatest = latest ? {
        ...latest,
        body: latest.deleted_at ? null : latest.body,
        attachments: latest.deleted_at ? [] : await signAttachments(auth, Array.isArray(latest.attachments) ? latest.attachments as RecordMap[] : []),
      } : null;
      return { ...conversation, messages: String(conversation.id) === conversationId ? page : signedLatest ? [signedLatest] : [] };
    }));
    const oldest = page[0];
    return NextResponse.json({ data: { conversations: signedConversations, available_users: availableUsers,
      page: { conversation_id: conversationId || null, has_more: page.length === limit,
        next_before: oldest?.created_at || null, next_before_id: oldest?.id || null } }, requestId: auth.requestId });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "تعذر تحميل المحادثات.", requestId: auth.requestId }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireTenantContext({ feature: "chat" }, request);
  if ("error" in auth) return auth.error;
  if (!(request.headers.get("content-type") || "").includes("multipart/form-data")) {
    return NextResponse.json({ message: "بيانات الرسالة غير صحيحة.", requestId: auth.requestId }, { status: 400 });
  }
  const formData = await request.formData();
  const existingConversationId = String(formData.get("conversation_id") || "").trim();
  const conversationId = existingConversationId || String(formData.get("proposed_conversation_id") || "").trim();
  const commandId = String(formData.get("command_id") || "").trim();
  const type = String(formData.get("type") || "direct") === "group" ? "group" : "direct";
  const title = String(formData.get("title") || "").trim();
  const body = String(formData.get("body") || "").trim();
  const participants = parseJsonArray(formData.get("participant_user_ids"));
  const files = formData.getAll("attachments").filter((item): item is File => item instanceof File && item.size > 0);
  if (!z.string().uuid().safeParse(conversationId).success || !z.string().uuid().safeParse(commandId).success) {
    return NextResponse.json({ message: "معرّف المحادثة أو الأمر غير صالح.", requestId: auth.requestId }, { status: 400 });
  }
  const uploadedPaths: string[] = [];
  try {
    const attachments: RecordMap[] = [];
    for (const file of files) {
      const inspected = await inspectUpload(file, { allowedMimeTypes: allowedAttachmentTypes, maxBytes: maxAttachmentBytes });
      const filename = safeFilename(file.name);
      const path = `${auth.orgId}/${conversationId}/${crypto.randomUUID()}-${filename}`;
      const upload = await auth.admin.storage.from("chat-attachments").upload(path, inspected.bytes, {
        contentType: inspected.detectedMime, upsert: false,
      });
      if (upload.error) throw new Error(upload.error.message);
      uploadedPaths.push(path);
      attachments.push({ bucket: "chat-attachments", path, filename, type: inspected.detectedMime,
        size_bytes: file.size, sha256: inspected.sha256, scan_status: inspected.scanStatus,
        scan_engine: inspected.engine, scanned_at: inspected.scannedAt });
    }
    const result = await (auth.admin as unknown as RpcClient).rpc("send_chat_message", {
      p_org_id: auth.orgId, p_actor_user_id: auth.user.id, p_request_id: auth.requestId,
      p_command_id: commandId, p_conversation_id: conversationId, p_type: type, p_title: title || null,
      p_participant_user_ids: participants, p_body: body || null, p_attachments: attachments,
    });
    if (result.error) {
      await removeUploadedPaths(auth.admin, "chat-attachments", uploadedPaths);
      return NextResponse.json({ message: result.error.message, requestId: auth.requestId }, { status: rpcStatus(result.error.code) });
    }
    const data = result.data as { conversation_id?: string; message?: RecordMap };
    if (data.message && Array.isArray(data.message.attachments)) {
      data.message.attachments = await signAttachments(auth, data.message.attachments as RecordMap[]);
    }
    return NextResponse.json({ data, requestId: auth.requestId });
  } catch (error) {
    await removeUploadedPaths(auth.admin, "chat-attachments", uploadedPaths).catch(() => undefined);
    const status = error instanceof UploadSecurityError ? (error.code === "scanner_unavailable" ? 503 : 400) : 500;
    return NextResponse.json({ message: error instanceof Error ? error.message : "تعذر إرسال الرسالة.", requestId: auth.requestId }, { status });
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireTenantContext({ feature: "chat" }, request);
  if ("error" in auth) return auth.error;
  const parsed = z.object({ conversation_id: z.string().uuid() }).safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ message: "Conversation id is required.", requestId: auth.requestId }, { status: 400 });
  const result = await (auth.admin as unknown as RpcClient).rpc("mark_chat_conversation_read", {
    p_org_id: auth.orgId, p_actor_user_id: auth.user.id, p_conversation_id: parsed.data.conversation_id,
  });
  if (result.error) return NextResponse.json({ message: result.error.message, requestId: auth.requestId }, { status: rpcStatus(result.error.code) });
  return NextResponse.json({ data: { read_at: result.data }, requestId: auth.requestId });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireTenantContext({ feature: "chat", roles: ["admin", "hr_admin"] }, request);
  if ("error" in auth) return auth.error;
  const parsed = z.object({ message_id: z.string().uuid(), reason: z.string().trim().min(3).max(2000), command_id: z.string().uuid() })
    .safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ message: "Message id and moderation reason are required.", requestId: auth.requestId }, { status: 400 });
  const result = await (auth.admin as unknown as RpcClient).rpc("moderate_chat_message", {
    p_org_id: auth.orgId, p_actor_user_id: auth.user.id, p_request_id: auth.requestId,
    p_command_id: parsed.data.command_id, p_message_id: parsed.data.message_id, p_reason: parsed.data.reason,
  });
  if (result.error) return NextResponse.json({ message: result.error.message, requestId: auth.requestId }, { status: rpcStatus(result.error.code) });
  const message = (Array.isArray(result.data) ? result.data[0] : result.data) as RecordMap;
  const paths = Array.isArray(message?.attachments) ? (message.attachments as RecordMap[]).map((item) => String(item.path || "")) : [];
  await removeUploadedPaths(auth.admin, "chat-attachments", paths).catch(() => undefined);
  return NextResponse.json({ data: message, requestId: auth.requestId });
}
