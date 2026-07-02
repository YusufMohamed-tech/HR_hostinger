-- LMS v44 — Udacity-style classroom experience and professional course studio.
-- Additive and production-safe. Do not apply with schema reset commands.
-- Depends on db/schema_v43_lms_module.sql (tables, RLS helpers, lms-content bucket).

-- ============================================================================
-- 1. Additive columns on existing v43 tables (studio + syllabus enrichment)
-- ============================================================================

ALTER TABLE public.lms_courses
  ADD COLUMN IF NOT EXISTS subtitle text,
  ADD COLUMN IF NOT EXISTS target_audience text,
  ADD COLUMN IF NOT EXISTS prerequisites text,
  ADD COLUMN IF NOT EXISTS learning_outcomes jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS skills_gained jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'ar',
  ADD COLUMN IF NOT EXISTS experience_type text NOT NULL DEFAULT 'course'
    CHECK (experience_type IN ('course', 'program')),
  ADD COLUMN IF NOT EXISTS certificate_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS certificate_title text,
  ADD COLUMN IF NOT EXISTS certificate_description text,
  ADD COLUMN IF NOT EXISTS certificate_signatory text;

ALTER TABLE public.lms_course_sections
  ADD COLUMN IF NOT EXISTS section_type text NOT NULL DEFAULT 'module'
    CHECK (section_type IN ('part', 'module', 'section')),
  ADD COLUMN IF NOT EXISTS parent_section_id uuid REFERENCES public.lms_course_sections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS estimated_minutes integer,
  ADD COLUMN IF NOT EXISTS is_milestone boolean NOT NULL DEFAULT false;

ALTER TABLE public.lms_lessons
  ADD COLUMN IF NOT EXISTS learning_unit_type text NOT NULL DEFAULT 'lesson'
    CHECK (learning_unit_type IN ('lesson', 'checkpoint', 'resource')),
  ADD COLUMN IF NOT EXISTS display_mode text NOT NULL DEFAULT 'article'
    CHECK (display_mode IN ('article', 'video', 'document', 'external_link', 'mixed'));

ALTER TABLE public.lms_tasks
  ADD COLUMN IF NOT EXISTS why_it_matters text,
  ADD COLUMN IF NOT EXISTS estimated_minutes integer;

-- ============================================================================
-- 2. Rubric model (professional project review)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.lms_project_rubrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES public.lms_tasks(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.lms_courses(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  total_points numeric(8,2) NOT NULL DEFAULT 0 CHECK (total_points >= 0),
  pass_points numeric(8,2) NOT NULL DEFAULT 0 CHECK (pass_points >= 0),
  created_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, task_id)
);

