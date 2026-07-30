-- Migration v137: AI Chatbot tables
-- Adds conversation persistence and action audit logging for the embedded AI assistant.

-- Conversation sessions
CREATE TABLE IF NOT EXISTS chatbot_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_archived BOOLEAN NOT NULL DEFAULT false
);

-- Individual messages
CREATE TABLE IF NOT EXISTS chatbot_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES chatbot_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Action execution audit log
CREATE TABLE IF NOT EXISTS chatbot_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES chatbot_conversations(id) ON DELETE CASCADE,
  message_id UUID REFERENCES chatbot_messages(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL,
  action_params JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'executed', 'failed', 'cancelled')),
  result JSONB,
  executed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_chatbot_conversations_user
  ON chatbot_conversations(user_id, organization_id);
CREATE INDEX IF NOT EXISTS idx_chatbot_conversations_updated
  ON chatbot_conversations(organization_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chatbot_messages_conversation
  ON chatbot_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chatbot_actions_conversation
  ON chatbot_actions(conversation_id);

-- RLS
ALTER TABLE chatbot_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE chatbot_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE chatbot_actions ENABLE ROW LEVEL SECURITY;

-- Policies: users can only access their own conversations
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'chatbot_conversations_user_access') THEN
    CREATE POLICY chatbot_conversations_user_access ON chatbot_conversations
      FOR ALL USING (user_id = auth.uid());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'chatbot_messages_user_access') THEN
    CREATE POLICY chatbot_messages_user_access ON chatbot_messages
      FOR ALL USING (
        conversation_id IN (SELECT id FROM chatbot_conversations WHERE user_id = auth.uid())
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'chatbot_actions_user_access') THEN
    CREATE POLICY chatbot_actions_user_access ON chatbot_actions
      FOR ALL USING (
        conversation_id IN (SELECT id FROM chatbot_conversations WHERE user_id = auth.uid())
      );
  END IF;
END $$;

-- Service role bypass for API routes
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'chatbot_conversations_service') THEN
    CREATE POLICY chatbot_conversations_service ON chatbot_conversations
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'chatbot_messages_service') THEN
    CREATE POLICY chatbot_messages_service ON chatbot_messages
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'chatbot_actions_service') THEN
    CREATE POLICY chatbot_actions_service ON chatbot_actions
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
