# LMS v44 — Udacity-Style Classroom & Professional Course Builder — Detailed Implementation Plan

> Status: Planning (approved for build)
> Scope: **Additive upgrade** on top of LMS v43. No rewrite. Existing `/lms` management stays intact.
> Source brief: `LMS_v44_Udacity_Style_Classroom_and_Course_Builder_Brief.md`
> Baseline audit: `documentations/lms-v43-detailed-implementation.md`

---

## 0. Executive Summary

LMS v43 is a complete internal corporate LMS engine (24 tables, catch-all API, RLS, private storage,
course builder, learner player, quizzes, tasks, certificates, community, reports, Arabic RTL). v44 does
**not** change that engine. It adds two things on top of it:

1. **`/learn` — a learner-first, immersive Udacity-style classroom** (separate shell, syllabus, lesson
   player, projects, workspace, notes, bookmarks, resources, community, certificate).
2. **A professional Course/Program Studio** — upgrade the existing builder into a tabbed studio with
   overview, syllabus, lessons, quizzes, projects, rubrics, resources, instructors, community,
   assignments, completion, certificates, publish checklist, and learner preview.

### The two product surfaces

```text
/lms    = management: builder/studio, reports, assignments, certificates registry, moderation  (UNCHANGED shell)
/learn  = learner classroom: home, syllabus, lessons, projects, workspace, notes, community, certificate  (NEW shell)
```

### Non-negotiables (from brief §19, §22)

- Additive & idempotent migration; v43 keeps working.
- No cross-org or cross-employee access; learner notes/bookmarks/workspace state are private.
- Quiz `correct_answer_json` never leaves the server before submission; scoring stays server-side.
- Signed URLs still require authorization.
- No public academy, payments, video transcoding, PDF dependency, or real cloud IDE in this phase.

---

## 1. Phase 0 — Audit Findings (verified against the codebase)

These are the concrete v43 building blocks v44 will reuse. All paths verified.

### 1.1 Database (`db/schema_v43_lms_module.sql`, 918 lines)

24 tenant-scoped tables, all with `org_id uuid NOT NULL REFERENCES organizations(id)` and RLS enabled:

`lms_categories`, `lms_courses`, `lms_course_instructors`, `lms_course_sections`, `lms_lessons`,
`lms_lesson_attachments`, `lms_quizzes`, `lms_quiz_questions`, `lms_enrollments`, `lms_lesson_progress`,
`lms_quiz_attempts`, `lms_tasks`, `lms_task_submissions`, `lms_task_reviews`, `lms_learning_paths`,
`lms_learning_path_courses`, `lms_assignment_rules`, `lms_certificates`, `lms_course_feedback`,
`lms_course_announcements`, `lms_community_posts`, `lms_community_comments`, `lms_community_reactions`,
`lms_community_post_reads`.

**Reusable RLS helper functions (SECURITY DEFINER)** — v44 policies will reuse these verbatim:

| Helper | Purpose |
|---|---|
| `lms_is_lms_manager(org_id)` | admin / hr_admin / super_admin |
| `lms_training_manager_scope_employee(org_id, employee_id)` | training manager scope by manager/department/location |
| `lms_is_course_instructor(org_id, course_id, permission)` | per-course instructor permission (`edit_content` / `review_tasks` / `moderate_community`) |
| `lms_can_manage_course(org_id, course_id, permission)` | management OR creator OR instructor |
| `lms_can_access_course(org_id, course_id)` | management OR manage OR published+catalog/enrolled |
| `lms_can_access_enrollment(org_id, enrollment_id)` | owner OR management/scope (used by progress, attempts, submissions) |
| `lms_can_review_submission(org_id, submission_id)` | reviewer/instructor/management |
| `lms_can_participate_course(org_id, course_id)` | enrollment/course-access scoped community |
| `current_org_id()`, `current_role()`, `current_employee_id()` | request identity |

Key constraints already present: one active enrollment per (org, course, employee); one progress row per
(enrollment, lesson); one certificate per enrollment; task submission uniqueness; quiz answers stored in
`answers_json`, correct answers in `correct_answer_json`.

### 1.2 API (`src/app/api/lms/[[...segments]]/route.ts`)

