"use client";

import React, { useEffect, useMemo, useState } from "react";
import { MessageCircle, Paperclip, Plus, Send, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRoleContext } from "@/providers/RoleProvider";
import { getChatInbox, sendChatMessage, type ChatConversation, type ChatUser } from "@/lib/services/chat";

function roleLabel(role: string) {
  const labels: Record<string, string> = {
    admin: "Admin",
    hr_admin: "HR",
    hr_recruitment: "Recruiter",
    training_manager: "Manager",
    employee: "Employee",
    sales: "Sales",
    sales_manager: "Sales Manager",
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

export default function ChatPage() {
  const { currentUser } = useRoleContext();
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
  const canCreateGroup = ["Admin", "HR_Admin"].includes(currentUser?.role || "");

  const load = async () => {
    setLoading(true);
    const result = await getChatInbox();
    setLoading(false);
    if (result.error || !result.data) {
      setError(result.error?.message || "تعذر تحميل الشات.");
      return;
    }
    setConversations(result.data.conversations);
    setAvailableUsers(result.data.available_users.filter((user) => user.user_id !== currentUser?.id));
    setSelectedId((current) => current || result.data.conversations[0]?.id || "");
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id]);

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedId) || null,
    [conversations, selectedId]
  );

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
    await load();
    setSelectedId(result.data?.conversation_id || selectedConversation.id);
  };

  const startChat = async (type: "direct" | "group") => {
    if (selectedUsers.length === 0) {
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
      participant_user_ids: selectedUsers,
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
    await load();
    setSelectedId(result.data?.conversation_id || "");
  };

  const toggleUser = (userId: string) => {
    setSelectedUsers((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]
    );
  };

  return (
    <div className="flex flex-col gap-6" dir="rtl">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight">الشات</h1>
        <p className="text-sm text-gray-500">ابدأ محادثة مع أي مستخدم في النظام، أرسل ملفات، وتابع الرسائل المحفوظة.</p>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        <Card className="border-none shadow-sm">
          <CardContent className="space-y-4 p-4">
            <Tabs defaultValue="conversations">
              <TabsList className="w-full">
                <TabsTrigger value="conversations" className="flex-1">محادثاتي</TabsTrigger>
                <TabsTrigger value="start" className="flex-1">بدء شات</TabsTrigger>
              </TabsList>

              <TabsContent value="conversations" className="mt-4 space-y-2">
                {loading && <p className="py-6 text-center text-sm text-gray-500">جار التحميل...</p>}
                {!loading && conversations.length === 0 && (
                  <div className="py-8 text-center text-sm text-gray-500">
                    <MessageCircle className="mx-auto mb-2 h-8 w-8 text-gray-300" />
                    لا توجد محادثات بعد.
                  </div>
                )}
                {conversations.map((conversation) => (
                  <button
                    key={conversation.id}
                    className={`w-full rounded-lg border px-3 py-3 text-right transition ${
                      selectedId === conversation.id ? "border-brand bg-brand-light" : "border-gray-200 bg-white hover:bg-gray-50"
                    }`}
                    onClick={() => setSelectedId(conversation.id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-gray-900">{conversationName(conversation, currentUser?.id)}</p>
                      <Badge variant="outline">{conversation.type === "group" ? "جروب" : "فردي"}</Badge>
                    </div>
                    <p className="mt-1 line-clamp-1 text-xs text-gray-500">{lastMessage(conversation)}</p>
                  </button>
                ))}
              </TabsContent>

              <TabsContent value="start" className="mt-4 space-y-4">
                {canCreateGroup && (
                  <div className="space-y-2">
                    <Label>اسم الجروب</Label>
                    <Input value={groupTitle} onChange={(event) => setGroupTitle(event.target.value)} placeholder="مثال: فريق HR" />
                  </div>
                )}

                <div className="max-h-[360px] space-y-2 overflow-y-auto rounded-lg border border-gray-200 p-2">
                  {availableUsers.map((user) => (
                    <label key={user.user_id} className="flex cursor-pointer items-center gap-3 rounded-lg p-2 hover:bg-gray-50">
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

                <div className="flex gap-2">
                  <Button className="bg-brand text-white hover:bg-brand-dark" disabled={sending} onClick={() => startChat("direct")}>
                    <Plus className="ml-2 h-4 w-4" /> شات فردي
                  </Button>
                  {canCreateGroup && (
                    <Button variant="outline" disabled={sending} onClick={() => startChat("group")}>
                      <Users className="ml-2 h-4 w-4" /> جروب
                    </Button>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <Card className="min-h-[640px] border-none shadow-sm">
          <CardContent className="flex h-full min-h-[640px] flex-col p-0">
            {selectedConversation ? (
              <>
                <div className="border-b px-4 py-3">
                  <p className="text-lg font-semibold">{conversationName(selectedConversation, currentUser?.id)}</p>
                  <p className="text-xs text-gray-500">
                    {selectedConversation.participants.length} مشارك
                  </p>
                </div>

                <div className="flex-1 space-y-3 overflow-y-auto bg-gray-50 p-4">
                  {selectedConversation.messages.map((message) => {
                    const mine = message.sender_user_id === currentUser?.id;
                    return (
                      <div key={message.id} className={`flex ${mine ? "justify-start" : "justify-end"}`}>
                        <div className={`max-w-[75%] rounded-xl px-3 py-2 shadow-sm ${mine ? "bg-brand text-white" : "bg-white text-gray-900"}`}>
                          <p className={`mb-1 text-[11px] ${mine ? "text-white/75" : "text-gray-500"}`}>
                            {message.sender?.full_name || "مستخدم"} · {new Date(message.created_at).toLocaleString("ar-EG")}
                          </p>
                          {message.body && <p className="whitespace-pre-wrap text-sm">{message.body}</p>}
                          {Boolean(message.attachments?.length) && (
                            <div className="mt-2 space-y-1">
                              {message.attachments?.map((attachment, index) => (
                                <a
                                  key={`${message.id}-${index}`}
                                  href={String(attachment.url || "#")}
                                  target="_blank"
                                  rel="noreferrer"
                                  className={`block rounded-md border px-2 py-1 text-xs underline ${mine ? "border-white/30 text-white" : "border-gray-200 text-brand"}`}
                                >
                                  {String(attachment.filename || "مرفق")}
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="border-t bg-white p-4">
                  {files.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-2">
                      {files.map((file) => (
                        <Badge key={`${file.name}-${file.size}`} variant="outline">{file.name}</Badge>
                      ))}
                    </div>
                  )}
                  <div className="flex items-end gap-2">
                    <label className="flex h-10 cursor-pointer items-center justify-center rounded-lg border border-gray-200 px-3 text-gray-600 hover:bg-gray-50">
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
      </div>
    </div>
  );
}
