-- Keep LMS announcement/reply notifications coupled to the source write.
-- The outbox worker may retry delivery, while each source transition owns one
-- stable business event and therefore one notification per recipient.

ALTER TABLE public.lms_course_announcements
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.lms_course_announcements'::regclass
      AND conname = 'lms_course_announcements_version_check'
  ) THEN
    ALTER TABLE public.lms_course_announcements
      ADD CONSTRAINT lms_course_announcements_version_check CHECK (version > 0);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.lms_bump_announcement_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.version := OLD.version + 1;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lms_announcement_version ON public.lms_course_announcements;
CREATE TRIGGER trg_lms_announcement_version
  BEFORE UPDATE ON public.lms_course_announcements
  FOR EACH ROW EXECUTE FUNCTION public.lms_bump_announcement_version();

CREATE OR REPLACE FUNCTION public.lms_emit_community_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  event_topic text;
  event_version_value integer := 1;
  business_key_value text;
  event_payload jsonb;
  payload_hash_value text;
  event_id_value uuid;
  actor_user_id_value uuid;
  post_employee_id_value uuid;
BEGIN
  IF TG_TABLE_NAME = 'lms_course_announcements' THEN
    event_topic := 'lms.announcement_published';
    event_version_value := NEW.version;
    actor_user_id_value := NEW.created_by;
    business_key_value := 'announcement:' || NEW.id::text || ':' || NEW.version::text;
    event_payload := jsonb_build_object(
      'event_type', event_topic,
      'announcement_id', NEW.id,
      'course_id', NEW.course_id,
      'title', NEW.title,
      'operation', lower(TG_OP),
      'version', NEW.version
    );
  ELSIF TG_TABLE_NAME = 'lms_community_comments' THEN
    event_topic := 'lms.community_replied';
    SELECT post.employee_id
      INTO post_employee_id_value
    FROM public.lms_community_posts post
    WHERE post.org_id = NEW.org_id
      AND post.id = NEW.post_id;
    SELECT employee.user_id
      INTO actor_user_id_value
    FROM public.employees employee
    WHERE employee.org_id = NEW.org_id
      AND employee.id = NEW.employee_id;
    business_key_value := 'community-reply:' || NEW.id::text;
    event_payload := jsonb_build_object(
      'event_type', event_topic,
      'comment_id', NEW.id,
      'post_id', NEW.post_id,
      'course_id', NEW.course_id,
      'author_employee_id', NEW.employee_id,
      'post_employee_id', post_employee_id_value,
      'body_preview', left(NEW.body, 160),
      'version', 1
    );
  ELSE
    RETURN NEW;
  END IF;

  payload_hash_value := encode(digest(event_payload::text, 'sha256'), 'hex');
  INSERT INTO public.business_events (
    org_id, source_type, business_key, event_version, payload, payload_hash,
    status, actor_user_id, occurred_at, processed_at
  ) VALUES (
    NEW.org_id, 'lms_community', business_key_value, event_version_value,
    event_payload, payload_hash_value, 'completed', actor_user_id_value, now(), now()
  )
  RETURNING id INTO event_id_value;

  INSERT INTO public.event_outbox (
    org_id, business_event_id, topic, payload, payload_hash
  ) VALUES (
    NEW.org_id, event_id_value, event_topic, event_payload, payload_hash_value
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lms_announcement_event ON public.lms_course_announcements;
CREATE TRIGGER trg_lms_announcement_event
  AFTER INSERT OR UPDATE ON public.lms_course_announcements
  FOR EACH ROW EXECUTE FUNCTION public.lms_emit_community_event();

DROP TRIGGER IF EXISTS trg_lms_community_reply_event ON public.lms_community_comments;
CREATE TRIGGER trg_lms_community_reply_event
  AFTER INSERT ON public.lms_community_comments
  FOR EACH ROW EXECUTE FUNCTION public.lms_emit_community_event();

REVOKE ALL ON FUNCTION public.lms_bump_announcement_version()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lms_emit_community_event()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.lms_emit_community_event() IS
  'Appends a durable LMS announcement/reply outbox event in the source-row transaction.';
