import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const allowedAttachmentTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
]);
const maxAttachmentBytes = 10 * 1024 * 1024;

function safeFilename(name: string) {
  return name.replace(/[^\w.\-()[\]\u0600-\u06FF ]+/g, "_").slice(0, 160) || "attachment";
}

async function getAuthContext() {
  const supabase = await createServerSupabaseClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData?.user;
  if (userError || !user) {
    return { error: NextResponse.json({ message: "غير مصرح بالدخول." }, { status: 401 }) };
  }

  const { data: membership, error: membershipError } = await supabase
    .from("org_members")
    .select("org_id, role")
    .eq("user_id", user.id)
    .maybeSingle();

  const member = membership as Record<string, unknown> | null;
  const orgId = String(member?.org_id || "");
  const role = String(member?.role || "");
  if (membershipError || !orgId || !role) {
    return { error: NextResponse.json({ message: "لا توجد صلاحية منظمة." }, { status: 403 }) };
  }

  return { user, orgId, role };
}

function parseJsonArray(value: FormDataEntryValue | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

async function getOrgUsers(admin: ReturnType<typeof createAdminClient>, orgId: string) {
  const [membersResult, profilesResult, employeesResult] = await Promise.all([
    admin.from("org_members").select("user_id, role").eq("org_id", orgId),
    admin.from("profiles").select("user_id, full_name, email, phone, title, account_status").eq("org_id", orgId),
    admin.from("employees").select("id, user_id, full_name, employee_code, job_title, status").eq("org_id", orgId),
  ]);

  if (membersResult.error) throw membersResult.error;
  if (profilesResult.error) throw profilesResult.error;
  if (employeesResult.error) throw employeesResult.error;

  const profiles = new Map(((profilesResult.data ?? []) as Record<string, unknown>[]).map((profile) => [String(profile.user_id), profile]));
  const employees = new Map(((employeesResult.data ?? []) as Record<string, unknown>[]).map((employee) => [String(employee.user_id), employee]));

  return ((membersResult.data ?? []) as Record<string, unknown>[]).map((member) => {
    const userId = String(member.user_id || "");
    const profile = profiles.get(userId) || {};
    const employee = employees.get(userId) || {};
    return {
      user_id: userId,
      employee_id: String(employee.id || ""),
      role: String(member.role || ""),
      full_name: String(employee.full_name || profile.full_name || profile.email || "مستخدم"),
      email: String(profile.email || ""),
      title: String(employee.job_title || profile.title || ""),
      employee_code: String(employee.employee_code || ""),
      status: String(profile.account_status || employee.status || "active"),
    };
  });
}

export async function GET() {
  const auth = await getAuthContext();
  if ("error" in auth) return auth.error;

  const admin = createAdminClient();
  try {
    const availableUsers = await getOrgUsers(admin, auth.orgId);
    const userMap = new Map(availableUsers.map((user) => [user.user_id, user]));

    const { data: myParticipants, error: participantError } = await admin
      .from("chat_participants")
      .select("conversation_id")
      .eq("org_id", auth.orgId)
      .eq("user_id", auth.user.id);

    if (participantError) return NextResponse.json({ message: participantError.message }, { status: 500 });

    const conversationIds = ((myParticipants ?? []) as Record<string, unknown>[]).map((row) => String(row.conversation_id));
    if (conversationIds.length === 0) {
      return NextResponse.json({ data: { conversations: [], available_users: availableUsers } });
    }

    const [conversationsResult, participantsResult, messagesResult] = await Promise.all([
      admin
        .from("chat_conversations")
        .select("*")
        .eq("org_id", auth.orgId)
        .in("id", conversationIds)
        .order("updated_at", { ascending: false }),
      admin
        .from("chat_participants")
        .select("*")
        .eq("org_id", auth.orgId)
        .in("conversation_id", conversationIds),
      admin
        .from("chat_messages")
        .select("*")
        .eq("org_id", auth.orgId)
        .in("conversation_id", conversationIds)
        .order("created_at", { ascending: true })
        .limit(800),
    ]);

    if (conversationsResult.error) return NextResponse.json({ message: conversationsResult.error.message }, { status: 500 });
    if (participantsResult.error) return NextResponse.json({ message: participantsResult.error.message }, { status: 500 });
    if (messagesResult.error) return NextResponse.json({ message: messagesResult.error.message }, { status: 500 });

    const participantsByConversation = new Map<string, Record<string, unknown>[]>();
    for (const participant of (participantsResult.data ?? []) as Record<string, unknown>[]) {
      const conversationId = String(participant.conversation_id || "");
      const list = participantsByConversation.get(conversationId) || [];
      list.push({ ...participant, user: userMap.get(String(participant.user_id || "")) || null });
      participantsByConversation.set(conversationId, list);
    }

    const messagesByConversation = new Map<string, Record<string, unknown>[]>();
    for (const message of (messagesResult.data ?? []) as Record<string, unknown>[]) {
      const conversationId = String(message.conversation_id || "");
      const list = messagesByConversation.get(conversationId) || [];
      list.push({ ...message, sender: userMap.get(String(message.sender_user_id || "")) || null });
      messagesByConversation.set(conversationId, list);
    }

    const conversations = ((conversationsResult.data ?? []) as Record<string, unknown>[]).map((conversation) => {
      const conversationId = String(conversation.id || "");
      return {
        ...conversation,
        participants: participantsByConversation.get(conversationId) || [],
        messages: messagesByConversation.get(conversationId) || [],
      };
    });

    return NextResponse.json({ data: { conversations, available_users: availableUsers } });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "تعذر تحميل المحادثات." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await getAuthContext();
  if ("error" in auth) return auth.error;

  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json({ message: "بيانات الرسالة غير صحيحة." }, { status: 400 });
  }

  const formData = await request.formData();
  const conversationId = String(formData.get("conversation_id") || "").trim();
  const title = String(formData.get("title") || "").trim();
  const typeInput = String(formData.get("type") || "direct").trim();
  const type = typeInput === "group" ? "group" : "direct";
  const body = String(formData.get("body") || "").trim();
  const requestedParticipants = parseJsonArray(formData.get("participant_user_ids"));
  const files = formData.getAll("attachments").filter((item): item is File => item instanceof File && item.size > 0);

  if (!conversationId && requestedParticipants.length === 0) {
    return NextResponse.json({ message: "اختر شخصًا واحدًا على الأقل لبدء المحادثة." }, { status: 400 });
  }
  if (!body && files.length === 0) {
    return NextResponse.json({ message: "اكتب رسالة أو أرفق ملفًا." }, { status: 400 });
  }
  if (type === "group" && !["admin", "hr_admin"].includes(auth.role)) {
    return NextResponse.json({ message: "إنشاء الجروبات متاح للموارد البشرية فقط." }, { status: 403 });
  }

  for (const file of files) {
    if (file.size > maxAttachmentBytes || !allowedAttachmentTypes.has(file.type)) {
      return NextResponse.json({ message: "نوع الملف غير مدعوم أو حجمه أكبر من 10MB." }, { status: 400 });
    }
  }

  const admin = createAdminClient();
  const orgUsers = await getOrgUsers(admin, auth.orgId);
  const orgUserIds = new Set(orgUsers.map((user) => user.user_id));
  const employeeByUserId = new Map(orgUsers.map((user) => [user.user_id, user.employee_id]));

  let targetConversationId = conversationId;
  let participantUserIds = Array.from(new Set([auth.user.id, ...requestedParticipants.filter((id) => orgUserIds.has(id))]));

  if (!targetConversationId) {
    if (participantUserIds.length < 2) {
      return NextResponse.json({ message: "لا يمكن إنشاء محادثة بدون مشاركين." }, { status: 400 });
    }

    const conversationResult = await admin
      .from("chat_conversations")
      .insert({
        org_id: auth.orgId,
        type,
        title: type === "group" ? title || "جروب جديد" : null,
        created_by: auth.user.id,
      } as never)
      .select()
      .single();

    if (conversationResult.error) return NextResponse.json({ message: conversationResult.error.message }, { status: 500 });
    targetConversationId = String((conversationResult.data as Record<string, unknown>).id || "");

    const participantRows = participantUserIds.map((userId) => ({
      conversation_id: targetConversationId,
      org_id: auth.orgId,
      user_id: userId,
      employee_id: employeeByUserId.get(userId) || null,
      added_by: auth.user.id,
    }));

    const participantResult = await admin.from("chat_participants").insert(participantRows as never);
    if (participantResult.error) return NextResponse.json({ message: participantResult.error.message }, { status: 500 });
  } else {
    const { data: existingParticipant, error: accessError } = await admin
      .from("chat_participants")
      .select("id")
      .eq("org_id", auth.orgId)
      .eq("conversation_id", targetConversationId)
      .eq("user_id", auth.user.id)
      .maybeSingle();

    if (accessError) return NextResponse.json({ message: accessError.message }, { status: 500 });
    if (!existingParticipant) return NextResponse.json({ message: "ليست لديك صلاحية لهذه المحادثة." }, { status: 403 });

    const { data: allParticipants } = await admin
      .from("chat_participants")
      .select("user_id")
      .eq("org_id", auth.orgId)
      .eq("conversation_id", targetConversationId);
    participantUserIds = ((allParticipants ?? []) as Record<string, unknown>[]).map((row) => String(row.user_id || ""));
  }

  const attachments: Record<string, unknown>[] = [];
  for (const file of files) {
    const filename = safeFilename(file.name);
    const path = `${auth.orgId}/${targetConversationId}/${Date.now()}-${filename}`;
    const upload = await admin.storage.from("chat-attachments").upload(path, file, {
      contentType: file.type,
      upsert: false,
    });
    if (upload.error) return NextResponse.json({ message: upload.error.message }, { status: 500 });
    const publicUrl = admin.storage.from("chat-attachments").getPublicUrl(path).data.publicUrl;
    attachments.push({ filename, url: publicUrl, type: file.type, size_bytes: file.size });
  }

  const messageResult = await admin
    .from("chat_messages")
    .insert({
      conversation_id: targetConversationId,
      org_id: auth.orgId,
      sender_user_id: auth.user.id,
      sender_employee_id: employeeByUserId.get(auth.user.id) || null,
      body: body || null,
      attachments,
    } as never)
    .select()
    .single();

  if (messageResult.error) return NextResponse.json({ message: messageResult.error.message }, { status: 500 });

  await admin
    .from("chat_conversations")
    .update({ updated_at: new Date().toISOString() } as never)
    .eq("id", targetConversationId);

  const sender = orgUsers.find((user) => user.user_id === auth.user.id);
  const notificationRows = participantUserIds
    .filter((userId) => userId !== auth.user.id)
    .map((userId) => ({
      org_id: auth.orgId,
      user_id: userId,
      title: "رسالة شات جديدة",
      body: `${sender?.full_name || "مستخدم"}: ${body || "أرسل مرفقًا"}`,
      type: "system",
      link: `/chat?conversation=${encodeURIComponent(targetConversationId)}`,
      is_read: false,
    }));
  if (notificationRows.length > 0) await admin.from("notifications").insert(notificationRows as never);

  return NextResponse.json({ data: { conversation_id: targetConversationId, message: messageResult.data } });
}