Single catch-all dispatcher. Each verb is wrapped: `export const GET = withTenantContext(getHandler, { feature: "lms" })`
(same for POST/PATCH/DELETE). Handlers parse `segments(routeContext)` into `[a, b, c, …]` and branch,
then call `src/lib/server/lms.ts`. Error→status mapping: `Forbidden`→403, `not found`→404, validation→400.

### 1.3 Server logic (`src/lib/server/lms.ts`, 1414 lines)

`TenantAuthContext` carries `{ user, orgId, role, admin (supabase client) }`. All queries filter
`.eq("org_id", auth.orgId)`. Notable reusable functions/helpers:
`getLearnerDashboard`, `getEnrollmentDetail`, `completeLesson`, `recalculateEnrollment`,
`submitQuizAttempt`, `answerMatches`, `submitTask`, `listTaskSubmissions`, `getSubmission`,
`reviewSubmission`, `issueCertificateIfNeeded`, `createSignedLmsUrl`, `assignLmsLearning`,
and access helpers `getEmployeeId`, `isManagement`, `isElevated`, `isTrainingManager`,
`canManageCourse`, `canAccessPublishedCourse`, `hasActiveEnrollmentForCourse`.

### 1.4 Client + UI

- Client services: `src/lib/services/lms.ts` (`apiFetch<T>` → `{ data, error }`, `jsonInit`).
- Hooks: `src/hooks/use-data.ts` (`useLmsDashboard`, `useLmsCatalog`, `useLmsCourses`, `useLmsReports`, `useLmsAssignments`).
- Screens: `src/components/lms/LmsScreens.tsx` (2272 lines) consumed by thin `src/app/(app)/lms/**/page.tsx` wrappers.
- Player today: `LmsPlayerScreen` at `/lms/player/[enrollmentId]` (left section/lesson nav + main content).
- Builder today: `LmsCourseEditorScreen` at `/lms/courses/[courseId]/edit` (tabs: Course Data / Content / Quizzes / Tasks).
- Types: `src/types/lms.ts`.

### 1.5 Cross-cutting integration points (exact)

- **App shell**: `src/app/(app)/layout.tsx` = `AuthGuard` + `Sidebar` + `Header` + `<main>` (dense admin chrome, `dir="rtl"`).
- **Feature gate**: `src/middleware.ts` → `requiredFeatureForPath()` returns `"lms"` for `/lms` and `/api/lms`.
  `featureEnabled()` checks `lms_enabled` and `enabled_modules`.
- **RBAC**: `src/lib/rbac.ts` → `canAccessPath()` returns `ALL_ROLES.includes(role)` for `/lms` and `/api/lms`.
- **Nav**: `src/components/layout/Sidebar.tsx` (learner ops + management ops groups, Arabic labels).
- **Storage**: private bucket `lms-content`, org-prefixed paths, signed URLs after auth checks.

---

## 2. Architecture Decisions

These decisions keep v44 consistent with v43 and preserve the immersive learner requirement.

### AD-1 — Dedicated `/learn` route group with its own shell

Create a **new sibling route group** `src/app/(learn)/` so the classroom does **not** inherit the HRMS
`Sidebar`/`Header`. Its `layout.tsx` reuses the existing `AuthGuard` (auth + tenant) but renders the
classroom chrome (`ClassroomShell`) instead of the admin sidebar. Rationale: a nested layout under
`(app)` cannot remove the parent's sidebar; a sibling group can. URL stays `/learn/...` (route groups do
not affect the path), so middleware + RBAC gating by path still applies.

```text
src/app/(learn)/layout.tsx            → AuthGuard + minimal learner chrome (no admin Sidebar)
src/app/(learn)/learn/**              → learner pages
```

### AD-2 — New `/api/learn` catch-all for learner APIs; extend `/api/lms` for builder

Mirror the existing pattern with a new `src/app/api/learn/[[...segments]]/route.ts` wrapped by
`withTenantContext(handler, { feature: "lms" })`. Keep management/builder additions (rubrics, publish
checklist, builder state, learner-preview) inside the existing `/api/lms` dispatcher. This cleanly
separates learner-owned mutations from management operations while reusing the same gate.

### AD-3 — New server module `src/lib/server/learn.ts`; export shared helpers from `lms.ts`

