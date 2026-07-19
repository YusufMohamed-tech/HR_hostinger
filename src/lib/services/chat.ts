export type ChatUser = {
  org_id?: string;
  user_id: string;
  employee_id?: string;
  role: string;
  full_name: string;
  email?: string;
  title?: string;
  employee_code?: string;
  status?: string;
};

export type ChatMessage = {
  id: string;
  conversation_id: string;
  sender_user_id: string;
  body?: string | null;
  attachments?: Record<string, unknown>[];
  created_at: string;
  sender?: ChatUser | null;
};

export type ChatConversation = {
  id: string;
  type: "direct" | "group";
  title?: string | null;
  updated_at: string;
  participants: Array<Record<string, unknown> & { user?: ChatUser | null }>;
  messages: ChatMessage[];
  unread_count?: number;
};

export type ChatPage = {
  conversation_id: string | null;
  has_more: boolean;
  next_before: string | null;
  next_before_id: string | null;
};

export async function getChatInbox(conversationId?: string, cursor?: { before: string; beforeId: string }) {
  const params = new URLSearchParams();
  if (conversationId) params.set("conversation_id", conversationId);
  if (cursor) {
    params.set("before", cursor.before);
    params.set("before_id", cursor.beforeId);
  }
  const response = await fetch(`/api/chat${params.size ? `?${params}` : ""}`, { cache: "no-store" });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return {
      data: null,
      error: { message: String(payload?.message || "تعذر تحميل الشات.") },
    };
  }
  return {
    data: payload?.data as { conversations: ChatConversation[]; available_users: ChatUser[]; page: ChatPage },
    error: null,
  };
}

export async function sendChatMessage(values: {
  conversation_id?: string;
  participant_user_ids?: string[];
  type?: "direct" | "group";
  title?: string;
  body: string;
  attachments?: File[];
}) {
  const commandId = crypto.randomUUID();
  const proposedConversationId = values.conversation_id || crypto.randomUUID();
  const formData = new FormData();
  if (values.conversation_id) formData.append("conversation_id", values.conversation_id);
  formData.append("proposed_conversation_id", proposedConversationId);
  formData.append("command_id", commandId);
  if (values.participant_user_ids) formData.append("participant_user_ids", JSON.stringify(values.participant_user_ids));
  if (values.type) formData.append("type", values.type);
  if (values.title) formData.append("title", values.title);
  formData.append("body", values.body);
  values.attachments?.forEach((file) => formData.append("attachments", file));

  const response = await fetch("/api/chat", {
    method: "POST",
    body: formData,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return {
      data: null,
      error: { message: String(payload?.message || "تعذر إرسال الرسالة.") },
    };
  }
  return {
    data: payload?.data as { conversation_id: string; message: ChatMessage },
    error: null,
  };
}

export async function markChatConversationRead(conversationId: string) {
  const response = await fetch("/api/chat", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversation_id: conversationId }),
  });
  const payload = await response.json().catch(() => null);
  return response.ok ? { data: payload?.data, error: null }
    : { data: null, error: { message: String(payload?.message || "تعذر تحديث حالة القراءة.") } };
}
