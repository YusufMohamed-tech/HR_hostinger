"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessageCircle, Paperclip, Plus, Search, Send, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useRoleContext } from "@/providers/RoleProvider";
import { getChatInbox, markChatConversationRead, sendChatMessage, type ChatConversation, type ChatMessage, type ChatPage, type ChatUser } from "@/lib/services/chat";
import { AttachmentLink } from "@/components/AttachmentLink";
import { createClient } from "@/lib/supabase/client";

function roleLabel(role: string) {
  const labels: Record<string, string> = {
    admin: "Admin",
    super_admin: "Superadmin",
    hr_admin: "HR",
    hr_recruitment: "Recruiter",
    training_manager: "Manager",
    employee: "Employee",
    sales: "Sales",
    sales_manager: "Sales Manager",
    promoter: "Promoter",
    supervisor: "مشرف مواقع",
    finance_manager: "مدير مالية",
    accountant: "محاسب",
    finance_viewer: "مشاهد مالية",
    account_manager: "مدير حسابات",
  };
  return labels[role] || role;
}

function conversationName(conversation: ChatConversation, currentUserId?: string) {
  if (conversation.type === "group") return conversation.title || "جروب";
  const other = conversation.participants.find((participant) => String(participant.user_id || "") !== currentUserId);
  const user = other?.user as ChatUser | null | undefined;
  return user?.full_name || "محادثة";
}

function lastMessage(conversation: ChatConversation) {
  const message = conversation.messages[conversation.messages.length - 1];
  if (!message) return "لا توجد رسائل بعد";
  return message.body || (message.attachments?.length ? "مرفق" : "رسالة");
}

