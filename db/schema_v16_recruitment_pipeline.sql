-- =============================================================
-- Migration v16 — Recruitment Pipeline Enhancement
-- Additive only. Safe to re-run. No data destruction.
-- =============================================================

-- 1. Extend job_postings with new pipeline columns
ALTER TABLE public.job_postings
  ADD COLUMN IF NOT EXISTS created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS employment_type TEXT,
  ADD COLUMN IF NOT EXISTS salary_min      NUMERIC,
  ADD COLUMN IF NOT EXISTS salary_max      NUMERIC,
  ADD COLUMN IF NOT EXISTS deadline        DATE,
  ADD COLUMN IF NOT EXISTS form_schema     JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS public_slug     TEXT;

-- Fast lookup by slug (only non-null slugs are unique)
CREATE UNIQUE INDEX IF NOT EXISTS idx_job_postings_public_slug
  ON public.job_postings (public_slug)
  WHERE public_slug IS NOT NULL;

-- 2. Extend job_applications with candidate & pipeline columns
ALTER TABLE public.job_applications
  ADD COLUMN IF NOT EXISTS candidate_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS answers         JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS cv_url          TEXT,
  ADD COLUMN IF NOT EXISTS stage_history   JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS recruiter_notes TEXT,
  ADD COLUMN IF NOT EXISTS score           NUMERIC;

-- Prevent duplicate applications from the same authenticated candidate
CREATE UNIQUE INDEX IF NOT EXISTS idx_job_applications_unique_candidate_posting
  ON public.job_applications (job_posting_id, candidate_id)
  WHERE candidate_id IS NOT NULL;

-- 3. Extend interviews with scheduling & tracking columns
ALTER TABLE public.interviews
  ADD COLUMN IF NOT EXISTS scheduled_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS location        TEXT,
  ADD COLUMN IF NOT EXISTS type            TEXT,
  ADD COLUMN IF NOT EXISTS feedback        TEXT,
  ADD COLUMN IF NOT EXISTS created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- 4. Add recruitment value to notification_type enum
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'recruitment';
