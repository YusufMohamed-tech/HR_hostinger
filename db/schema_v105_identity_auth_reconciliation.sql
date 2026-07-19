-- Supabase Auth administration is external to application transactions. Keep a
-- durable desired-state/cleanup ledger and drive Auth changes through the
-- existing retryable outbox instead of best-effort compensation only.

CREATE TABLE IF NOT EXISTS public.identity_auth_sync_jobs(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  target_user_id uuid NOT NULL,
  action text NOT NULL CHECK(action IN('ban','unban','delete')),
  source_type text NOT NULL CHECK(length(btrim(source_type))>0),
  source_id text NOT NULL CHECK(length(btrim(source_id))>0),
  reason text,
  status text NOT NULL DEFAULT 'pending'
    CHECK(status IN('pending','processing','failed','completed','cancelled')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
  available_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  request_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(org_id,target_user_id,action,source_type,source_id)
);

CREATE INDEX IF NOT EXISTS idx_identity_auth_sync_jobs_pending
  ON public.identity_auth_sync_jobs(status,available_at,created_at)
  WHERE status IN('pending','failed','processing');
CREATE INDEX IF NOT EXISTS idx_identity_auth_sync_jobs_user
  ON public.identity_auth_sync_jobs(org_id,target_user_id,created_at DESC);

ALTER TABLE public.identity_auth_sync_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS identity_auth_sync_jobs_service ON public.identity_auth_sync_jobs;
CREATE POLICY identity_auth_sync_jobs_service ON public.identity_auth_sync_jobs
  FOR ALL USING(auth.role()='service_role') WITH CHECK(auth.role()='service_role');

CREATE OR REPLACE FUNCTION public.enqueue_identity_auth_sync_job(
  p_org_id uuid,p_target_user_id uuid,p_action text,p_source_type text,p_source_id text,
  p_reason text DEFAULT NULL,p_actor_user_id uuid DEFAULT NULL,p_request_id uuid DEFAULT NULL,
  p_delay_seconds integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  job_record public.identity_auth_sync_jobs%ROWTYPE;
  inserted_value boolean:=false;
  event_payload jsonb;
  payload_hash_value text;
  event_id_value uuid;
BEGIN
  IF auth.role()<>'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE='42501';
  END IF;
  IF p_org_id IS NULL OR p_target_user_id IS NULL OR p_action NOT IN('ban','unban','delete')
     OR length(btrim(COALESCE(p_source_type,'')))<1 OR length(btrim(COALESCE(p_source_id,'')))<1
     OR COALESCE(p_delay_seconds,-1) NOT BETWEEN 0 AND 86400 THEN
    RAISE EXCEPTION 'Identity Auth sync input is invalid.' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=p_org_id) THEN
    RAISE EXCEPTION 'Identity Auth sync organization was not found.' USING ERRCODE='P0002';
  END IF;
  INSERT INTO public.identity_auth_sync_jobs(
    org_id,target_user_id,action,source_type,source_id,reason,status,available_at,
    actor_user_id,request_id
  ) VALUES(
    p_org_id,p_target_user_id,p_action,btrim(p_source_type),btrim(p_source_id),
    NULLIF(btrim(COALESCE(p_reason,'')),''),'pending',now()+make_interval(secs=>p_delay_seconds),
    p_actor_user_id,p_request_id
  )
  ON CONFLICT(org_id,target_user_id,action,source_type,source_id) DO NOTHING
  RETURNING * INTO job_record;
  inserted_value:=job_record.id IS NOT NULL;
  IF NOT inserted_value THEN
    SELECT * INTO job_record FROM public.identity_auth_sync_jobs
    WHERE org_id=p_org_id AND target_user_id=p_target_user_id AND action=p_action
      AND source_type=btrim(p_source_type) AND source_id=btrim(p_source_id);
  END IF;
  IF inserted_value THEN
    event_payload:=jsonb_build_object(
      'event_type','identity.auth_sync_requested','job_id',job_record.id,'action',p_action,
      'target_user_id',p_target_user_id,'source_type',btrim(p_source_type),
      'source_id',btrim(p_source_id),'reason',job_record.reason,'version',1
    );
    payload_hash_value:=encode(digest(event_payload::text,'sha256'),'hex');
    INSERT INTO public.business_events(
      org_id,source_type,business_key,event_version,payload,payload_hash,status,
      request_id,actor_user_id,occurred_at,processed_at
    ) VALUES(
      p_org_id,'identity_auth_sync','auth-sync:'||job_record.id::text,1,event_payload,
      payload_hash_value,'completed',p_request_id,p_actor_user_id,now(),now()
    ) RETURNING id INTO event_id_value;
    INSERT INTO public.event_outbox(
      org_id,business_event_id,topic,payload,payload_hash,available_at
    ) VALUES(
      p_org_id,event_id_value,'identity.auth_sync_requested',event_payload,payload_hash_value,
      job_record.available_at
    );
  END IF;
  RETURN to_jsonb(job_record);
END;
$$;

CREATE OR REPLACE FUNCTION public.start_identity_auth_sync_job(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE job_record public.identity_auth_sync_jobs%ROWTYPE;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE='42501'; END IF;
  SELECT * INTO job_record FROM public.identity_auth_sync_jobs WHERE id=p_job_id FOR UPDATE;
  IF job_record.id IS NULL THEN RAISE EXCEPTION 'Identity Auth sync job was not found.' USING ERRCODE='P0002'; END IF;
  IF job_record.status IN('completed','cancelled') THEN RETURN to_jsonb(job_record); END IF;
  IF job_record.available_at>now() THEN RAISE EXCEPTION 'Identity Auth sync job is not available yet.' USING ERRCODE='55000'; END IF;
  UPDATE public.identity_auth_sync_jobs SET status='processing',attempts=attempts+1,
    last_error=NULL,updated_at=now() WHERE id=p_job_id RETURNING * INTO job_record;
  RETURN to_jsonb(job_record);
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_identity_auth_sync_job(p_job_id uuid,p_result jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE='42501'; END IF;
  UPDATE public.identity_auth_sync_jobs SET status='completed',result=COALESCE(p_result,'{}'::jsonb),
    last_error=NULL,completed_at=now(),updated_at=now()
  WHERE id=p_job_id AND status<>'cancelled';
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_identity_auth_sync_job(p_job_id uuid,p_error text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE='42501'; END IF;
  UPDATE public.identity_auth_sync_jobs SET status='failed',last_error=left(COALESCE(p_error,'Unknown Auth sync error'),4000),
    updated_at=now() WHERE id=p_job_id AND status NOT IN('completed','cancelled');
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_identity_auth_sync_job(p_job_id uuid,p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE='42501'; END IF;
  UPDATE public.identity_auth_sync_jobs SET status='cancelled',
    result=jsonb_build_object('cancel_reason',NULLIF(btrim(COALESCE(p_reason,'')),'')),
    completed_at=now(),updated_at=now()
  WHERE id=p_job_id AND status IN('pending','failed');
  UPDATE public.event_outbox SET status='completed',sent_at=now(),locked_at=NULL,locked_by=NULL,updated_at=now()
  WHERE topic='identity.auth_sync_requested' AND payload->>'job_id'=p_job_id::text
    AND status IN('pending','failed');
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_profile_auth_state_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE desired_action text;
BEGIN
  IF NEW.org_id IS NULL OR NEW.account_status IS NOT DISTINCT FROM OLD.account_status THEN RETURN NEW; END IF;
  IF EXISTS(SELECT 1 FROM public.platform_admins WHERE user_id=NEW.user_id AND status='active') THEN RETURN NEW; END IF;
  desired_action:=CASE WHEN lower(btrim(COALESCE(NEW.account_status,'')))='active' THEN 'unban' ELSE 'ban' END;
  PERFORM public.enqueue_identity_auth_sync_job(
    NEW.org_id,NEW.user_id,desired_action,'profile_account_status',gen_random_uuid()::text,
    'Profile account status changed to '||COALESCE(NEW.account_status,'unknown'),NULL,NULL,0
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_auth_state_sync ON public.profiles;
CREATE TRIGGER trg_profiles_auth_state_sync
  AFTER UPDATE OF account_status ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_profile_auth_state_sync();

REVOKE ALL ON FUNCTION public.enqueue_identity_auth_sync_job(uuid,uuid,text,text,text,text,uuid,uuid,integer)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.start_identity_auth_sync_job(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.complete_identity_auth_sync_job(uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.fail_identity_auth_sync_job(uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cancel_identity_auth_sync_job(uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.enqueue_profile_auth_state_sync() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_identity_auth_sync_job(uuid,uuid,text,text,text,text,uuid,uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.start_identity_auth_sync_job(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_identity_auth_sync_job(uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_identity_auth_sync_job(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_identity_auth_sync_job(uuid,text) TO service_role;
