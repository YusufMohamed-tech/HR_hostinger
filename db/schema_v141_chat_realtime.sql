-- Enable Supabase Realtime for chat tables.
--
-- Without these two steps the Supabase realtime server never emits any
-- change events for chat_conversations or chat_messages, so client-side
-- channel subscriptions connect but never fire.
--
-- REPLICA IDENTITY FULL is required so Supabase can:
--   1. Apply RLS policies to filter events (participant check) before
--      broadcasting to each connected client.
--   2. Support column-level filters (e.g. conversation_id=eq.{id}) on
--      UPDATE and DELETE events where the old row value is needed.

ALTER TABLE public.chat_conversations REPLICA IDENTITY FULL;
ALTER TABLE public.chat_messages      REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