Put classroom services in a new `src/lib/server/learn.ts` to avoid bloating the 1414-line `lms.ts`.
Export the shared helpers (`getEmployeeId`, `isManagement`, `canManageCourse`, `recalculateEnrollment`,
`createSignedLmsUrl`, `answerMatches`, `issueCertificateIfNeeded`) from `lms.ts` so `learn.ts` reuses
them. Builder-only server logic (rubrics, publish checklist, builder state) goes in
`src/lib/server/lms-builder.ts`.

### AD-4 — Reuse tables; add only additive columns/tables

Use existing `lms_courses`/`lms_course_sections`/`lms_lessons`/`lms_quizzes`/`lms_tasks` for structure.
Add 10 new tables + a handful of optional columns (all `ADD COLUMN IF NOT EXISTS`). Learner-facing UI
renames `lms_tasks` → **"Project"** at the presentation layer only (no data migration).

### AD-5 — Client + hooks parity

Add `src/lib/services/learn.ts` (same `apiFetch` shape) and classroom hooks in `src/hooks/use-data.ts`
(`useLearnerHome`, `useClassroom`, etc.). Add classroom types to `src/types/lms.ts`.

---

## 3. Phase 1 — v44 Migration

**File:** `db/schema_v44_lms_classroom_experience.sql` (additive, idempotent — same conventions as v43:
`CREATE TABLE IF NOT EXISTS`, `ALTER … ADD COLUMN IF NOT EXISTS`, `ENABLE ROW LEVEL SECURITY`,
`DROP POLICY IF EXISTS` then `CREATE POLICY`, `CREATE INDEX IF NOT EXISTS`).

### 3.1 New tables (10)

| Table | Purpose | Ownership / RLS basis |
|---|---|---|
| `lms_project_rubrics` | rubric header per task/course | manage via `lms_can_manage_course(...,'edit_content')`; read via `lms_can_access_course` |
| `lms_project_rubric_items` | rubric criteria (title, passing_criteria, points, sort_order) | same as rubrics |
| `lms_project_review_items` | per-criterion review scores linked to `lms_task_reviews` | write via `lms_can_review_submission`; read by submission owner + reviewer |
| `lms_learner_workspace_state` | continue-where-left-off (last lesson/quiz/task/route, `state_json`) | **private**: `employee_id = current_employee_id()` + own enrollment |
| `lms_learner_notes` | private notes linked to lesson/quiz/task | **private**: owner only |
| `lms_learner_bookmarks` | bookmarks for lesson/task/quiz/resource | **private**: owner only |
| `lms_learning_deadlines` | centralized deadline panel rows | read: owner + management/scope; write: management/service |
| `lms_learner_activity_events` | activity log for reporting/continue intelligence | insert: owner; read: owner + management/scope |
| `lms_workspace_configs` | per-course/task workspace config (none/external_link/instructions_only) | manage via `lms_can_manage_course`; read via `lms_can_access_course` |
| `lms_course_resources` | reusable course resources (storage_path/external_url, mime, size) | manage via `lms_can_manage_course`; read via `lms_can_access_course` |

All tables include: `id uuid PK default gen_random_uuid()`, `org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE`,
appropriate FKs (`course_id`, `enrollment_id`, `employee_id`, `task_id`, `lesson_id`, `quiz_id`),
`created_at`/`updated_at timestamptz NOT NULL DEFAULT now()`, and CHECK constraints on enum-like text
columns (e.g. `bookmark_type IN ('lesson','task','quiz','resource')`,
`status IN ('upcoming','due_soon','overdue','completed','cancelled')`).

**Representative DDL (rubric items + private notes):**

```sql
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
```

### 3.2 Optional additive columns (only where they improve the studio/syllabus)

- `lms_course_sections`: `section_type text DEFAULT 'module' CHECK (section_type IN ('part','module','section'))`,
  `parent_section_id uuid REFERENCES lms_course_sections(id) ON DELETE SET NULL`,
  `estimated_minutes integer`, `is_milestone boolean DEFAULT false`.
- `lms_lessons`: `learning_unit_type text DEFAULT 'lesson' CHECK (learning_unit_type IN ('lesson','checkpoint','resource'))`,
  `display_mode text DEFAULT 'article' CHECK (display_mode IN ('article','video','document','external_link','mixed'))`.
