-- Professional internal LMS module. Additive and production-safe.
-- Do not apply with schema reset commands.

ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'lms';

ALTER TABLE public.organization_features
  ADD COLUMN IF NOT EXISTS lms_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE public.organization_features
  ALTER COLUMN enabled_modules SET DEFAULT '["hr", "sales", "recruitment", "accounting", "chat", "assets", "payroll", "personnel", "lms"]'::jsonb;

UPDATE public.organization_features
SET enabled_modules = CASE
    WHEN enabled_modules ? 'lms' THEN enabled_modules
    ELSE enabled_modules || '["lms"]'::jsonb
  END,
  lms_enabled = COALESCE(lms_enabled, true),
  updated_at = now();

UPDATE public.plans
SET features = features || '{"lms": true}'::jsonb
WHERE NOT (features ? 'lms');

CREATE TABLE IF NOT EXISTS public.lms_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  color text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE TABLE IF NOT EXISTS public.lms_courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  category_id uuid REFERENCES public.lms_categories(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  thumbnail_path text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  visibility text NOT NULL DEFAULT 'assigned_only' CHECK (visibility IN ('assigned_only', 'catalog')),
  difficulty text NOT NULL DEFAULT 'beginner' CHECK (difficulty IN ('beginner', 'intermediate', 'advanced')),
  estimated_minutes integer NOT NULL DEFAULT 0 CHECK (estimated_minutes >= 0),
  passing_score numeric(5,2) NOT NULL DEFAULT 70 CHECK (passing_score >= 0 AND passing_score <= 100),
  requires_quiz_pass boolean NOT NULL DEFAULT false,
  requires_task_pass boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  published_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lms_course_instructors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.lms_courses(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  instructor_type text NOT NULL DEFAULT 'primary_instructor'
    CHECK (instructor_type IN ('primary_instructor', 'assistant_instructor', 'reviewer')),
  can_edit_content boolean NOT NULL DEFAULT false,
  can_review_tasks boolean NOT NULL DEFAULT false,
  can_moderate_community boolean NOT NULL DEFAULT false,
  assigned_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, course_id, employee_id)
);

