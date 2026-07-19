-- Private, paginated chat with atomic commands, unread state, moderation, and retention controls.

UPDATE storage.buckets SET public = false WHERE id = 'chat-attachments';

ALTER TABLE public.organization_settings
  ADD COLUMN IF NOT EXISTS chat_retention_days integer NOT NULL DEFAULT 730;
ALTER TABLE public.organization_settings
  DROP CONSTRAINT IF EXISTS organization_settings_chat_retention_days_check,
  ADD CONSTRAINT organization_settings_chat_retention_days_check CHECK (chat_retention_days BETWEEN 30 AND 3650);

ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS moderation_reason text,
  ADD COLUMN IF NOT EXISTS retention_pending_at timestamptz;

CREATE TABLE IF NOT EXISTS public.chat_commands (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  command_type text NOT NULL CHECK (command_type IN ('send_message', 'moderate_message')),
  input_hash text NOT NULL CHECK (length(input_hash) = 64),
  request_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed')),
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (org_id, id)
);
ALTER TABLE public.chat_commands ENABLE ROW LEVEL SECURITY;
CREATE POLICY chat_commands_service_only ON public.chat_commands FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS public.chat_message_moderation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  moderator_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('remove')),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.chat_message_moderation ENABLE ROW LEVEL SECURITY;
CREATE POLICY chat_moderation_admin_select ON public.chat_message_moderation FOR SELECT USING (
  org_id = public.current_org_id() AND public.current_role() IN ('admin', 'hr_admin')
);