- `lms_courses` (studio overview + certificate config): `subtitle text`, `target_audience text`,
  `prerequisites text`, `learning_outcomes jsonb DEFAULT '[]'`, `skills_gained jsonb DEFAULT '[]'`,
  `tags jsonb DEFAULT '[]'`, `language text DEFAULT 'ar'`,
  `experience_type text DEFAULT 'course' CHECK (experience_type IN ('course','program'))`,
  `certificate_enabled boolean DEFAULT true`, `certificate_title text`, `certificate_description text`,
  `certificate_signatory text`.
- `lms_tasks`: `why_it_matters text`, `estimated_minutes integer`.

### 3.3 New RLS helper (private-ownership) + policies

Add one helper mirroring the existing style, plus policies. Private tables gate on ownership:

```sql
CREATE OR REPLACE FUNCTION public.lms_owns_enrollment(p_org_id uuid, p_enrollment_id uuid)
RETURNS boolean AS $$
  SELECT auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM public.lms_enrollments e
      WHERE e.org_id = p_org_id AND e.id = p_enrollment_id
        AND e.employee_id = public.current_employee_id()
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Private note policy example
CREATE POLICY lms_learner_notes_rw ON public.lms_learner_notes
  FOR ALL USING (auth.role() = 'service_role' OR employee_id = public.current_employee_id())
  WITH CHECK (auth.role() = 'service_role' OR (employee_id = public.current_employee_id()
    AND public.lms_owns_enrollment(org_id, enrollment_id)));
```

Rubric/resource/workspace-config policies reuse `lms_can_manage_course(...,'edit_content')` (write) and
`lms_can_access_course` (read). `lms_project_review_items` write reuses `lms_can_review_submission`;
read allows the submission owner. Deadlines/activity read allow owner + `lms_is_lms_manager` +
`lms_training_manager_scope_employee`.

### 3.4 Indexes

Add practical composite indexes, e.g. `(org_id, enrollment_id)` on notes/bookmarks/workspace-state/
activity/deadlines, `(org_id, task_id)` on rubrics/rubric items, `(org_id, course_id)` on resources.

### 3.5 Deliverables

- `db/schema_v44_lms_classroom_experience.sql`.
- Apply path (documented in v43): `npm run apply:supabase-sql -- db/schema_v44_lms_classroom_experience.sql`.

---

## 4. Phase 2 — Learner Classroom Services

**Files:** new `src/lib/server/learn.ts`; export shared helpers from `src/lib/server/lms.ts`; add
Zod schemas to `src/lib/validation.ts`; add types to `src/types/lms.ts`.

Functions (all take `TenantAuthContext`, filter `org_id`, and verify enrollment ownership first):

```text
getLearnerHome(auth)                                   // continue-learning, active, deadlines, announcements, stats
getClassroomDashboard(auth, enrollmentId)              // overview + next action + progress + checklist
getClassroomSyllabus(auth, enrollmentId)               // parts→modules→lessons/quizzes/projects (published only)
getClassroomLesson(auth, enrollmentId, lessonId)       // lesson payload + signed URLs after auth
getClassroomQuiz(auth, enrollmentId, quizId)           // quiz meta + questions WITHOUT correct answers
getClassroomProject(auth, enrollmentId, taskId)        // project + rubric (read) + submission + review
getClassroomWorkspace(auth, enrollmentId)              // current project + config + resources + feedback
updateLearnerWorkspaceState(auth, enrollmentId, body)  // upsert continue pointer
createLearnerNote / updateLearnerNote / deleteLearnerNote
createLearnerBookmark / deleteLearnerBookmark
getClassroomResources(auth, enrollmentId)
recordLearnerActivityEvent(auth, enrollmentId, event)
getClassroomCommunity(auth, enrollmentId)              // wraps existing listCommunity by enrollment→course
getClassroomCertificate(auth, enrollmentId)
```

Reuse from `lms.ts`: `getEnrollmentDetail`, `completeLesson`, `submitQuizAttempt`, `submitTask`,
`recalculateEnrollment`, `createSignedLmsUrl`, `issueCertificateIfNeeded`. Every classroom function
begins by resolving the enrollment and asserting `enrollment.employee_id === getEmployeeId(auth)` (or
management/scope for read-only where appropriate), so RLS + service checks are defense-in-depth.