function formatTime(value?: string) {
  if (!value) return "";
  return new Date(value).toLocaleString("ar-EG", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ChatPage() {
  const { currentUser } = useRoleContext();
  const supabase = useMemo(() => createClient(), []);

  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [availableUsers, setAvailableUsers] = useState<ChatUser[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [initializing, setInitializing] = useState(true);
  const [sending, setSending] = useState(false);
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [groupTitle, setGroupTitle] = useState("");
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [conversationSearch, setConversationSearch] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [page, setPage] = useState<ChatPage | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const canCreateGroup = ["Admin", "HR_Admin", "Superadmin"].includes(currentUser?.role || "");

  // ─── Data fetching ────────────────────────────────────────────────────────

  // Full inbox + user list refresh. Only shows the spinner on initial load.
  const loadInbox = useCallback(async (silent = false) => {
    if (!silent) setInitializing(true);
    const result = await getChatInbox();
    setInitializing(false);
    if (result.error || !result.data) {
      setError(result.error?.message || "تعذر تحميل الشات.");
      return;
    }
    setConversations(result.data.conversations);
    setAvailableUsers(result.data.available_users.filter((u) => u.user_id !== currentUser?.id));
  }, [currentUser?.id]);

  // Silently refresh messages for one conversation, updating page cursor too.
  const loadMessages = useCallback(async (conversationId: string) => {
    const result = await getChatInbox(conversationId);
    if (result.error || !result.data) return;
    setConversations(result.data.conversations);
    setPage(result.data.page);
  }, []);

  // On mount, load full inbox then resolve the selected conversation.
  const initialLoad = useCallback(async () => {
    setInitializing(true);
    const result = await getChatInbox();
    setInitializing(false);
    if (result.error || !result.data) {
      setError(result.error?.message || "تعذر تحميل الشات.");
      return;
    }
    setConversations(result.data.conversations);
    setAvailableUsers(result.data.available_users.filter((u) => u.user_id !== currentUser?.id));
    setPage(result.data.page);
    const firstId = result.data.page.conversation_id || result.data.conversations[0]?.id || "";
    setSelectedId(firstId);
  }, [currentUser?.id]);

  useEffect(() => {
    void initialLoad();
  }, [initialLoad]);

  // ─── Realtime subscriptions ───────────────────────────────────────────────

  // Channel 1: inbox-level — fires when any conversation the user is in gets
  // updated_at bumped (i.e. a new message was sent to any conversation).
  // Silently refreshes the sidebar list and unread counts.
  useEffect(() => {
    const inboxChannel = supabase
      .channel("chat:inbox")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "chat_conversations" },
        () => { void loadInbox(true); }
      )
      .subscribe();
    return () => { void supabase.removeChannel(inboxChannel); };
  }, [supabase, loadInbox]);

  // Channel 2: message-level — fires only for INSERTs in the open conversation,
  // keeping the message thread up-to-date in real time.
  useEffect(() => {
    if (!selectedId) return;
    const messageChannel = supabase
      .channel(`chat:messages:${selectedId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages", filter: `conversation_id=eq.${selectedId}` },
        () => { void loadMessages(selectedId); }
      )
      .subscribe();
    return () => { void supabase.removeChannel(messageChannel); };
  }, [selectedId, supabase, loadMessages]);

  // ─── Scroll to bottom ─────────────────────────────────────────────────────

  const selectedConversation = useMemo(
    () => conversations.find((c) => c.id === selectedId) || null,
    [conversations, selectedId]
  );

  // Scroll to the latest message whenever the active conversation's messages change.
  // Skip if the user has scrolled up to read older messages (> 150px from bottom).
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 150;
    if (nearBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [selectedConversation?.messages]);

  // Always scroll to bottom when switching conversations.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
  }, [selectedId]);

  // ─── Actions ──────────────────────────────────────────────────────────────

  const submitMessage = async () => {
    if (!selectedConversation || (!body.trim() && files.length === 0)) return;
    setSending(true);
    setError("");
    const messageBody = body.trim();
    setBody("");
    setFiles([]);

    const result = await sendChatMessage({
      conversation_id: selectedConversation.id,
      body: messageBody,
      attachments: files,
    });
    setSending(false);

    if (result.error) {
      setError(result.error.message);
      setBody(messageBody); // restore on failure
      return;
    }

    // Optimistically append the sent message from the API response so the UI
    // updates instantly without waiting for the realtime INSERT event.
    const newMessage = result.data?.message;
    if (newMessage) {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === selectedConversation.id
            ? { ...c, messages: [...c.messages, newMessage], updated_at: newMessage.created_at }
            : c
        )
      );
    }
  };

  const startChat = async (type: "direct" | "group") => {
    const participants = type === "direct" ? selectedUsers.slice(0, 1) : selectedUsers;
    if (participants.length === 0) { setError("اختر مشاركًا واحدًا على الأقل."); return; }
    if (type === "group" && !groupTitle.trim()) { setError("اكتب اسم الجروب."); return; }
    setSending(true);
    setError("");
    const result = await sendChatMessage({
      participant_user_ids: participants,
      type,
      title: groupTitle.trim(),
      body: type === "group" ? "تم إنشاء الجروب." : "بدأت المحادثة.",
    });
    setSending(false);
    if (result.error) { setError(result.error.message); return; }
    setSelectedUsers([]);
    setGroupTitle("");
    const nextId = result.data?.conversation_id || "";
    await loadMessages(nextId);
    setSelectedId(nextId);
  };

  const toggleUser = (userId: string) => {
    setSelectedUsers((curr) =>
      curr.includes(userId) ? curr.filter((id) => id !== userId) : [...curr, userId]
    );
  };

  const selectConversation = async (conversationId: string) => {
    setSelectedId(conversationId);
    void markChatConversationRead(conversationId);
    await loadMessages(conversationId);
  };

  const loadOlder = async () => {
    if (!selectedId || !page?.next_before || !page.next_before_id) return;
    const result = await getChatInbox(selectedId, { before: page.next_before, beforeId: page.next_before_id });
    if (result.error || !result.data) return setError(result.error?.message || "تعذر تحميل الرسائل السابقة.");
    const older = result.data.conversations.find((c) => c.id === selectedId)?.messages || [];
    setConversations((curr) =>
      curr.map((c) => c.id === selectedId ? { ...c, messages: [...older, ...c.messages] } : c)
    );
    setPage(result.data.page);
  };

  // ─── Derived state ────────────────────────────────────────────────────────

  const filteredConversations = useMemo(() => {
    const query = conversationSearch.trim().toLowerCase();
    if (!query) return conversations;
    return conversations.filter((c) =>
      conversationName(c, currentUser?.id).toLowerCase().includes(query) ||
      lastMessage(c).toLowerCase().includes(query)
    );
  }, [conversationSearch, conversations, currentUser?.id]);

  const filteredUsers = useMemo(() => {
    const query = userSearch.trim().toLowerCase();
    if (!query) return availableUsers;
    return availableUsers.filter((u) =>
      u.full_name.toLowerCase().includes(query) ||
      (u.email || "").toLowerCase().includes(query) ||
      (u.title || "").toLowerCase().includes(query) ||
      roleLabel(u.role).toLowerCase().includes(query)
    );
  }, [availableUsers, userSearch]);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-5" dir="rtl">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">الشات</h1>
          <p className="mt-1 text-sm text-gray-500">محادثات مباشرة وجروبات داخل النظام مع حفظ الرسائل والمرفقات.</p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center sm:w-[420px]">
          <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
            <p className="text-lg font-semibold text-gray-900">{conversations.length}</p>
            <p className="text-xs text-gray-500">محادثة</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
            <p className="text-lg font-semibold text-gray-900">{availableUsers.length}</p>
            <p className="text-xs text-gray-500">مستخدم</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
            <p className="text-lg font-semibold text-brand">{selectedUsers.length}</p>
            <p className="text-xs text-gray-500">مختار</p>
          </div>
        </div>
      </div>

      {error && <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)_320px]">
        {/* ── Conversation list ── */}
        <Card className="h-[72vh] min-h-[620px] border-none shadow-sm">
          <CardContent className="flex h-full flex-col p-0">
            <div className="border-b px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-semibold text-gray-900">محادثاتي</h2>
                <Badge variant="outline">{filteredConversations.length}</Badge>
              </div>
              <div className="relative mt-3">
                <Search className="absolute right-2.5 top-2.5 h-4 w-4 text-gray-400" />
                <Input
                  value={conversationSearch}
                  onChange={(e) => setConversationSearch(e.target.value)}
                  placeholder="ابحث في المحادثات..."
                  className="pr-9"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {initializing && <p className="py-8 text-center text-sm text-gray-500">جار التحميل...</p>}
              {!initializing && filteredConversations.length === 0 && (
                <div className="py-10 text-center text-sm text-gray-500">
                  <MessageCircle className="mx-auto mb-2 h-8 w-8 text-gray-300" />
                  لا توجد محادثات بعد.
                </div>
              )}
              <div className="space-y-2">
                {filteredConversations.map((conversation) => {
                  const latest = conversation.messages[conversation.messages.length - 1];
                  return (
                    <button
                      key={conversation.id}
                      className={`w-full rounded-lg border px-3 py-3 text-right transition ${
                        selectedId === conversation.id
                          ? "border-brand bg-brand-light shadow-sm"
                          : "border-gray-200 bg-white hover:bg-gray-50"
                      }`}
                      onClick={() => void selectConversation(conversation.id)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate font-semibold text-gray-900">{conversationName(conversation, currentUser?.id)}</p>
                        <Badge variant="outline">{conversation.type === "group" ? "جروب" : "فردي"}</Badge>
                      </div>
                      <p className="mt-1 line-clamp-1 text-xs text-gray-500">{lastMessage(conversation)}</p>
                      <p className="mt-2 text-[11px] text-gray-400">{formatTime(latest?.created_at || conversation.updated_at)}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Message thread ── */}
        <Card className="h-[72vh] min-h-[620px] border-none shadow-sm">
          <CardContent className="flex h-full flex-col p-0">
            {selectedConversation ? (
              <>
                <div className="flex items-center justify-between gap-3 border-b bg-white px-4 py-3">
                  <div>
                    <p className="text-lg font-semibold text-gray-900">{conversationName(selectedConversation, currentUser?.id)}</p>
                    <p className="text-xs text-gray-500">{selectedConversation.participants.length} مشارك</p>
                  </div>
                  <Badge variant="outline">{selectedConversation.type === "group" ? "جروب" : "فردي"}</Badge>
                </div>

                <div ref={messagesContainerRef} className="flex-1 overflow-y-auto bg-gray-50 px-4 py-4">
                  <div className="space-y-3">
                    {page?.conversation_id === selectedId && page.has_more && (
                      <Button type="button" variant="ghost" size="sm" className="mx-auto block" onClick={() => void loadOlder()}>
                        تحميل رسائل أقدم
                      </Button>
                    )}
                    {selectedConversation.messages.map((message: ChatMessage) => {
                      const mine = message.sender_user_id === currentUser?.id;
                      return (
                        <div key={message.id} className={`flex ${mine ? "justify-start" : "justify-end"}`}>
                          <div className={`max-w-[78%] rounded-xl px-3 py-2 shadow-sm ${mine ? "bg-brand text-white" : "bg-white text-gray-900"}`}>
                            <p className={`mb-1 text-[11px] ${mine ? "text-white/75" : "text-gray-500"}`}>
                              {message.sender?.full_name || "مستخدم"} · {formatTime(message.created_at)}
                            </p>
                            {message.body && <p className="whitespace-pre-wrap text-sm leading-6">{message.body}</p>}
                            {Boolean(message.attachments?.length) && (
                              <div className="mt-2 space-y-1">
                                {message.attachments?.map((attachment, index) => (
                                  <AttachmentLink
                                    key={`${message.id}-${index}`}
                                    bucket="chat-attachments"
                                    attachment={attachment}
                                    className={`flex items-center gap-2 rounded-md border px-2 py-1 text-xs underline ${
                                      mine ? "border-white/30 text-white" : "border-gray-200 text-brand"
                                    }`}
                                  >
                                    <Paperclip className="h-3.5 w-3.5" />
                                    {String(attachment.filename || "مرفق")}
                                  </AttachmentLink>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {/* Scroll anchor */}
                    <div ref={messagesEndRef} />
                  </div>
                </div>

                <div className="border-t bg-white p-3">
                  {files.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-2">
                      {files.map((file) => (
                        <Badge key={`${file.name}-${file.size}`} variant="outline" className="gap-1">
                          {file.name}
                          <button onClick={() => setFiles((curr) => curr.filter((f) => f !== file))}>
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <label className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
                      <Paperclip className="h-4 w-4" />
                      <input
                        type="file"
                        multiple
                        className="hidden"
                        onChange={(e) => setFiles(Array.from(e.target.files || []))}
                      />
                    </label>
                    <Input
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      placeholder="اكتب رسالتك..."
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          void submitMessage();
                        }
                      }}
                    />
                    <Button
                      className="bg-brand text-white hover:bg-brand-dark"
                      disabled={sending || (!body.trim() && files.length === 0)}
                      onClick={() => void submitMessage()}
                    >
                      <Send className="ml-2 h-4 w-4" /> إرسال
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center text-center text-gray-500">
                <MessageCircle className="mb-3 h-10 w-10 text-gray-300" />
                اختر محادثة أو ابدأ شات جديد.
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── New conversation panel ── */}
        <Card className="h-[72vh] min-h-[620px] border-none shadow-sm">
          <CardContent className="flex h-full flex-col p-0">
            <div className="border-b px-4 py-3">
              <h2 className="font-semibold text-gray-900">بدء محادثة</h2>
              <p className="mt-1 text-xs text-gray-500">اختر مستخدمًا لشات فردي أو أكثر لجروب.</p>
              <div className="relative mt-3">
                <Search className="absolute right-2.5 top-2.5 h-4 w-4 text-gray-400" />
                <Input
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="ابحث عن مستخدم..."
                  className="pr-9"
                />
              </div>
            </div>

            {canCreateGroup && (
              <div className="border-b px-4 py-3">
                <Label>اسم الجروب</Label>
                <Input
                  value={groupTitle}
                  onChange={(e) => setGroupTitle(e.target.value)}
                  placeholder="مثال: فريق HR"
                  className="mt-2"
                />
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-3">
              <div className="space-y-2">
                {filteredUsers.map((user) => (
                  <label
                    key={user.user_id}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg border p-2 transition ${
                      selectedUsers.includes(user.user_id) ? "border-brand bg-brand-light" : "border-gray-200 bg-white hover:bg-gray-50"
                    }`}
                  >
                    <input
                      type={canCreateGroup ? "checkbox" : "radio"}
                      checked={selectedUsers.includes(user.user_id)}
                      onChange={() => {
                        if (canCreateGroup) toggleUser(user.user_id);
                        else setSelectedUsers([user.user_id]);
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-gray-900">{user.full_name}</p>
                      <p className="truncate text-xs text-gray-500">{user.title || user.email || roleLabel(user.role)}</p>
                    </div>
                    <Badge variant="outline">{roleLabel(user.role)}</Badge>
                  </label>
                ))}
              </div>
            </div>

            <div className="border-t bg-white p-3">
              <div className="grid grid-cols-2 gap-2">
                <Button
                  className="bg-brand text-white hover:bg-brand-dark"
                  disabled={sending || selectedUsers.length === 0}
                  onClick={() => void startChat("direct")}
                >
                  <Plus className="ml-2 h-4 w-4" /> فردي
                </Button>
                <Button
                  variant="outline"
                  disabled={!canCreateGroup || sending || selectedUsers.length === 0}
                  onClick={() => void startChat("group")}
                >
                  <Users className="ml-2 h-4 w-4" /> جروب
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