CREATE INDEX IF NOT EXISTS chat_messages_page_idx
  ON public.chat_messages(conversation_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS chat_messages_retention_idx
  ON public.chat_messages(org_id, created_at) WHERE retention_pending_at IS NULL;

CREATE OR REPLACE FUNCTION public.send_chat_message(
  p_org_id uuid, p_actor_user_id uuid, p_request_id uuid, p_command_id uuid,
  p_conversation_id uuid, p_type text, p_title text, p_participant_user_ids uuid[],
  p_body text, p_attachments jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor_role_value text;
  actor_employee_id uuid;
  conversation_row public.chat_conversations%ROWTYPE;
  message_row public.chat_messages%ROWTYPE;
  input_value jsonb;
  input_hash_value text;
  command_row public.chat_commands%ROWTYPE;
  participant_ids uuid[];
  event_payload jsonb;
  event_id uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  SELECT member.role::text INTO actor_role_value FROM public.org_members member
    WHERE member.org_id = p_org_id AND member.user_id = p_actor_user_id;
  IF actor_role_value IS NULL THEN RAISE EXCEPTION 'Active organization membership is required.' USING ERRCODE = '42501'; END IF;
  IF p_type NOT IN ('direct', 'group') OR length(COALESCE(p_body, '')) > 4000
     OR jsonb_typeof(COALESCE(p_attachments, '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(COALESCE(p_attachments, '[]'::jsonb)) > 10 THEN
    RAISE EXCEPTION 'Chat message input is invalid.' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(p_body), '') IS NULL AND jsonb_array_length(COALESCE(p_attachments, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'Message text or an attachment is required.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p_attachments, '[]'::jsonb)) attachment
    WHERE attachment->>'scan_status' <> 'clean' OR attachment->>'path' NOT LIKE p_org_id::text || '/' || p_conversation_id::text || '/%') THEN
    RAISE EXCEPTION 'Every chat attachment must be scanned and tenant scoped.' USING ERRCODE = '23514';
  END IF;
  input_value := jsonb_build_object('conversation_id', p_conversation_id, 'type', p_type,
    'title', NULLIF(btrim(p_title), ''), 'participants', p_participant_user_ids,
    'body', NULLIF(btrim(p_body), ''), 'attachments', COALESCE(p_attachments, '[]'::jsonb));
  input_hash_value := encode(digest(input_value::text, 'sha256'), 'hex');
  INSERT INTO public.chat_commands (id, org_id, actor_user_id, command_type, input_hash, request_id)
  VALUES (p_command_id, p_org_id, p_actor_user_id, 'send_message', input_hash_value, p_request_id)
  ON CONFLICT (id) DO NOTHING;
  SELECT * INTO command_row FROM public.chat_commands WHERE id = p_command_id FOR UPDATE;
  IF command_row.org_id IS DISTINCT FROM p_org_id OR command_row.actor_user_id IS DISTINCT FROM p_actor_user_id
     OR command_row.input_hash IS DISTINCT FROM input_hash_value THEN
    RAISE EXCEPTION 'Chat command id was reused with different input.' USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN RETURN command_row.result; END IF;

  SELECT * INTO conversation_row FROM public.chat_conversations
    WHERE org_id = p_org_id AND id = p_conversation_id FOR UPDATE;
  IF conversation_row.id IS NULL THEN
    SELECT array_agg(DISTINCT value ORDER BY value) INTO participant_ids
    FROM unnest(array_append(COALESCE(p_participant_user_ids, '{}'::uuid[]), p_actor_user_id)) value;
    IF cardinality(participant_ids) < 2 OR cardinality(participant_ids) > 100
       OR (p_type = 'direct' AND cardinality(participant_ids) <> 2)
       OR (p_type = 'group' AND actor_role_value NOT IN ('admin', 'super_admin', 'hr_admin')) THEN
      RAISE EXCEPTION 'Conversation participants or group permission are invalid.' USING ERRCODE = '42501';
    END IF;
    IF (SELECT count(*) FROM public.org_members member WHERE member.org_id = p_org_id
      AND member.user_id = ANY(participant_ids)) <> cardinality(participant_ids) THEN
      RAISE EXCEPTION 'All chat participants must belong to the same organization.' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.chat_conversations (id, org_id, type, title, created_by)
    VALUES (p_conversation_id, p_org_id, p_type,
      CASE WHEN p_type = 'group' THEN COALESCE(NULLIF(left(btrim(p_title), 200), ''), 'New group') ELSE NULL END,
      p_actor_user_id) RETURNING * INTO conversation_row;
    INSERT INTO public.chat_participants (conversation_id, org_id, user_id, employee_id, added_by, last_read_at)
    SELECT conversation_row.id, p_org_id, participant_user_id, employee.id, p_actor_user_id,
      CASE WHEN participant_user_id = p_actor_user_id THEN now() ELSE NULL END
    FROM unnest(participant_ids) participant_user_id
    LEFT JOIN public.employees employee ON employee.org_id = p_org_id AND employee.user_id = participant_user_id;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.chat_participants participant
      WHERE participant.org_id = p_org_id AND participant.conversation_id = conversation_row.id
        AND participant.user_id = p_actor_user_id) THEN
      RAISE EXCEPTION 'The actor is not a conversation participant.' USING ERRCODE = '42501';
    END IF;
    SELECT array_agg(participant.user_id ORDER BY participant.user_id) INTO participant_ids
    FROM public.chat_participants participant WHERE participant.org_id = p_org_id
      AND participant.conversation_id = conversation_row.id;
  END IF;
  SELECT id INTO actor_employee_id FROM public.employees WHERE org_id = p_org_id AND user_id = p_actor_user_id;
  INSERT INTO public.chat_messages (conversation_id, org_id, sender_user_id, sender_employee_id, body, attachments)
  VALUES (conversation_row.id, p_org_id, p_actor_user_id, actor_employee_id,
    NULLIF(left(btrim(p_body), 4000), ''), COALESCE(p_attachments, '[]'::jsonb))
  RETURNING * INTO message_row;
  UPDATE public.chat_conversations SET updated_at = message_row.created_at WHERE id = conversation_row.id;
  UPDATE public.chat_participants SET last_read_at = message_row.created_at
    WHERE org_id = p_org_id AND conversation_id = conversation_row.id AND user_id = p_actor_user_id;
  event_payload := jsonb_build_object('event_type', 'chat.message_sent', 'conversation_id', conversation_row.id,
    'message_id', message_row.id, 'sender_user_id', p_actor_user_id,
    'recipient_user_ids', to_jsonb(array_remove(participant_ids, p_actor_user_id)),
    'body_preview', left(COALESCE(message_row.body, 'Sent an attachment'), 200));
  INSERT INTO public.business_events (org_id, source_type, business_key, payload, payload_hash, status,
    request_id, actor_user_id, occurred_at, processed_at)
  VALUES (p_org_id, 'chat', 'message:' || p_command_id::text, event_payload,
    encode(digest(event_payload::text, 'sha256'), 'hex'), 'completed', p_request_id, p_actor_user_id, now(), now())
  RETURNING id INTO event_id;
  INSERT INTO public.event_outbox (org_id, business_event_id, topic, payload, payload_hash)
  VALUES (p_org_id, event_id, 'chat.message_sent', event_payload, encode(digest(event_payload::text, 'sha256'), 'hex'));
  UPDATE public.chat_commands SET status = 'completed', completed_at = now(),
    result = jsonb_build_object('conversation_id', conversation_row.id, 'message', to_jsonb(message_row))
  WHERE id = p_command_id;
  RETURN jsonb_build_object('conversation_id', conversation_row.id, 'message', to_jsonb(message_row));
END;
$$;

CREATE OR REPLACE FUNCTION public.chat_inbox_snapshot(p_org_id uuid, p_actor_user_id uuid, p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE result jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.org_members WHERE org_id = p_org_id AND user_id = p_actor_user_id) THEN
    RAISE EXCEPTION 'Active organization membership is required.' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(conversation_payload ORDER BY updated_at DESC), '[]'::jsonb) INTO result
  FROM (
    SELECT conversation.updated_at, jsonb_build_object(
      'id', conversation.id, 'org_id', conversation.org_id, 'type', conversation.type,
      'title', conversation.title, 'created_by', conversation.created_by,
      'created_at', conversation.created_at, 'updated_at', conversation.updated_at,
      'participants', COALESCE((SELECT jsonb_agg(to_jsonb(participant) || jsonb_build_object('user', jsonb_build_object(
        'org_id', participant.org_id, 'user_id', participant.user_id, 'employee_id', employee.id,
        'role', member.role, 'full_name', COALESCE(employee.full_name, profile.full_name, profile.email, 'User'),
        'email', profile.email, 'title', COALESCE(employee.job_title, profile.title),
        'employee_code', employee.employee_code, 'status', COALESCE(profile.account_status, employee.status::text, 'active')
      ))) FROM public.chat_participants participant
        LEFT JOIN public.org_members member ON member.org_id = p_org_id AND member.user_id = participant.user_id
        LEFT JOIN public.profiles profile ON profile.org_id = p_org_id AND profile.user_id = participant.user_id
        LEFT JOIN public.employees employee ON employee.org_id = p_org_id AND employee.user_id = participant.user_id
        WHERE participant.org_id = p_org_id AND participant.conversation_id = conversation.id), '[]'::jsonb),
      'latest_message', (SELECT to_jsonb(message) FROM public.chat_messages message
        WHERE message.org_id = p_org_id AND message.conversation_id = conversation.id
        ORDER BY message.created_at DESC, message.id DESC LIMIT 1),
      'unread_count', (SELECT count(*) FROM public.chat_messages message
        WHERE message.org_id = p_org_id AND message.conversation_id = conversation.id
          AND message.sender_user_id IS DISTINCT FROM p_actor_user_id
          AND message.created_at > COALESCE(mine.last_read_at, '-infinity'::timestamptz))
    ) AS conversation_payload
    FROM public.chat_conversations conversation
    JOIN public.chat_participants mine ON mine.org_id = p_org_id AND mine.conversation_id = conversation.id
      AND mine.user_id = p_actor_user_id
    WHERE conversation.org_id = p_org_id
    ORDER BY conversation.updated_at DESC LIMIT LEAST(GREATEST(p_limit, 1), 100)
  ) inbox;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.chat_message_page(
  p_org_id uuid, p_actor_user_id uuid, p_conversation_id uuid,
  p_before timestamptz DEFAULT NULL, p_before_id uuid DEFAULT NULL, p_limit integer DEFAULT 50
)
RETURNS SETOF public.chat_messages LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.chat_participants participant WHERE participant.org_id = p_org_id
    AND participant.conversation_id = p_conversation_id AND participant.user_id = p_actor_user_id) THEN
    RAISE EXCEPTION 'Conversation access is required.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT message.* FROM public.chat_messages message
  WHERE message.org_id = p_org_id AND message.conversation_id = p_conversation_id
    AND (p_before IS NULL OR message.created_at < p_before
      OR (message.created_at = p_before AND p_before_id IS NOT NULL AND message.id < p_before_id))
  ORDER BY message.created_at DESC, message.id DESC LIMIT LEAST(GREATEST(p_limit, 1), 100);
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_chat_conversation_read(
  p_org_id uuid, p_actor_user_id uuid, p_conversation_id uuid
)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE read_at_value timestamptz := now();
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  UPDATE public.chat_participants SET last_read_at = read_at_value WHERE org_id = p_org_id
    AND conversation_id = p_conversation_id AND user_id = p_actor_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversation access is required.' USING ERRCODE = '42501'; END IF;
  RETURN read_at_value;
END;
$$;

CREATE OR REPLACE FUNCTION public.moderate_chat_message(
  p_org_id uuid, p_actor_user_id uuid, p_request_id uuid, p_command_id uuid,
  p_message_id uuid, p_reason text
)
RETURNS SETOF public.chat_messages LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE message_row public.chat_messages%ROWTYPE; actor_role_value text; input_hash_value text; command_row public.chat_commands%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  SELECT role::text INTO actor_role_value FROM public.org_members WHERE org_id = p_org_id AND user_id = p_actor_user_id
    AND role::text IN ('admin', 'hr_admin');
  IF actor_role_value IS NULL OR length(btrim(p_reason)) < 3 THEN RAISE EXCEPTION 'Chat moderation access and reason are required.' USING ERRCODE = '42501'; END IF;
  input_hash_value := encode(digest(jsonb_build_object('message_id', p_message_id, 'reason', btrim(p_reason))::text, 'sha256'), 'hex');
  INSERT INTO public.chat_commands (id, org_id, actor_user_id, command_type, input_hash, request_id)
  VALUES (p_command_id, p_org_id, p_actor_user_id, 'moderate_message', input_hash_value, p_request_id) ON CONFLICT (id) DO NOTHING;
  SELECT * INTO command_row FROM public.chat_commands WHERE id = p_command_id FOR UPDATE;
  IF command_row.input_hash IS DISTINCT FROM input_hash_value OR command_row.org_id IS DISTINCT FROM p_org_id THEN
    RAISE EXCEPTION 'Chat command id was reused with different input.' USING ERRCODE = '23505';
  END IF;
  SELECT * INTO message_row FROM public.chat_messages WHERE org_id = p_org_id AND id = p_message_id FOR UPDATE;
  IF message_row.id IS NULL THEN RAISE EXCEPTION 'Chat message was not found.' USING ERRCODE = 'P0002'; END IF;
  IF command_row.status <> 'completed' AND message_row.deleted_at IS NULL THEN
    UPDATE public.chat_messages SET deleted_at = now(), deleted_by = p_actor_user_id,
      moderation_reason = left(btrim(p_reason), 2000), body = NULL
    WHERE id = message_row.id RETURNING * INTO message_row;
    INSERT INTO public.chat_message_moderation (org_id, message_id, conversation_id, moderator_user_id, action, reason)
    VALUES (p_org_id, message_row.id, message_row.conversation_id, p_actor_user_id, 'remove', left(btrim(p_reason), 2000));
    INSERT INTO public.operational_audit_logs (org_id, request_id, actor_user_id, actor_role, action,
      target_type, target_id, outcome, status_code, metadata)
    VALUES (p_org_id, p_request_id, p_actor_user_id, actor_role_value, 'chat.message_removed',
      'chat_messages', message_row.id::text, 'success', 200, jsonb_build_object('reason', left(btrim(p_reason), 2000)));
    UPDATE public.chat_commands SET status = 'completed', completed_at = now(), result = to_jsonb(message_row) WHERE id = p_command_id;
  END IF;
  RETURN NEXT message_row;
END;
$$;

REVOKE ALL ON FUNCTION public.send_chat_message(uuid, uuid, uuid, uuid, uuid, text, text, uuid[], text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chat_inbox_snapshot(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chat_message_page(uuid, uuid, uuid, timestamptz, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_chat_conversation_read(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.moderate_chat_message(uuid, uuid, uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_chat_message(uuid, uuid, uuid, uuid, uuid, text, text, uuid[], text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.chat_inbox_snapshot(uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.chat_message_page(uuid, uuid, uuid, timestamptz, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_chat_conversation_read(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.moderate_chat_message(uuid, uuid, uuid, uuid, uuid, text) TO service_role;