**Security invariants** (brief §19) enforced here and by RLS: only own enrollments; private notes/
bookmarks/workspace state; signed URLs authorized; quiz answers never serialized to learner payloads;
project reviews management/instructor-only; no cross-org by id.

---

## 5. Phase 3 — New `/learn` UI Shell

**Files:**
- `src/app/(learn)/layout.tsx` — `AuthGuard` wrapper + `ClassroomShell`.
- `src/components/lms/classroom/ClassroomLayout.tsx`, `ClassroomTopbar.tsx`, `ClassroomSidebar.tsx`,
  `ClassroomRightPanel.tsx`.

Behavior: three-region immersive layout (topbar / left nav / main / right panel) per brief §5, Arabic
RTL polished, `Exit` back to `/lms/my`. Reuse `src/components/ui/*` primitives (Card, Button, Badge,
Tabs, Progress). Respect the repo UI-primitive note: popovers/selects must clamp to viewport in RTL.

---

## 6. Phase 4 — Learner Home & Classroom Dashboard

**Routes:** `src/app/(learn)/learn/page.tsx`, `src/app/(learn)/learn/[enrollmentId]/{layout,page}.tsx`.
**Components:** `LearnerHome.tsx`, `ClassroomDashboard.tsx` (+ existing shell).
**Data:** `useLearnerHome()` → `/api/learn`; `useClassroom(enrollmentId)` → `/api/learn/[enrollmentId]`.

Home (brief §4): Continue Learning, My Active Learning, Upcoming Deadlines, Announcements, Community
Updates, Certificates, Learning Stats. Dashboard (brief §5): overview + right-panel next action /
checklist / instructor card / deadline. The `[enrollmentId]/layout.tsx` fetches the enrollment once and
renders topbar + sidebar + right panel; child routes render into the main area.

---

## 7. Phase 5 — Syllabus & Lesson Experience

**Routes:** `learn/[enrollmentId]/syllabus/page.tsx`, `learn/[enrollmentId]/lesson/[lessonId]/page.tsx`.
**Components:** `SyllabusView.tsx`, `LessonExperience.tsx`.

- Syllabus renders parts→modules→lessons/quizzes/projects using `section_type`/`parent_section_id`
  (falls back to flat sections when columns unset). Published/active content only.
- Lesson player supports text/video/document/file/link + attachments; actions: mark complete
  (reuse `completeLesson` → `recalculateEnrollment`), prev/next, add note, bookmark, ask question,
  view resources. Right panel: checklist, related project/quiz, my notes.
- Persist last-opened via `updateLearnerWorkspaceState`; the Continue button reads it.
- Signed URLs generated only after authorization (`createSignedLmsUrl`).

---

## 8. Phase 6 — Projects & Rubrics

**Route:** `learn/[enrollmentId]/project/[taskId]/page.tsx` + `learn/[enrollmentId]/workspace/page.tsx`.
**Components:** `ProjectWorkspace.tsx`.
**Server:** `getClassroomProject`, `getProjectRubric`, `reviewProjectWithRubric`.

- Learner-facing "Project" language over `lms_tasks`. Sections: overview / instructions / rubric (read)
  / workspace (text/file/link + draft) / submit (reuse `submitTask`) / review result (rubric-level).
- Rubric read for learners before submission; reviewers score each `lms_project_rubric_item` into
  `lms_project_review_items`, tied to the existing `lms_task_reviews` row. Overall pass/fail combines
  rubric scores with task `pass_score`.
- Workspace v1 = professional page (project + config + resources + feedback). No cloud IDE.

---

## 9. Phase 7 — Quiz Experience

**Route:** `learn/[enrollmentId]/quiz/[quizId]/page.tsx`. **Component:** `QuizExperience.tsx`.
**Server:** `getClassroomQuiz` (strips `correct_answer_json`), submit reuses `submitQuizAttempt`
(server-side scoring via `answerMatches`, max-attempt enforcement, pass/fail persisted).

UX (brief §8): meta (questions, time limit, attempts, passing score) → questions → confirm → submit →
result (score, pass/fail, attempt history, retake if attempts remain). **Security:** answers never in
learner payload before submission; scoring server-side only.