CREATE TABLE IF NOT EXISTS public.lms_project_rubric_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  rubric_id uuid NOT NULL REFERENCES public.lms_project_rubrics(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES public.lms_tasks(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.lms_courses(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  passing_criteria text,
  points numeric(8,2) NOT NULL DEFAULT 1 CHECK (points >= 0),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lms_project_review_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  review_id uuid NOT NULL REFERENCES public.lms_task_reviews(id) ON DELETE CASCADE,
  submission_id uuid NOT NULL REFERENCES public.lms_task_submissions(id) ON DELETE CASCADE,
  rubric_item_id uuid NOT NULL REFERENCES public.lms_project_rubric_items(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES public.lms_tasks(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.lms_courses(id) ON DELETE CASCADE,
  score numeric(8,2) NOT NULL DEFAULT 0 CHECK (score >= 0),
  passed boolean NOT NULL DEFAULT false,
  feedback text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 3. Learner classroom state (continue, notes, bookmarks)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.lms_learner_workspace_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  enrollment_id uuid NOT NULL REFERENCES public.lms_enrollments(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  last_lesson_id uuid REFERENCES public.lms_lessons(id) ON DELETE SET NULL,
  last_quiz_id uuid REFERENCES public.lms_quizzes(id) ON DELETE SET NULL,
  last_task_id uuid REFERENCES public.lms_tasks(id) ON DELETE SET NULL,
  last_route text,
  current_tab text,
  state_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, enrollment_id, employee_id)
);

CREATE TABLE IF NOT EXISTS public.lms_learner_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  enrollment_id uuid NOT NULL REFERENCES public.lms_enrollments(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.lms_courses(id) ON DELETE CASCADE,
  lesson_id uuid REFERENCES public.lms_lessons(id) ON DELETE SET NULL,
  task_id uuid REFERENCES public.lms_tasks(id) ON DELETE SET NULL,
  quiz_id uuid REFERENCES public.lms_quizzes(id) ON DELETE SET NULL,
  title text,
  body text NOT NULL,
  is_private boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lms_learner_bookmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  enrollment_id uuid NOT NULL REFERENCES public.lms_enrollments(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.lms_courses(id) ON DELETE CASCADE,
  lesson_id uuid REFERENCES public.lms_lessons(id) ON DELETE SET NULL,
  task_id uuid REFERENCES public.lms_tasks(id) ON DELETE SET NULL,
  quiz_id uuid REFERENCES public.lms_quizzes(id) ON DELETE SET NULL,
  bookmark_type text NOT NULL DEFAULT 'lesson'
    CHECK (bookmark_type IN ('lesson', 'task', 'quiz', 'resource')),
  label text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 4. Deadlines and activity events
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.lms_learning_deadlines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  enrollment_id uuid NOT NULL REFERENCES public.lms_enrollments(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.lms_courses(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  source_type text NOT NULL DEFAULT 'course'
    CHECK (source_type IN ('course', 'lesson', 'quiz', 'task', 'certificate')),
  source_id uuid,
  label text NOT NULL,
  due_at timestamptz,
  status text NOT NULL DEFAULT 'upcoming'
    CHECK (status IN ('upcoming', 'due_soon', 'overdue', 'completed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lms_learner_activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  enrollment_id uuid NOT NULL REFERENCES public.lms_enrollments(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.lms_courses(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  source_type text,
  source_id uuid,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 5. Workspace configs and reusable course resources
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.lms_workspace_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.lms_courses(id) ON DELETE CASCADE,
  task_id uuid REFERENCES public.lms_tasks(id) ON DELETE CASCADE,
  workspace_type text NOT NULL DEFAULT 'instructions_only'
    CHECK (workspace_type IN ('none', 'external_link', 'instructions_only')),
  external_url text,
  instructions text,
  created_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, course_id, task_id)
);

CREATE TABLE IF NOT EXISTS public.lms_course_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.lms_courses(id) ON DELETE CASCADE,
  lesson_id uuid REFERENCES public.lms_lessons(id) ON DELETE SET NULL,
  task_id uuid REFERENCES public.lms_tasks(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  resource_type text NOT NULL DEFAULT 'document'
    CHECK (resource_type IN ('document', 'video', 'image', 'spreadsheet', 'template', 'external_link', 'file')),
  storage_path text,
  external_url text,
  mime_type text,
  size_bytes bigint NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 6. Indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_lms_rubrics_task ON public.lms_project_rubrics(org_id, task_id, course_id);
CREATE INDEX IF NOT EXISTS idx_lms_rubric_items_rubric_sort ON public.lms_project_rubric_items(org_id, rubric_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_lms_review_items_review ON public.lms_project_review_items(org_id, review_id, submission_id);
CREATE INDEX IF NOT EXISTS idx_lms_workspace_state_enrollment ON public.lms_learner_workspace_state(org_id, enrollment_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_lms_notes_enrollment ON public.lms_learner_notes(org_id, enrollment_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_lms_notes_lesson ON public.lms_learner_notes(org_id, lesson_id);
CREATE INDEX IF NOT EXISTS idx_lms_bookmarks_enrollment ON public.lms_learner_bookmarks(org_id, enrollment_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_lms_deadlines_enrollment ON public.lms_learning_deadlines(org_id, enrollment_id, status);
CREATE INDEX IF NOT EXISTS idx_lms_deadlines_employee_due ON public.lms_learning_deadlines(org_id, employee_id, due_at);
CREATE INDEX IF NOT EXISTS idx_lms_activity_enrollment ON public.lms_learner_activity_events(org_id, enrollment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lms_activity_employee ON public.lms_learner_activity_events(org_id, employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lms_workspace_configs_course ON public.lms_workspace_configs(org_id, course_id, task_id);
CREATE INDEX IF NOT EXISTS idx_lms_course_resources_course ON public.lms_course_resources(org_id, course_id, is_active);
CREATE INDEX IF NOT EXISTS idx_lms_sections_parent ON public.lms_course_sections(org_id, parent_section_id);

-- ============================================================================
-- 7. RLS helper for private learner ownership
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lms_owns_enrollment(p_org_id uuid, p_enrollment_id uuid)
RETURNS boolean AS $$
  SELECT auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM public.lms_enrollments e
      WHERE e.org_id = p_org_id
        AND e.id = p_enrollment_id
        AND e.employee_id = public.current_employee_id()
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ============================================================================
-- 8. Enable RLS
-- ============================================================================

ALTER TABLE public.lms_project_rubrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lms_project_rubric_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lms_project_review_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lms_learner_workspace_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lms_learner_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lms_learner_bookmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lms_learning_deadlines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lms_learner_activity_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lms_workspace_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lms_course_resources ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 9. Policies
-- ============================================================================

-- Rubrics: read by anyone who can access the course, write by content managers.
DROP POLICY IF EXISTS lms_rubrics_select ON public.lms_project_rubrics;
CREATE POLICY lms_rubrics_select ON public.lms_project_rubrics
  FOR SELECT USING (public.lms_can_access_course(org_id, course_id));
DROP POLICY IF EXISTS lms_rubrics_write ON public.lms_project_rubrics;
CREATE POLICY lms_rubrics_write ON public.lms_project_rubrics
  FOR ALL USING (public.lms_can_manage_course(org_id, course_id, 'edit_content'))
  WITH CHECK (public.lms_can_manage_course(org_id, course_id, 'edit_content'));

DROP POLICY IF EXISTS lms_rubric_items_select ON public.lms_project_rubric_items;
CREATE POLICY lms_rubric_items_select ON public.lms_project_rubric_items
  FOR SELECT USING (public.lms_can_access_course(org_id, course_id));
DROP POLICY IF EXISTS lms_rubric_items_write ON public.lms_project_rubric_items;
CREATE POLICY lms_rubric_items_write ON public.lms_project_rubric_items
  FOR ALL USING (public.lms_can_manage_course(org_id, course_id, 'edit_content'))
  WITH CHECK (public.lms_can_manage_course(org_id, course_id, 'edit_content'));

-- Review items: reviewers write, learner reads own review scores.
DROP POLICY IF EXISTS lms_review_items_select ON public.lms_project_review_items;
CREATE POLICY lms_review_items_select ON public.lms_project_review_items
  FOR SELECT USING (
    public.lms_can_review_submission(org_id, submission_id)
    OR EXISTS (
      SELECT 1 FROM public.lms_task_submissions s
      WHERE s.id = submission_id AND s.employee_id = public.current_employee_id()
    )
  );
DROP POLICY IF EXISTS lms_review_items_write ON public.lms_project_review_items;
CREATE POLICY lms_review_items_write ON public.lms_project_review_items
  FOR ALL USING (public.lms_can_review_submission(org_id, submission_id))
  WITH CHECK (public.lms_can_review_submission(org_id, submission_id));

-- Private learner state: owner only.
DROP POLICY IF EXISTS lms_workspace_state_rw ON public.lms_learner_workspace_state;
CREATE POLICY lms_workspace_state_rw ON public.lms_learner_workspace_state
  FOR ALL USING (auth.role() = 'service_role' OR employee_id = public.current_employee_id())
  WITH CHECK (
    auth.role() = 'service_role'
    OR (employee_id = public.current_employee_id() AND public.lms_owns_enrollment(org_id, enrollment_id))
  );

DROP POLICY IF EXISTS lms_learner_notes_rw ON public.lms_learner_notes;
CREATE POLICY lms_learner_notes_rw ON public.lms_learner_notes
  FOR ALL USING (auth.role() = 'service_role' OR employee_id = public.current_employee_id())
  WITH CHECK (
    auth.role() = 'service_role'
    OR (employee_id = public.current_employee_id() AND public.lms_owns_enrollment(org_id, enrollment_id))
  );

DROP POLICY IF EXISTS lms_learner_bookmarks_rw ON public.lms_learner_bookmarks;
CREATE POLICY lms_learner_bookmarks_rw ON public.lms_learner_bookmarks
  FOR ALL USING (auth.role() = 'service_role' OR employee_id = public.current_employee_id())
  WITH CHECK (
    auth.role() = 'service_role'
    OR (employee_id = public.current_employee_id() AND public.lms_owns_enrollment(org_id, enrollment_id))
  );

-- Deadlines: owner + management/scope read; management/service write.
DROP POLICY IF EXISTS lms_deadlines_select ON public.lms_learning_deadlines;
CREATE POLICY lms_deadlines_select ON public.lms_learning_deadlines
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR employee_id = public.current_employee_id()
    OR public.lms_is_lms_manager(org_id)
    OR public.lms_training_manager_scope_employee(org_id, employee_id)
  );
DROP POLICY IF EXISTS lms_deadlines_write ON public.lms_learning_deadlines;
CREATE POLICY lms_deadlines_write ON public.lms_learning_deadlines
  FOR ALL USING (
    auth.role() = 'service_role'
    OR public.lms_is_lms_manager(org_id)
    OR public.lms_training_manager_scope_employee(org_id, employee_id)
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR public.lms_is_lms_manager(org_id)
    OR public.lms_training_manager_scope_employee(org_id, employee_id)
  );

-- Activity events: owner inserts own; owner + management/scope read.
DROP POLICY IF EXISTS lms_activity_select ON public.lms_learner_activity_events;
CREATE POLICY lms_activity_select ON public.lms_learner_activity_events
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR employee_id = public.current_employee_id()
    OR public.lms_is_lms_manager(org_id)
    OR public.lms_training_manager_scope_employee(org_id, employee_id)
  );
DROP POLICY IF EXISTS lms_activity_insert ON public.lms_learner_activity_events;
CREATE POLICY lms_activity_insert ON public.lms_learner_activity_events
  FOR INSERT WITH CHECK (
    auth.role() = 'service_role'
    OR (employee_id = public.current_employee_id() AND public.lms_owns_enrollment(org_id, enrollment_id))
  );

-- Workspace configs: read by course access, write by content managers.
DROP POLICY IF EXISTS lms_workspace_configs_select ON public.lms_workspace_configs;
CREATE POLICY lms_workspace_configs_select ON public.lms_workspace_configs
  FOR SELECT USING (public.lms_can_access_course(org_id, course_id));
DROP POLICY IF EXISTS lms_workspace_configs_write ON public.lms_workspace_configs;
CREATE POLICY lms_workspace_configs_write ON public.lms_workspace_configs
  FOR ALL USING (public.lms_can_manage_course(org_id, course_id, 'edit_content'))
  WITH CHECK (public.lms_can_manage_course(org_id, course_id, 'edit_content'));

-- Course resources: read by course access, write by content managers.
DROP POLICY IF EXISTS lms_course_resources_select ON public.lms_course_resources;
CREATE POLICY lms_course_resources_select ON public.lms_course_resources
  FOR SELECT USING (public.lms_can_access_course(org_id, course_id));
DROP POLICY IF EXISTS lms_course_resources_write ON public.lms_course_resources;
CREATE POLICY lms_course_resources_write ON public.lms_course_resources
  FOR ALL USING (public.lms_can_manage_course(org_id, course_id, 'edit_content'))
  WITH CHECK (public.lms_can_manage_course(org_id, course_id, 'edit_content'));
