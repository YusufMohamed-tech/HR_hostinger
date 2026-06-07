CREATE TABLE IF NOT EXISTS public.chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'direct' CHECK (type IN ('direct', 'group')),
  title text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.chat_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  added_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  last_read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sender_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sender_employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  body text,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_conversations_org_updated
  ON public.chat_conversations(org_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_participants_user
  ON public.chat_participants(org_id, user_id);

CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_created
  ON public.chat_messages(conversation_id, created_at);

ALTER TABLE public.chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_conversations_member_select ON public.chat_conversations;
CREATE POLICY chat_conversations_member_select ON public.chat_conversations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.chat_participants cp
      WHERE cp.conversation_id = chat_conversations.id
        AND cp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS chat_participants_member_select ON public.chat_participants;
CREATE POLICY chat_participants_member_select ON public.chat_participants
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.chat_participants cp
      WHERE cp.conversation_id = chat_participants.conversation_id
        AND cp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS chat_messages_member_select ON public.chat_messages;
CREATE POLICY chat_messages_member_select ON public.chat_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.chat_participants cp
      WHERE cp.conversation_id = chat_messages.conversation_id
        AND cp.user_id = auth.uid()
    )
  );

INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-attachments', 'chat-attachments', true)
ON CONFLICT (id) DO UPDATE SET public = true;