CREATE TABLE IF NOT EXISTS public.lms_course_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.lms_courses(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lms_lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.lms_courses(id) ON DELETE CASCADE,
  section_id uuid REFERENCES public.lms_course_sections(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  lesson_type text NOT NULL DEFAULT 'text' CHECK (lesson_type IN ('text', 'video', 'file', 'document', 'link')),
  content text,
  content_url text,
  storage_path text,
  duration_minutes integer NOT NULL DEFAULT 0 CHECK (duration_minutes >= 0),
  sort_order integer NOT NULL DEFAULT 0,
  is_required boolean NOT NULL DEFAULT true,
  is_preview boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lms_lesson_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lesson_id uuid NOT NULL REFERENCES public.lms_lessons(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.lms_courses(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_type text,
  mime_type text,
  storage_path text NOT NULL,
  size_bytes bigint NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  uploaded_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lms_quizzes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.lms_courses(id) ON DELETE CASCADE,
  lesson_id uuid REFERENCES public.lms_lessons(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  passing_score numeric(5,2) NOT NULL DEFAULT 70 CHECK (passing_score >= 0 AND passing_score <= 100),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  time_limit_minutes integer CHECK (time_limit_minutes IS NULL OR time_limit_minutes > 0),
  is_required boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lms_quiz_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  quiz_id uuid NOT NULL REFERENCES public.lms_quizzes(id) ON DELETE CASCADE,
  question_text text NOT NULL,
  question_type text NOT NULL DEFAULT 'single_choice'
    CHECK (question_type IN ('single_choice', 'multiple_choice', 'true_false', 'short_answer')),
  options_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  correct_answer_json jsonb NOT NULL DEFAULT 'null'::jsonb,
  points numeric(8,2) NOT NULL DEFAULT 1 CHECK (points >= 0),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lms_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.lms_courses(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  due_date date,
  status text NOT NULL DEFAULT 'assigned'
    CHECK (status IN ('assigned', 'in_progress', 'completed', 'overdue', 'cancelled')),
  progress_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (progress_percent >= 0 AND progress_percent <= 100),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_lms_active_enrollment
  ON public.lms_enrollments(org_id, course_id, employee_id)
  WHERE status <> 'cancelled';

CREATE TABLE IF NOT EXISTS public.lms_lesson_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  enrollment_id uuid NOT NULL REFERENCES public.lms_enrollments(id) ON DELETE CASCADE,
  lesson_id uuid NOT NULL REFERENCES public.lms_lessons(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'completed')),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, enrollment_id, lesson_id)
);

CREATE TABLE IF NOT EXISTS public.lms_quiz_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  enrollment_id uuid NOT NULL REFERENCES public.lms_enrollments(id) ON DELETE CASCADE,
  quiz_id uuid NOT NULL REFERENCES public.lms_quizzes(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  answers_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  score numeric(5,2) NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 100),
  passed boolean NOT NULL DEFAULT false,
  started_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, enrollment_id, quiz_id, attempt_number)
);

CREATE TABLE IF NOT EXISTS public.lms_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.lms_courses(id) ON DELETE CASCADE,
  lesson_id uuid REFERENCES public.lms_lessons(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  task_type text NOT NULL DEFAULT 'text_response'
    CHECK (task_type IN ('text_response', 'file_upload', 'link_submission', 'mixed')),
  instructions text,
  due_date date,
  max_score numeric(8,2) NOT NULL DEFAULT 100 CHECK (max_score > 0),
  pass_score numeric(8,2) NOT NULL DEFAULT 70 CHECK (pass_score >= 0),
  is_required boolean NOT NULL DEFAULT true,
  allow_resubmission boolean NOT NULL DEFAULT true,
  late_submission_allowed boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lms_task_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES public.lms_tasks(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.lms_courses(id) ON DELETE CASCADE,
  enrollment_id uuid NOT NULL REFERENCES public.lms_enrollments(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  submission_text text,
  submission_url text,
  storage_path text,
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('not_submitted', 'submitted', 'late', 'reviewed', 'accepted', 'rejected', 'needs_revision')),
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, task_id, enrollment_id, employee_id)
);

CREATE TABLE IF NOT EXISTS public.lms_task_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  submission_id uuid NOT NULL REFERENCES public.lms_task_submissions(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES public.lms_tasks(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.lms_courses(id) ON DELETE CASCADE,
  reviewer_employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  score numeric(8,2) NOT NULL DEFAULT 0 CHECK (score >= 0),
  passed boolean NOT NULL DEFAULT false,
  feedback text,
  review_status text NOT NULL CHECK (review_status IN ('accepted', 'rejected', 'needs_revision')),
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lms_learning_paths (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lms_learning_path_courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  learning_path_id uuid NOT NULL REFERENCES public.lms_learning_paths(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.lms_courses(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, learning_path_id, course_id)
);

CREATE TABLE IF NOT EXISTS public.lms_assignment_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  course_id uuid REFERENCES public.lms_courses(id) ON DELETE CASCADE,
  learning_path_id uuid REFERENCES public.lms_learning_paths(id) ON DELETE CASCADE,
  assignment_type text NOT NULL CHECK (assignment_type IN ('employee', 'department', 'team', 'location', 'role', 'all')),
  target_id text,
  due_date date,
  assigned_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (course_id IS NOT NULL OR learning_path_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS public.lms_certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  enrollment_id uuid NOT NULL REFERENCES public.lms_enrollments(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.lms_courses(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  certificate_number text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  issued_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, enrollment_id),
  UNIQUE (org_id, certificate_number)
);

CREATE TABLE IF NOT EXISTS public.lms_course_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  enrollment_id uuid NOT NULL REFERENCES public.lms_enrollments(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.lms_courses(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, enrollment_id)
);

CREATE TABLE IF NOT EXISTS public.lms_course_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.lms_courses(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  pinned boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lms_community_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.lms_courses(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  post_type text NOT NULL DEFAULT 'discussion' CHECK (post_type IN ('discussion', 'question', 'announcement')),
  title text,
  body text NOT NULL,
  is_pinned boolean NOT NULL DEFAULT false,
  is_locked boolean NOT NULL DEFAULT false,
  is_hidden boolean NOT NULL DEFAULT false,
  accepted_comment_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lms_community_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES public.lms_community_posts(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.lms_courses(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  body text NOT NULL,
  is_instructor_reply boolean NOT NULL DEFAULT false,
  is_hidden boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lms_community_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  post_id uuid REFERENCES public.lms_community_posts(id) ON DELETE CASCADE,
  comment_id uuid REFERENCES public.lms_community_comments(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  reaction_type text NOT NULL DEFAULT 'like' CHECK (reaction_type IN ('like', 'helpful', 'celebrate')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (post_id IS NOT NULL OR comment_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_lms_post_reaction
  ON public.lms_community_reactions(org_id, post_id, employee_id, reaction_type)
  WHERE post_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_lms_comment_reaction
  ON public.lms_community_reactions(org_id, comment_id, employee_id, reaction_type)
  WHERE comment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.lms_community_post_reads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES public.lms_community_posts(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, post_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_lms_categories_org_active ON public.lms_categories(org_id, is_active);
CREATE INDEX IF NOT EXISTS idx_lms_courses_org_status ON public.lms_courses(org_id, status, visibility);
CREATE INDEX IF NOT EXISTS idx_lms_courses_category ON public.lms_courses(org_id, category_id);
CREATE INDEX IF NOT EXISTS idx_lms_course_instructors_course ON public.lms_course_instructors(org_id, course_id);
CREATE INDEX IF NOT EXISTS idx_lms_course_instructors_employee ON public.lms_course_instructors(org_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_lms_sections_course_sort ON public.lms_course_sections(org_id, course_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_lms_lessons_course_section_sort ON public.lms_lessons(org_id, course_id, section_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_lms_lesson_attachments_lesson ON public.lms_lesson_attachments(org_id, lesson_id, course_id);
CREATE INDEX IF NOT EXISTS idx_lms_quizzes_course ON public.lms_quizzes(org_id, course_id, is_active);
CREATE INDEX IF NOT EXISTS idx_lms_quiz_questions_quiz_sort ON public.lms_quiz_questions(org_id, quiz_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_lms_enrollments_employee ON public.lms_enrollments(org_id, employee_id, status);
CREATE INDEX IF NOT EXISTS idx_lms_enrollments_course ON public.lms_enrollments(org_id, course_id, status);
CREATE INDEX IF NOT EXISTS idx_lms_progress_enrollment ON public.lms_lesson_progress(org_id, enrollment_id, status);
CREATE INDEX IF NOT EXISTS idx_lms_attempts_enrollment_quiz ON public.lms_quiz_attempts(org_id, enrollment_id, quiz_id);
CREATE INDEX IF NOT EXISTS idx_lms_tasks_course_status ON public.lms_tasks(org_id, course_id, lesson_id, status);
CREATE INDEX IF NOT EXISTS idx_lms_submissions_task_employee ON public.lms_task_submissions(org_id, task_id, enrollment_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_lms_reviews_submission_reviewer ON public.lms_task_reviews(org_id, submission_id, reviewer_employee_id);
CREATE INDEX IF NOT EXISTS idx_lms_certificates_employee_course ON public.lms_certificates(org_id, employee_id, course_id);
CREATE INDEX IF NOT EXISTS idx_lms_assignment_rules_org_course_type ON public.lms_assignment_rules(org_id, course_id, assignment_type, is_active);
CREATE INDEX IF NOT EXISTS idx_lms_learning_path_courses_sort ON public.lms_learning_path_courses(org_id, learning_path_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_lms_announcements_course_created ON public.lms_course_announcements(org_id, course_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lms_posts_course_created ON public.lms_community_posts(org_id, course_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lms_comments_post_created ON public.lms_community_comments(org_id, post_id, created_at);
CREATE INDEX IF NOT EXISTS idx_lms_reactions_post ON public.lms_community_reactions(org_id, post_id);
CREATE INDEX IF NOT EXISTS idx_lms_reactions_comment ON public.lms_community_reactions(org_id, comment_id);

CREATE OR REPLACE FUNCTION public.lms_is_lms_manager(p_org_id uuid)
RETURNS boolean AS $$
  SELECT auth.role() = 'service_role'
    OR (
      p_org_id = public.current_org_id()
      AND public.current_role() IN ('super_admin', 'admin', 'hr_admin')
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.lms_training_manager_scope_employee(p_org_id uuid, p_employee_id uuid)
RETURNS boolean AS $$
  SELECT auth.role() = 'service_role'
    OR (
      p_org_id = public.current_org_id()
      AND public.current_role() = 'training_manager'
      AND EXISTS (
        SELECT 1
        FROM public.employees target
        LEFT JOIN public.departments d ON d.id = target.department_id AND d.org_id = target.org_id
        LEFT JOIN public.locations l ON l.id = target.location_id AND l.org_id = target.org_id
        WHERE target.org_id = p_org_id
          AND target.id = p_employee_id
          AND (
            target.manager_id = public.current_employee_id()
            OR d.manager_employee_id = public.current_employee_id()
            OR l.manager_employee_id = public.current_employee_id()
          )
      )
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.lms_is_course_instructor(p_org_id uuid, p_course_id uuid, p_permission text DEFAULT NULL)
RETURNS boolean AS $$
  SELECT auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1
      FROM public.lms_course_instructors instructor
      WHERE instructor.org_id = p_org_id
        AND instructor.course_id = p_course_id
        AND instructor.employee_id = public.current_employee_id()
        AND (
          p_permission IS NULL
          OR (p_permission = 'edit_content' AND instructor.can_edit_content)
          OR (p_permission = 'review_tasks' AND instructor.can_review_tasks)
          OR (p_permission = 'moderate_community' AND instructor.can_moderate_community)
        )
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.lms_can_manage_course(p_org_id uuid, p_course_id uuid, p_permission text DEFAULT 'edit_content')
RETURNS boolean AS $$
  SELECT auth.role() = 'service_role'
    OR public.lms_is_lms_manager(p_org_id)
    OR (
      p_org_id = public.current_org_id()
      AND public.current_role() = 'training_manager'
      AND (
        EXISTS (
          SELECT 1 FROM public.lms_courses c
          WHERE c.org_id = p_org_id AND c.id = p_course_id AND c.created_by = auth.uid()
        )
        OR public.lms_is_course_instructor(p_org_id, p_course_id, p_permission)
      )
    )
    OR public.lms_is_course_instructor(p_org_id, p_course_id, p_permission);
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.lms_can_access_course(p_org_id uuid, p_course_id uuid)
RETURNS boolean AS $$
  SELECT auth.role() = 'service_role'
    OR public.lms_is_lms_manager(p_org_id)
    OR public.lms_can_manage_course(p_org_id, p_course_id, NULL)
    OR EXISTS (
      SELECT 1
      FROM public.lms_courses c
      WHERE c.org_id = p_org_id
        AND c.id = p_course_id
        AND c.status = 'published'
        AND (
          c.visibility = 'catalog'
          OR EXISTS (
            SELECT 1
            FROM public.lms_enrollments e
            WHERE e.org_id = p_org_id
              AND e.course_id = p_course_id
              AND e.employee_id = public.current_employee_id()
              AND e.status <> 'cancelled'
          )
        )
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.lms_can_access_enrollment(p_org_id uuid, p_enrollment_id uuid)
RETURNS boolean AS $$
  SELECT auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1
      FROM public.lms_enrollments e
      WHERE e.org_id = p_org_id
        AND e.id = p_enrollment_id
        AND (
          e.employee_id = public.current_employee_id()
          OR public.lms_is_lms_manager(p_org_id)
          OR public.lms_training_manager_scope_employee(p_org_id, e.employee_id)
          OR public.lms_is_course_instructor(p_org_id, e.course_id, NULL)
        )
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.lms_can_review_submission(p_org_id uuid, p_submission_id uuid)
RETURNS boolean AS $$
  SELECT auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1
      FROM public.lms_task_submissions s
      WHERE s.org_id = p_org_id
        AND s.id = p_submission_id
        AND (
          public.lms_is_lms_manager(p_org_id)
          OR public.lms_training_manager_scope_employee(p_org_id, s.employee_id)
          OR public.lms_is_course_instructor(p_org_id, s.course_id, 'review_tasks')
        )
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.lms_can_participate_course(p_org_id uuid, p_course_id uuid)
RETURNS boolean AS $$
  SELECT auth.role() = 'service_role'
    OR public.lms_is_lms_manager(p_org_id)
    OR public.lms_is_course_instructor(p_org_id, p_course_id, NULL)
    OR EXISTS (
      SELECT 1
      FROM public.lms_enrollments e
      WHERE e.org_id = p_org_id
        AND e.course_id = p_course_id
        AND e.employee_id = public.current_employee_id()
        AND e.status <> 'cancelled'
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'lms_categories',
    'lms_courses',
    'lms_course_instructors',
    'lms_course_sections',
    'lms_lessons',
    'lms_quizzes',
    'lms_quiz_questions',
    'lms_enrollments',
    'lms_lesson_progress',
    'lms_quiz_attempts',
    'lms_tasks',
    'lms_task_submissions',
    'lms_task_reviews',
    'lms_learning_paths',
    'lms_learning_path_courses',
    'lms_assignment_rules',
    'lms_certificates',
    'lms_course_feedback',
    'lms_course_announcements',
    'lms_community_posts',
    'lms_community_comments'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_touch_updated_at ON public.%I', table_name, table_name);
    EXECUTE format('CREATE TRIGGER trg_%I_touch_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()', table_name, table_name);
  END LOOP;
END $$;

ALTER TABLE public.lms_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lms_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lms_course_instructors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lms_course_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lms_lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lms_lesson_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lms_quizzes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lms_quiz_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lms_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lms_lesson_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lms_quiz_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lms_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lms_task_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lms_task_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lms_learning_paths ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lms_learning_path_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lms_assignment_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lms_certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lms_course_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lms_course_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lms_community_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lms_community_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lms_community_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lms_community_post_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lms_categories_select ON public.lms_categories;
CREATE POLICY lms_categories_select ON public.lms_categories
  FOR SELECT USING (org_id = public.current_org_id() OR auth.role() = 'service_role');
DROP POLICY IF EXISTS lms_categories_write ON public.lms_categories;
CREATE POLICY lms_categories_write ON public.lms_categories
  FOR ALL USING (public.lms_is_lms_manager(org_id) OR public.current_role() = 'training_manager')
  WITH CHECK (public.lms_is_lms_manager(org_id) OR public.current_role() = 'training_manager');

DROP POLICY IF EXISTS lms_courses_select ON public.lms_courses;
CREATE POLICY lms_courses_select ON public.lms_courses
  FOR SELECT USING (public.lms_can_access_course(org_id, id));
DROP POLICY IF EXISTS lms_courses_insert ON public.lms_courses;
CREATE POLICY lms_courses_insert ON public.lms_courses
  FOR INSERT WITH CHECK (auth.role() = 'service_role' OR (org_id = public.current_org_id() AND public.current_role() IN ('super_admin', 'admin', 'hr_admin', 'training_manager')));
DROP POLICY IF EXISTS lms_courses_update ON public.lms_courses;
CREATE POLICY lms_courses_update ON public.lms_courses
  FOR UPDATE USING (public.lms_can_manage_course(org_id, id, 'edit_content'))
  WITH CHECK (public.lms_can_manage_course(org_id, id, 'edit_content'));

DROP POLICY IF EXISTS lms_instructors_select ON public.lms_course_instructors;
CREATE POLICY lms_instructors_select ON public.lms_course_instructors
  FOR SELECT USING (public.lms_can_access_course(org_id, course_id));
DROP POLICY IF EXISTS lms_instructors_write ON public.lms_course_instructors;
CREATE POLICY lms_instructors_write ON public.lms_course_instructors
  FOR ALL USING (public.lms_is_lms_manager(org_id) OR public.current_role() = 'training_manager')
  WITH CHECK (public.lms_is_lms_manager(org_id) OR public.current_role() = 'training_manager');

DROP POLICY IF EXISTS lms_sections_select ON public.lms_course_sections;
CREATE POLICY lms_sections_select ON public.lms_course_sections
  FOR SELECT USING (public.lms_can_access_course(org_id, course_id));
DROP POLICY IF EXISTS lms_sections_write ON public.lms_course_sections;
CREATE POLICY lms_sections_write ON public.lms_course_sections
  FOR ALL USING (public.lms_can_manage_course(org_id, course_id, 'edit_content'))
  WITH CHECK (public.lms_can_manage_course(org_id, course_id, 'edit_content'));

DROP POLICY IF EXISTS lms_lessons_select ON public.lms_lessons;
CREATE POLICY lms_lessons_select ON public.lms_lessons
  FOR SELECT USING (public.lms_can_access_course(org_id, course_id));
DROP POLICY IF EXISTS lms_lessons_write ON public.lms_lessons;
CREATE POLICY lms_lessons_write ON public.lms_lessons
  FOR ALL USING (public.lms_can_manage_course(org_id, course_id, 'edit_content'))
  WITH CHECK (public.lms_can_manage_course(org_id, course_id, 'edit_content'));

DROP POLICY IF EXISTS lms_lesson_attachments_select ON public.lms_lesson_attachments;
CREATE POLICY lms_lesson_attachments_select ON public.lms_lesson_attachments
  FOR SELECT USING (public.lms_can_access_course(org_id, course_id));
DROP POLICY IF EXISTS lms_lesson_attachments_write ON public.lms_lesson_attachments;
CREATE POLICY lms_lesson_attachments_write ON public.lms_lesson_attachments
  FOR ALL USING (public.lms_can_manage_course(org_id, course_id, 'edit_content'))
  WITH CHECK (public.lms_can_manage_course(org_id, course_id, 'edit_content'));

DROP POLICY IF EXISTS lms_quizzes_select ON public.lms_quizzes;
CREATE POLICY lms_quizzes_select ON public.lms_quizzes
  FOR SELECT USING (public.lms_can_access_course(org_id, course_id));
DROP POLICY IF EXISTS lms_quizzes_write ON public.lms_quizzes;
CREATE POLICY lms_quizzes_write ON public.lms_quizzes
  FOR ALL USING (public.lms_can_manage_course(org_id, course_id, 'edit_content'))
  WITH CHECK (public.lms_can_manage_course(org_id, course_id, 'edit_content'));

DROP POLICY IF EXISTS lms_questions_select ON public.lms_quiz_questions;
CREATE POLICY lms_questions_select ON public.lms_quiz_questions
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM public.lms_quizzes q
      WHERE q.id = quiz_id AND public.lms_can_manage_course(q.org_id, q.course_id, 'edit_content')
    )
  );
DROP POLICY IF EXISTS lms_questions_write ON public.lms_quiz_questions;
CREATE POLICY lms_questions_write ON public.lms_quiz_questions
  FOR ALL USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM public.lms_quizzes q
      WHERE q.id = quiz_id AND public.lms_can_manage_course(q.org_id, q.course_id, 'edit_content')
    )
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM public.lms_quizzes q
      WHERE q.id = quiz_id AND public.lms_can_manage_course(q.org_id, q.course_id, 'edit_content')
    )
  );

DROP POLICY IF EXISTS lms_enrollments_select ON public.lms_enrollments;
CREATE POLICY lms_enrollments_select ON public.lms_enrollments
  FOR SELECT USING (public.lms_can_access_enrollment(org_id, id));
DROP POLICY IF EXISTS lms_enrollments_write ON public.lms_enrollments;
CREATE POLICY lms_enrollments_write ON public.lms_enrollments
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

DROP POLICY IF EXISTS lms_progress_select ON public.lms_lesson_progress;
CREATE POLICY lms_progress_select ON public.lms_lesson_progress
  FOR SELECT USING (public.lms_can_access_enrollment(org_id, enrollment_id));
DROP POLICY IF EXISTS lms_progress_write ON public.lms_lesson_progress;
CREATE POLICY lms_progress_write ON public.lms_lesson_progress
  FOR ALL USING (
    auth.role() = 'service_role'
    OR (
      employee_id = public.current_employee_id()
      AND EXISTS (
        SELECT 1 FROM public.lms_enrollments e
        WHERE e.org_id = lms_lesson_progress.org_id
          AND e.id = lms_lesson_progress.enrollment_id
          AND e.employee_id = public.current_employee_id()
      )
    )
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR (
      employee_id = public.current_employee_id()
      AND EXISTS (
        SELECT 1 FROM public.lms_enrollments e
        WHERE e.org_id = lms_lesson_progress.org_id
          AND e.id = lms_lesson_progress.enrollment_id
          AND e.employee_id = public.current_employee_id()
      )
    )
  );

DROP POLICY IF EXISTS lms_attempts_select ON public.lms_quiz_attempts;
CREATE POLICY lms_attempts_select ON public.lms_quiz_attempts
  FOR SELECT USING (public.lms_can_access_enrollment(org_id, enrollment_id));
DROP POLICY IF EXISTS lms_attempts_insert ON public.lms_quiz_attempts;
CREATE POLICY lms_attempts_insert ON public.lms_quiz_attempts
  FOR INSERT WITH CHECK (
    auth.role() = 'service_role'
    OR (
      employee_id = public.current_employee_id()
      AND EXISTS (
        SELECT 1 FROM public.lms_enrollments e
        WHERE e.org_id = lms_quiz_attempts.org_id
          AND e.id = lms_quiz_attempts.enrollment_id
          AND e.employee_id = public.current_employee_id()
      )
    )
  );

DROP POLICY IF EXISTS lms_tasks_select ON public.lms_tasks;
CREATE POLICY lms_tasks_select ON public.lms_tasks
  FOR SELECT USING (public.lms_can_access_course(org_id, course_id));
DROP POLICY IF EXISTS lms_tasks_write ON public.lms_tasks;
CREATE POLICY lms_tasks_write ON public.lms_tasks
  FOR ALL USING (public.lms_can_manage_course(org_id, course_id, 'edit_content') OR public.lms_is_course_instructor(org_id, course_id, 'review_tasks'))
  WITH CHECK (public.lms_can_manage_course(org_id, course_id, 'edit_content') OR public.lms_is_course_instructor(org_id, course_id, 'review_tasks'));

DROP POLICY IF EXISTS lms_submissions_select ON public.lms_task_submissions;
CREATE POLICY lms_submissions_select ON public.lms_task_submissions
  FOR SELECT USING (
    public.lms_can_access_enrollment(org_id, enrollment_id)
    OR public.lms_can_review_submission(org_id, id)
  );
DROP POLICY IF EXISTS lms_submissions_write ON public.lms_task_submissions;
CREATE POLICY lms_submissions_write ON public.lms_task_submissions
  FOR ALL USING (auth.role() = 'service_role' OR employee_id = public.current_employee_id() OR public.lms_can_review_submission(org_id, id))
  WITH CHECK (
    auth.role() = 'service_role'
    OR (
      employee_id = public.current_employee_id()
      AND EXISTS (
        SELECT 1
        FROM public.lms_enrollments e
        JOIN public.lms_tasks t ON t.org_id = e.org_id AND t.id = lms_task_submissions.task_id
        WHERE e.org_id = lms_task_submissions.org_id
          AND e.id = lms_task_submissions.enrollment_id
          AND e.course_id = lms_task_submissions.course_id
          AND t.course_id = lms_task_submissions.course_id
          AND e.employee_id = public.current_employee_id()
      )
    )
  );

DROP POLICY IF EXISTS lms_reviews_select ON public.lms_task_reviews;
CREATE POLICY lms_reviews_select ON public.lms_task_reviews
  FOR SELECT USING (public.lms_can_review_submission(org_id, submission_id) OR EXISTS (
    SELECT 1 FROM public.lms_task_submissions s
    WHERE s.id = submission_id AND s.employee_id = public.current_employee_id()
  ));
DROP POLICY IF EXISTS lms_reviews_write ON public.lms_task_reviews;
CREATE POLICY lms_reviews_write ON public.lms_task_reviews
  FOR ALL USING (public.lms_can_review_submission(org_id, submission_id))
  WITH CHECK (public.lms_can_review_submission(org_id, submission_id));

DROP POLICY IF EXISTS lms_paths_select ON public.lms_learning_paths;
CREATE POLICY lms_paths_select ON public.lms_learning_paths
  FOR SELECT USING (org_id = public.current_org_id() OR auth.role() = 'service_role');
DROP POLICY IF EXISTS lms_paths_write ON public.lms_learning_paths;
CREATE POLICY lms_paths_write ON public.lms_learning_paths
  FOR ALL USING (public.lms_is_lms_manager(org_id) OR public.current_role() = 'training_manager')
  WITH CHECK (public.lms_is_lms_manager(org_id) OR public.current_role() = 'training_manager');

DROP POLICY IF EXISTS lms_path_courses_select ON public.lms_learning_path_courses;
CREATE POLICY lms_path_courses_select ON public.lms_learning_path_courses
  FOR SELECT USING (org_id = public.current_org_id() OR auth.role() = 'service_role');
DROP POLICY IF EXISTS lms_path_courses_write ON public.lms_learning_path_courses;
CREATE POLICY lms_path_courses_write ON public.lms_learning_path_courses
  FOR ALL USING (public.lms_is_lms_manager(org_id) OR public.current_role() = 'training_manager')
  WITH CHECK (public.lms_is_lms_manager(org_id) OR public.current_role() = 'training_manager');

DROP POLICY IF EXISTS lms_assignment_rules_select ON public.lms_assignment_rules;
CREATE POLICY lms_assignment_rules_select ON public.lms_assignment_rules
  FOR SELECT USING (org_id = public.current_org_id() OR auth.role() = 'service_role');
DROP POLICY IF EXISTS lms_assignment_rules_write ON public.lms_assignment_rules;
CREATE POLICY lms_assignment_rules_write ON public.lms_assignment_rules
  FOR ALL USING (public.lms_is_lms_manager(org_id) OR public.current_role() = 'training_manager')
  WITH CHECK (public.lms_is_lms_manager(org_id) OR public.current_role() = 'training_manager');

DROP POLICY IF EXISTS lms_certificates_select ON public.lms_certificates;
CREATE POLICY lms_certificates_select ON public.lms_certificates
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR employee_id = public.current_employee_id()
    OR public.lms_is_lms_manager(org_id)
    OR public.lms_training_manager_scope_employee(org_id, employee_id)
    OR public.lms_is_course_instructor(org_id, course_id, NULL)
  );
DROP POLICY IF EXISTS lms_certificates_write ON public.lms_certificates;
CREATE POLICY lms_certificates_write ON public.lms_certificates
  FOR ALL USING (auth.role() = 'service_role' OR public.lms_is_lms_manager(org_id))
  WITH CHECK (auth.role() = 'service_role' OR public.lms_is_lms_manager(org_id));

DROP POLICY IF EXISTS lms_feedback_select ON public.lms_course_feedback;
CREATE POLICY lms_feedback_select ON public.lms_course_feedback
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR employee_id = public.current_employee_id()
    OR public.lms_is_lms_manager(org_id)
    OR public.lms_training_manager_scope_employee(org_id, employee_id)
    OR public.lms_is_course_instructor(org_id, course_id, NULL)
  );
DROP POLICY IF EXISTS lms_feedback_write ON public.lms_course_feedback;
CREATE POLICY lms_feedback_write ON public.lms_course_feedback
  FOR ALL USING (auth.role() = 'service_role' OR employee_id = public.current_employee_id())
  WITH CHECK (auth.role() = 'service_role' OR employee_id = public.current_employee_id());

DROP POLICY IF EXISTS lms_announcements_select ON public.lms_course_announcements;
CREATE POLICY lms_announcements_select ON public.lms_course_announcements
  FOR SELECT USING (public.lms_can_access_course(org_id, course_id));
DROP POLICY IF EXISTS lms_announcements_write ON public.lms_course_announcements;
CREATE POLICY lms_announcements_write ON public.lms_course_announcements
  FOR ALL USING (public.lms_can_manage_course(org_id, course_id, 'moderate_community'))
  WITH CHECK (public.lms_can_manage_course(org_id, course_id, 'moderate_community'));

DROP POLICY IF EXISTS lms_posts_select ON public.lms_community_posts;
CREATE POLICY lms_posts_select ON public.lms_community_posts
  FOR SELECT USING (
    public.lms_can_participate_course(org_id, course_id)
    AND (is_hidden = false OR public.lms_can_manage_course(org_id, course_id, 'moderate_community'))
  );
DROP POLICY IF EXISTS lms_posts_insert ON public.lms_community_posts;
CREATE POLICY lms_posts_insert ON public.lms_community_posts
  FOR INSERT WITH CHECK (auth.role() = 'service_role' OR (employee_id = public.current_employee_id() AND public.lms_can_participate_course(org_id, course_id)));
DROP POLICY IF EXISTS lms_posts_update ON public.lms_community_posts;
CREATE POLICY lms_posts_update ON public.lms_community_posts
  FOR UPDATE USING (auth.role() = 'service_role' OR employee_id = public.current_employee_id() OR public.lms_can_manage_course(org_id, course_id, 'moderate_community'))
  WITH CHECK (auth.role() = 'service_role' OR employee_id = public.current_employee_id() OR public.lms_can_manage_course(org_id, course_id, 'moderate_community'));

DROP POLICY IF EXISTS lms_comments_select ON public.lms_community_comments;
CREATE POLICY lms_comments_select ON public.lms_community_comments
  FOR SELECT USING (
    public.lms_can_participate_course(org_id, course_id)
    AND (is_hidden = false OR public.lms_can_manage_course(org_id, course_id, 'moderate_community'))
  );
DROP POLICY IF EXISTS lms_comments_insert ON public.lms_community_comments;
CREATE POLICY lms_comments_insert ON public.lms_community_comments
  FOR INSERT WITH CHECK (auth.role() = 'service_role' OR (employee_id = public.current_employee_id() AND public.lms_can_participate_course(org_id, course_id)));
DROP POLICY IF EXISTS lms_comments_update ON public.lms_community_comments;
CREATE POLICY lms_comments_update ON public.lms_community_comments
  FOR UPDATE USING (auth.role() = 'service_role' OR employee_id = public.current_employee_id() OR public.lms_can_manage_course(org_id, course_id, 'moderate_community'))
  WITH CHECK (auth.role() = 'service_role' OR employee_id = public.current_employee_id() OR public.lms_can_manage_course(org_id, course_id, 'moderate_community'));

DROP POLICY IF EXISTS lms_reactions_select ON public.lms_community_reactions;
CREATE POLICY lms_reactions_select ON public.lms_community_reactions
  FOR SELECT USING (org_id = public.current_org_id() OR auth.role() = 'service_role');
DROP POLICY IF EXISTS lms_reactions_write ON public.lms_community_reactions;
CREATE POLICY lms_reactions_write ON public.lms_community_reactions
  FOR ALL USING (
    auth.role() = 'service_role'
    OR (
      employee_id = public.current_employee_id()
      AND EXISTS (
        SELECT 1 FROM public.lms_community_posts p
        WHERE p.org_id = lms_community_reactions.org_id
          AND p.id = lms_community_reactions.post_id
          AND public.lms_can_participate_course(p.org_id, p.course_id)
      )
    )
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR (
      employee_id = public.current_employee_id()
      AND EXISTS (
        SELECT 1 FROM public.lms_community_posts p
        WHERE p.org_id = lms_community_reactions.org_id
          AND p.id = lms_community_reactions.post_id
          AND public.lms_can_participate_course(p.org_id, p.course_id)
      )
    )
  );

DROP POLICY IF EXISTS lms_reads_select ON public.lms_community_post_reads;
CREATE POLICY lms_reads_select ON public.lms_community_post_reads
  FOR SELECT USING (auth.role() = 'service_role' OR employee_id = public.current_employee_id());
DROP POLICY IF EXISTS lms_reads_write ON public.lms_community_post_reads;
CREATE POLICY lms_reads_write ON public.lms_community_post_reads
  FOR ALL USING (
    auth.role() = 'service_role'
    OR (
      employee_id = public.current_employee_id()
      AND EXISTS (
        SELECT 1 FROM public.lms_community_posts p
        WHERE p.org_id = lms_community_post_reads.org_id
          AND p.id = lms_community_post_reads.post_id
          AND public.lms_can_participate_course(p.org_id, p.course_id)
      )
    )
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR (
      employee_id = public.current_employee_id()
      AND EXISTS (
        SELECT 1 FROM public.lms_community_posts p
        WHERE p.org_id = lms_community_post_reads.org_id
          AND p.id = lms_community_post_reads.post_id
          AND public.lms_can_participate_course(p.org_id, p.course_id)
      )
    )
  );

INSERT INTO storage.buckets (id, name, public)
VALUES ('lms-content', 'lms-content', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS lms_content_select ON storage.objects;
CREATE POLICY lms_content_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'lms-content'
    AND auth.role() = 'service_role'
  );

DROP POLICY IF EXISTS lms_content_insert ON storage.objects;
CREATE POLICY lms_content_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'lms-content'
    AND auth.role() = 'service_role'
  );

DROP POLICY IF EXISTS lms_content_update ON storage.objects;
CREATE POLICY lms_content_update ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'lms-content'
    AND auth.role() = 'service_role'
  )
  WITH CHECK (
    bucket_id = 'lms-content'
    AND auth.role() = 'service_role'
  );

DROP POLICY IF EXISTS lms_content_delete ON storage.objects;
CREATE POLICY lms_content_delete ON storage.objects
  FOR DELETE USING (
    bucket_id = 'lms-content'
    AND auth.role() = 'service_role'
  );