---

## 10. Phase 8 — Notes, Bookmarks, Resources, Activity

**Routes:** `learn/[enrollmentId]/notes/page.tsx`, `learn/[enrollmentId]/resources/page.tsx`,
`learn/[enrollmentId]/community/page.tsx`, `learn/[enrollmentId]/certificate/page.tsx`.
**Components:** `LearnerNotes.tsx`, `LearnerResources.tsx`, `ClassroomCommunity.tsx`, `CertificateExperience.tsx`.

- Notes/bookmarks: private CRUD (owner-only, RLS-enforced), linkable to lesson/quiz/project.
- Resources: `lms_course_resources` with signed URLs after auth checks.
- Community: reuse existing `listCommunity`/`createCommunityPost`/`createCommunityComment`/`reactToPost`
  scoped by enrollment→course via `lms_can_participate_course`.
- Certificate: reuse `getCertificate`; printable HTML/CSS (no PDF dependency).
- Activity events recorded on key transitions (`classroom_opened`, `lesson_completed`,
  `quiz_submitted`, `project_submitted`, …) for reporting/continue intelligence.

---

## 11. Phase 9 — Professional Course Builder (Studio) Upgrade

**File:** upgrade `LmsCourseEditorScreen` in `src/components/lms/LmsScreens.tsx` (or extract to
`src/components/lms/builder/CourseStudio.tsx`) at existing route `/lms/courses/[courseId]/edit`.
**Server:** `src/lib/server/lms-builder.ts` — `getCourseBuilderState`, `updateCourseBuilderOverview`,
`updateCourseSyllabus`, `getProjectRubric`, `upsertProjectRubric`, `getPublishChecklist`,
`getLearnerPreview`. **API:** extend `/api/lms` dispatcher.

Studio layout (brief §14–16): left builder nav / center editor / right inspector (validation, settings,
checklist). Tabs: Overview, Syllabus, Lessons, Quizzes, Projects, Rubrics, Resources, Instructors,
Community, Assignments, Completion, Certificates, Publish Checklist, Analytics (post-publish).

- **Overview**: card-based identity (title, subtitle, category, difficulty, duration, thumbnail,
  visibility, experience_type, audience, prerequisites, outcomes, skills, language, tags) + preview card.
- **Syllabus**: parts/modules/sections, add lesson/quiz/project, collapse/expand, ordering; writes via
  `updateCourseSyllabus` using new section columns.
- **Rubrics**: build `lms_project_rubrics` + items per project.
- **Resources**: upload to `lms-content`, attach to lesson/project, signed URLs.
- **Publish Checklist**: `getPublishChecklist` returns pass/fail checks (title, description, ≥1 module,
  required lessons have content, required quizzes have questions, required projects have instructions +
  rubric, instructor assigned, completion rules valid). Publish disabled/warns on critical fails.
- **Learner Preview**: `getLearnerPreview` renders the `/learn` classroom read-only for the builder.

Reuse existing builder mutations (`upsertCourseSection`, `upsertCourseQuiz`, `addQuizQuestion`,
`upsertCourseTask`, instructor/announcement endpoints). Fix the historical "squeezed columns" issue with
the studio 3-pane layout.

---

## 12. Phase 10 — QA, Verification, Docs

- **Verify script**: extend `scripts/verify-lms-module.mjs` (`npm run verify:lms`) with the 10 new
  tables, RLS-enabled checks, new helper `lms_owns_enrollment`, and key indexes. (Optionally add
  `verify:lms:classroom`.)
- **Middleware**: add `/learn` and `/api/learn` to `requiredFeatureForPath()` → `"lms"`.
- **RBAC**: add `/learn` and `/api/learn` to `canAccessPath()` → `ALL_ROLES.includes(role)`.
- **Nav**: point learner "تعلمي / My Learning" entry at `/learn`; keep management group on `/lms`.
- **Gates to pass**: `npm run lint`, `npm run build`, `npm run verify:lms`, apply migration.
- **Docs**: update `documentations/{api,database,frontend,modules,project-structure,services,schema-apply,README}.md`
  and add a v44 summary; update root `README.md`.
- **Manual QA checklist**: acceptance criteria in §15.

