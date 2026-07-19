"use client";

import React, { useEffect, useMemo, useState } from "react";
import { MessageCircle, Paperclip, Plus, Search, Send, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useRoleContext } from "@/providers/RoleProvider";
import { getChatInbox, markChatConversationRead, sendChatMessage, type ChatConversation, type ChatPage, type ChatUser } from "@/lib/services/chat";
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
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [groupTitle, setGroupTitle] = useState("");
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [conversationSearch, setConversationSearch] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [page, setPage] = useState<ChatPage | null>(null);
  const canCreateGroup = ["Admin", "HR_Admin", "Superadmin"].includes(currentUser?.role || "");

  const load = async (conversationId?: string) => {
    setLoading(true);
    const result = await getChatInbox(conversationId);
    setLoading(false);
    if (result.error || !result.data) {
      setError(result.error?.message || "تعذر تحميل الشات.");
      return;
    }
    setConversations(result.data.conversations);
    setAvailableUsers(result.data.available_users.filter((user) => user.user_id !== currentUser?.id));
    setPage(result.data.page);
    setSelectedId(conversationId || result.data.page.conversation_id || result.data.conversations[0]?.id || "");
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id]);

  useEffect(() => {
    if (!selectedId) return;
    const channel = supabase.channel(`chat:${selectedId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `conversation_id=eq.${selectedId}` }, () => {
        void load(selectedId);
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, supabase]);

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedId) || null,
    [conversations, selectedId]
  );

  const filteredConversations = useMemo(() => {
    const query = conversationSearch.trim().toLowerCase();
    if (!query) return conversations;
    return conversations.filter((conversation) =>
      conversationName(conversation, currentUser?.id).toLowerCase().includes(query)
      || lastMessage(conversation).toLowerCase().includes(query)
    );
  }, [conversationSearch, conversations, currentUser?.id]);

  const filteredUsers = useMemo(() => {
    const query = userSearch.trim().toLowerCase();
    if (!query) return availableUsers;
    return availableUsers.filter((user) =>
      user.full_name.toLowerCase().includes(query)
      || (user.email || "").toLowerCase().includes(query)
      || (user.title || "").toLowerCase().includes(query)
      || roleLabel(user.role).toLowerCase().includes(query)
    );
  }, [availableUsers, userSearch]);

  const submitMessage = async () => {
    if (!selectedConversation || (!body.trim() && files.length === 0)) return;
    setSending(true);
    setError("");
    const result = await sendChatMessage({
      conversation_id: selectedConversation.id,
      body: body.trim(),
      attachments: files,
    });
    setSending(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setBody("");
    setFiles([]);
    await load(selectedConversation.id);
    setSelectedId(result.data?.conversation_id || selectedConversation.id);
  };

  const startChat = async (type: "direct" | "group") => {
    const participants = type === "direct" ? selectedUsers.slice(0, 1) : selectedUsers;
    if (participants.length === 0) {
      setError("اختر مشاركًا واحدًا على الأقل.");
      return;
    }
    if (type === "group" && !groupTitle.trim()) {
      setError("اكتب اسم الجروب.");
      return;
    }
    setSending(true);
    setError("");
    const result = await sendChatMessage({
      participant_user_ids: participants,
      type,
      title: groupTitle.trim(),
      body: type === "group" ? "تم إنشاء الجروب." : "بدأت المحادثة.",
    });
    setSending(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setSelectedUsers([]);
    setGroupTitle("");
    const nextConversationId = result.data?.conversation_id || "";
    await load(nextConversationId);
    setSelectedId(nextConversationId);
  };

  const toggleUser = (userId: string) => {
    setSelectedUsers((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]
    );
  };

  const selectConversation = async (conversationId: string) => {
    setSelectedId(conversationId);
    await markChatConversationRead(conversationId);
    await load(conversationId);
  };

  const loadOlder = async () => {
    if (!selectedId || !page?.next_before || !page.next_before_id) return;
    const result = await getChatInbox(selectedId, { before: page.next_before, beforeId: page.next_before_id });
    if (result.error || !result.data) return setError(result.error?.message || "تعذر تحميل الرسائل السابقة.");
    const older = result.data.conversations.find((conversation) => conversation.id === selectedId)?.messages || [];
    setConversations((current) => current.map((conversation) => conversation.id === selectedId
      ? { ...conversation, messages: [...older, ...conversation.messages] } : conversation));
    setPage(result.data.page);
  };

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
                  onChange={(event) => setConversationSearch(event.target.value)}
                  placeholder="ابحث في المحادثات..."
                  className="pr-9"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {loading && <p className="py-8 text-center text-sm text-gray-500">جار التحميل...</p>}
              {!loading && filteredConversations.length === 0 && (
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

                <div className="flex-1 overflow-y-auto bg-gray-50 px-4 py-4">
                  <div className="space-y-3">
                    {page?.conversation_id === selectedId && page.has_more && (
                      <Button type="button" variant="ghost" size="sm" className="mx-auto block" onClick={() => void loadOlder()}>
                        تحميل رسائل أقدم
                      </Button>
                    )}
                    {selectedConversation.messages.map((message) => {
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
                  </div>
                </div>

                <div className="border-t bg-white p-3">
                  {files.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-2">
                      {files.map((file) => (
                        <Badge key={`${file.name}-${file.size}`} variant="outline" className="gap-1">
                          {file.name}
                          <button onClick={() => setFiles((current) => current.filter((item) => item !== file))}>
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
                        onChange={(event) => setFiles(Array.from(event.target.files || []))}
                      />
                    </label>
                    <Input
                      value={body}
                      onChange={(event) => setBody(event.target.value)}
                      placeholder="اكتب رسالتك..."
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          submitMessage();
                        }
                      }}
                    />
                    <Button className="bg-brand text-white hover:bg-brand-dark" disabled={sending || (!body.trim() && files.length === 0)} onClick={submitMessage}>
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

        <Card className="h-[72vh] min-h-[620px] border-none shadow-sm">
          <CardContent className="flex h-full flex-col p-0">
            <div className="border-b px-4 py-3">
              <h2 className="font-semibold text-gray-900">بدء محادثة</h2>
              <p className="mt-1 text-xs text-gray-500">اختر مستخدمًا لشات فردي أو أكثر لجروب.</p>
              <div className="relative mt-3">
                <Search className="absolute right-2.5 top-2.5 h-4 w-4 text-gray-400" />
                <Input
                  value={userSearch}
                  onChange={(event) => setUserSearch(event.target.value)}
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
                  onChange={(event) => setGroupTitle(event.target.value)}
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
                <Button className="bg-brand text-white hover:bg-brand-dark" disabled={sending || selectedUsers.length === 0} onClick={() => startChat("direct")}>
                  <Plus className="ml-2 h-4 w-4" /> فردي
                </Button>
                <Button variant="outline" disabled={!canCreateGroup || sending || selectedUsers.length === 0} onClick={() => startChat("group")}>
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