---

## 13. API Endpoint Inventory

### New learner API — `src/app/api/learn/[[...segments]]/route.ts` (`feature: "lms"`)

```text
GET    /api/learn
GET    /api/learn/[enrollmentId]
GET    /api/learn/[enrollmentId]/syllabus
GET    /api/learn/[enrollmentId]/lesson/[lessonId]
POST   /api/learn/[enrollmentId]/lesson/[lessonId]/complete
GET    /api/learn/[enrollmentId]/quiz/[quizId]
POST   /api/learn/[enrollmentId]/quiz/[quizId]/attempts
GET    /api/learn/[enrollmentId]/project/[taskId]
POST   /api/learn/[enrollmentId]/project/[taskId]/submit
GET    /api/learn/[enrollmentId]/workspace
PATCH  /api/learn/[enrollmentId]/workspace-state
GET    /api/learn/[enrollmentId]/notes
POST   /api/learn/[enrollmentId]/notes
PATCH  /api/learn/[enrollmentId]/notes/[noteId]
DELETE /api/learn/[enrollmentId]/notes/[noteId]
POST   /api/learn/[enrollmentId]/bookmarks
DELETE /api/learn/[enrollmentId]/bookmarks/[bookmarkId]
GET    /api/learn/[enrollmentId]/resources
GET    /api/learn/[enrollmentId]/community      (POST reuses existing community handlers)
GET    /api/learn/[enrollmentId]/certificate
```

### Builder additions — extend `src/app/api/lms/[[...segments]]/route.ts`

```text
GET    /api/lms/courses/[courseId]/builder
PATCH  /api/lms/courses/[courseId]/builder/overview
PATCH  /api/lms/courses/[courseId]/builder/syllabus
GET    /api/lms/tasks/[taskId]/rubric
POST   /api/lms/tasks/[taskId]/rubric
PATCH  /api/lms/rubric-items/[itemId]
DELETE /api/lms/rubric-items/[itemId]
GET    /api/lms/courses/[courseId]/publish-checklist
GET    /api/lms/courses/[courseId]/learner-preview
POST   /api/lms/submissions/[submissionId]/rubric-review   (rubric-level review)
GET/POST /api/lms/courses/[courseId]/resources             (course resources)
```

---

## 14. File-Change Inventory

### New files

```text
db/schema_v44_lms_classroom_experience.sql
src/app/(learn)/layout.tsx
src/app/(learn)/learn/page.tsx
src/app/(learn)/learn/[enrollmentId]/layout.tsx
src/app/(learn)/learn/[enrollmentId]/page.tsx
src/app/(learn)/learn/[enrollmentId]/syllabus/page.tsx
src/app/(learn)/learn/[enrollmentId]/lesson/[lessonId]/page.tsx
src/app/(learn)/learn/[enrollmentId]/quiz/[quizId]/page.tsx
src/app/(learn)/learn/[enrollmentId]/project/[taskId]/page.tsx
src/app/(learn)/learn/[enrollmentId]/workspace/page.tsx
src/app/(learn)/learn/[enrollmentId]/community/page.tsx
src/app/(learn)/learn/[enrollmentId]/notes/page.tsx
src/app/(learn)/learn/[enrollmentId]/resources/page.tsx
src/app/(learn)/learn/[enrollmentId]/certificate/page.tsx
src/app/api/learn/[[...segments]]/route.ts
src/lib/server/learn.ts
src/lib/server/lms-builder.ts
src/lib/services/learn.ts
src/components/lms/classroom/{ClassroomLayout,ClassroomTopbar,ClassroomSidebar,ClassroomRightPanel,
  LearnerHome,ClassroomDashboard,SyllabusView,LessonExperience,QuizExperience,ProjectWorkspace,
  ClassroomCommunity,LearnerNotes,LearnerResources,CertificateExperience}.tsx
src/components/lms/builder/CourseStudio.tsx   (optional extraction)
```

### Modified files

```text
src/lib/server/lms.ts          (export shared helpers; rubric-aware review)
src/lib/validation.ts          (rubric, note, bookmark, workspace-state, deadline, resource, builder schemas)
src/types/lms.ts               (classroom + rubric + builder types)
src/hooks/use-data.ts          (useLearnerHome, useClassroom, useClassroom* hooks)
src/middleware.ts              (/learn + /api/learn → "lms")
src/lib/rbac.ts                (/learn + /api/learn → ALL_ROLES)
src/components/layout/Sidebar.tsx (learner "My Learning" → /learn)
src/components/lms/LmsScreens.tsx  (builder → studio, or import CourseStudio)
scripts/verify-lms-module.mjs  (v44 tables/RLS/indexes)
documentations/*.md, README.md
```

---

## 15. Security & Acceptance Criteria

### Security matrix (brief §19) → enforcement

| Requirement | RLS | Service check |
|---|---|---|
| `/learn` shows only own enrollments | `lms_can_access_enrollment` | `getLearnerHome` filters by `getEmployeeId` |
| `[enrollmentId]` rejects others' enrollments | enrollment policies | ownership assert on every classroom fn |
| Notes/bookmarks/workspace private | `employee_id = current_employee_id()` + `lms_owns_enrollment` | owner-only queries |
| Signed URLs authorized | n/a | `createSignedLmsUrl` access checks |
| Quiz answers protected | `lms_questions_*` | `getClassroomQuiz` strips `correct_answer_json` |
| Project reviews mgmt/instructor-only | `lms_can_review_submission` | `reviewProjectWithRubric` guard |
| Rubric edit instructor/mgmt-only | `lms_can_manage_course(...,'edit_content')` | builder guards |
| No cross-org by id | `org_id` filters + RLS | `.eq("org_id", auth.orgId)` everywhere |

### Acceptance checklist

- Learner: `/learn` shows only own learning; Start/Continue enters immersive classroom; syllabus,
  lessons, complete, quizzes, projects, rubric view, review feedback, notes, bookmarks, resources,
  community, certificate all work.
- Builder: professional studio; text/video/document/link lessons; quizzes; projects; rubrics;
  instructors; completion rules; publish checklist; learner preview; not squeezed/messy.
- Security: no cross-org/cross-employee; private learner data; signed-URL checks; quiz answers protected;
  instructor + training-manager scope preserved.
- Technical: additive migration; v43 still works; feature flag applies to `/learn` + `/api/learn`;
  `npm run lint`, `npm run build`, `npm run verify:lms` pass; docs updated.

---

## 16. Sequencing & Dependencies

```text
Phase 1 (migration)            ── prerequisite for all services
   └─ Phase 2 (learn services) ── prerequisite for /learn UI
        ├─ Phase 3 (shell)
        │    └─ Phase 4 (home + dashboard)
        │         ├─ Phase 5 (syllabus + lesson)
        │         ├─ Phase 6 (projects + rubrics)  ← also needs rubric tables (Phase 1)
        │         ├─ Phase 7 (quiz)
        │         └─ Phase 8 (notes/bookmarks/resources/community/certificate/activity)
Phase 9 (studio builder)       ── parallelizable after Phase 1 (independent of /learn UI)
Phase 10 (QA/verify/docs)      ── last; gates on lint/build/verify + migration apply
```

Middleware + RBAC gating (Phase 10 items) should land **before** the first `/learn` page is testable in
a gated org, so wire those small edits early alongside Phase 3.

---

## 17. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Route group `(learn)` still shows admin sidebar | Sibling group with own `layout.tsx`; verify no `(app)` inheritance |
| Migration not idempotent on re-apply | `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` / `DROP POLICY IF EXISTS`; test double-apply |
| Bloating `lms.ts` | New `learn.ts` + `lms-builder.ts`; only export shared helpers |
| Quiz answer leakage in new payloads | Central `getClassroomQuiz` sanitizer; unit assertion in verify/QA |
| RLS gaps on private tables | Reuse audited helpers + `lms_owns_enrollment`; verify script asserts RLS enabled |
| Direct DB migration blocked on network | Use `npm run apply:supabase-sql -- db/schema_v44_...sql` fallback |
| Scope creep (cloud IDE, PDF, payments) | Explicitly deferred per brief §22 |

---

## 18. Deferred (out of scope for v44)

Cloud IDE / VS Code server / Jupyter, auto-grading, AI recommendations, PDF certificates, public academy,
payments, video transcoding, live sessions, advanced learning-path automation. (Brief §11, §22.)
