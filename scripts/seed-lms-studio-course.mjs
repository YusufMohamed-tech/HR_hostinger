import process from "node:process";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
const projectRef = supabaseUrl?.match(/^https:\/\/([^.]+)\./)?.[1];

if (!projectRef || !accessToken) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_ACCESS_TOKEN in .env.local");
  process.exit(1);
}

const youtubeUrl = "https://youtu.be/hWLntHwHBMA?si=lL0hNF1XvDbThIcs";
const courseTitle = "LMS Studio Masterclass - Complete Corporate Training";

const sql = String.raw`
DO $$
#variable_conflict use_variable
DECLARE
  org_record record;
  course_id uuid;
  category_id uuid;
  creator_user_id uuid;
  instructor_employee_id uuid;
  section_intro_id uuid;
  section_content_id uuid;
  section_assessment_id uuid;
  section_community_id uuid;
  lesson_intro_id uuid;
  lesson_video_id uuid;
  lesson_document_id uuid;
  lesson_builder_id uuid;
  lesson_storage_id uuid;
  lesson_quiz_id uuid;
  lesson_project_id uuid;
  lesson_community_id uuid;
  quiz_id uuid;
  task_id uuid;
  rubric_id uuid;
  post_id uuid;
  announcement_id uuid;
  assignment_rule_id uuid;
  item_id uuid;
  instructor_row_id uuid;
  workspace_config_id uuid;
BEGIN
  FOR org_record IN
    SELECT o.id, o.name
    FROM public.organizations o
    WHERE EXISTS (
      SELECT 1
      FROM public.employees e
      WHERE e.org_id = o.id
        AND coalesce(e.status, 'Active') ILIKE 'active'
    )
  LOOP
    INSERT INTO public.organization_features (org_id, plan_code, lms_enabled, enabled_modules)
    VALUES (
      org_record.id,
      'pro',
      true,
      '["hr", "sales", "recruitment", "accounting", "chat", "assets", "payroll", "personnel", "lms"]'::jsonb
    )
    ON CONFLICT (org_id) DO UPDATE SET
      lms_enabled = true,
      enabled_modules = CASE
        WHEN public.organization_features.enabled_modules ? 'lms'
          THEN public.organization_features.enabled_modules
        ELSE public.organization_features.enabled_modules || '["lms"]'::jsonb
      END,
      updated_at = now();

    SELECT p.user_id INTO creator_user_id
    FROM public.profiles p
    WHERE p.org_id = org_record.id
    ORDER BY p.created_at
    LIMIT 1;

    SELECT e.id INTO instructor_employee_id
    FROM public.employees e
    WHERE e.org_id = org_record.id
      AND coalesce(e.status, 'Active') ILIKE 'active'
    ORDER BY e.created_at
    LIMIT 1;

    INSERT INTO public.lms_categories (org_id, name, description, color, is_active)
    VALUES (
      org_record.id,
      'LMS Studio Training',
      'Seeded professional LMS Studio training course.',
      '#58b947',
      true
    )
    ON CONFLICT (org_id, name) DO UPDATE SET
      description = excluded.description,
      color = excluded.color,
      is_active = true,
      updated_at = now()
    RETURNING id INTO category_id;

    SELECT id INTO course_id
    FROM public.lms_courses
    WHERE org_id = org_record.id
      AND title = '${courseTitle}'
    LIMIT 1;

    IF course_id IS NULL THEN
      INSERT INTO public.lms_courses (
        org_id,
        category_id,
        title,
        subtitle,
        description,
        status,
        visibility,
        difficulty,
        estimated_minutes,
        passing_score,
        requires_quiz_pass,
        requires_task_pass,
        created_by,
        published_at,
        learning_outcomes,
        skills_gained,
        tags,
        language,
        experience_type,
        target_audience,
        prerequisites,
        certificate_enabled,
        certificate_title,
        certificate_description,
        certificate_signatory
      )
      VALUES (
        org_record.id,
        category_id,
        '${courseTitle}',
        'Full seeded course for testing the professional LMS Studio',
        'A complete corporate training course seeded for QA: sections, text lessons, video lesson, resources, quiz, project, rubric, community, assignment, notifications, and certificate settings.',
        'published',
        'catalog',
        'beginner',
        120,
        70,
        true,
        true,
        creator_user_id,
        now(),
        '["Navigate the Course Studio", "Create sections and rich lessons", "Use video and document content", "Build quizzes and projects", "Review learner progress and issue certificates"]'::jsonb,
        '["Course design", "LMS administration", "Assessment design", "Instructor review", "Learner engagement"]'::jsonb,
        '["lms", "studio", "corporate-training", "qa"]'::jsonb,
        'ar',
        'course',
        'HR admins, training managers, instructors, and employees who need to understand the LMS experience.',
        'Basic HRMS access and LMS enabled for the organization.',
        true,
        'Certificate of LMS Studio Completion',
        'Awarded after completing the seeded LMS Studio training course.',
        'Training Department'
      )
      RETURNING id INTO course_id;
    ELSE
      UPDATE public.lms_courses
      SET
        category_id = category_id,
        subtitle = 'Full seeded course for testing the professional LMS Studio',
        description = 'A complete corporate training course seeded for QA: sections, text lessons, video lesson, resources, quiz, project, rubric, community, assignment, notifications, and certificate settings.',
        status = 'published',
        visibility = 'catalog',
        difficulty = 'beginner',
        estimated_minutes = 120,
        passing_score = 70,
        requires_quiz_pass = true,
        requires_task_pass = true,
        published_at = coalesce(published_at, now()),
        learning_outcomes = '["Navigate the Course Studio", "Create sections and rich lessons", "Use video and document content", "Build quizzes and projects", "Review learner progress and issue certificates"]'::jsonb,
        skills_gained = '["Course design", "LMS administration", "Assessment design", "Instructor review", "Learner engagement"]'::jsonb,
        tags = '["lms", "studio", "corporate-training", "qa"]'::jsonb,
        language = 'ar',
        experience_type = 'course',
        target_audience = 'HR admins, training managers, instructors, and employees who need to understand the LMS experience.',
        prerequisites = 'Basic HRMS access and LMS enabled for the organization.',
        certificate_enabled = true,
        certificate_title = 'Certificate of LMS Studio Completion',
        certificate_description = 'Awarded after completing the seeded LMS Studio training course.',
        certificate_signatory = 'Training Department',
        archived_at = null,
        updated_at = now()
      WHERE id = course_id;
    END IF;

    IF instructor_employee_id IS NOT NULL THEN
      SELECT ci.id INTO instructor_row_id
      FROM public.lms_course_instructors ci
      WHERE ci.org_id = org_record.id
        AND ci.course_id = course_id
        AND ci.employee_id = instructor_employee_id
      ORDER BY ci.created_at
      LIMIT 1;

      IF instructor_row_id IS NULL THEN
        INSERT INTO public.lms_course_instructors (
          org_id,
          course_id,
          employee_id,
          instructor_type,
          can_edit_content,
          can_review_tasks,
          can_moderate_community,
          assigned_by
        )
        VALUES (
          org_record.id,
          course_id,
          instructor_employee_id,
          'primary_instructor',
          true,
          true,
          true,
          creator_user_id
        );
      ELSE
        UPDATE public.lms_course_instructors
        SET
          instructor_type = 'primary_instructor',
          can_edit_content = true,
          can_review_tasks = true,
          can_moderate_community = true,
          assigned_by = creator_user_id,
          updated_at = now()
        WHERE id = instructor_row_id;
      END IF;
    END IF;

    SELECT s.id INTO section_intro_id FROM public.lms_course_sections s WHERE s.org_id = org_record.id AND s.course_id = course_id AND s.title = '1. التهيئة وفهم منصة التعلم' LIMIT 1;
    IF section_intro_id IS NULL THEN
      INSERT INTO public.lms_course_sections (org_id, course_id, title, description, sort_order, section_type, estimated_minutes)
      VALUES (org_record.id, course_id, '1. التهيئة وفهم منصة التعلم', 'مقدمة عن تجربة LMS للموظفين والمدربين.', 1, 'module', 20)
      RETURNING id INTO section_intro_id;
    ELSE
      UPDATE public.lms_course_sections SET description = 'مقدمة عن تجربة LMS للموظفين والمدربين.', sort_order = 1, section_type = 'module', estimated_minutes = 20, updated_at = now() WHERE id = section_intro_id;
    END IF;

    SELECT s.id INTO section_content_id FROM public.lms_course_sections s WHERE s.org_id = org_record.id AND s.course_id = course_id AND s.title = '2. بناء المحتوى داخل الاستوديو' LIMIT 1;
    IF section_content_id IS NULL THEN
      INSERT INTO public.lms_course_sections (org_id, course_id, title, description, sort_order, section_type, estimated_minutes)
      VALUES (org_record.id, course_id, '2. بناء المحتوى داخل الاستوديو', 'تجهيز الأقسام والدروس والمواد داخل Course Studio.', 2, 'module', 35)
      RETURNING id INTO section_content_id;
    ELSE
      UPDATE public.lms_course_sections SET description = 'تجهيز الأقسام والدروس والمواد داخل Course Studio.', sort_order = 2, section_type = 'module', estimated_minutes = 35, updated_at = now() WHERE id = section_content_id;
    END IF;

    SELECT s.id INTO section_assessment_id FROM public.lms_course_sections s WHERE s.org_id = org_record.id AND s.course_id = course_id AND s.title = '3. التقييمات والمشاريع' LIMIT 1;
    IF section_assessment_id IS NULL THEN
      INSERT INTO public.lms_course_sections (org_id, course_id, title, description, sort_order, section_type, estimated_minutes, is_milestone)
      VALUES (org_record.id, course_id, '3. التقييمات والمشاريع', 'اختبار قصير ومشروع قابل للمراجعة بمعايير تقييم.', 3, 'module', 45, true)
      RETURNING id INTO section_assessment_id;
    ELSE
      UPDATE public.lms_course_sections SET description = 'اختبار قصير ومشروع قابل للمراجعة بمعايير تقييم.', sort_order = 3, section_type = 'module', estimated_minutes = 45, is_milestone = true, updated_at = now() WHERE id = section_assessment_id;
    END IF;

    SELECT s.id INTO section_community_id FROM public.lms_course_sections s WHERE s.org_id = org_record.id AND s.course_id = course_id AND s.title = '4. المجتمع والشهادة' LIMIT 1;
    IF section_community_id IS NULL THEN
      INSERT INTO public.lms_course_sections (org_id, course_id, title, description, sort_order, section_type, estimated_minutes)
      VALUES (org_record.id, course_id, '4. المجتمع والشهادة', 'التفاعل مع المجتمع وفهم مسار الشهادة.', 4, 'module', 20)
      RETURNING id INTO section_community_id;
    ELSE
      UPDATE public.lms_course_sections SET description = 'التفاعل مع المجتمع وفهم مسار الشهادة.', sort_order = 4, section_type = 'module', estimated_minutes = 20, updated_at = now() WHERE id = section_community_id;
    END IF;

    SELECT l.id INTO lesson_intro_id FROM public.lms_lessons l WHERE l.org_id = org_record.id AND l.course_id = course_id AND l.title = 'مرحبا بك في دورة LMS Studio' LIMIT 1;
    IF lesson_intro_id IS NULL THEN
      INSERT INTO public.lms_lessons (org_id, course_id, section_id, title, description, lesson_type, content, duration_minutes, sort_order, is_required, is_active, created_by, learning_unit_type, display_mode)
      VALUES (org_record.id, course_id, section_intro_id, 'مرحبا بك في دورة LMS Studio', 'نظرة عامة على ما ستتعلمه في الدورة.', 'text', '<h2>مرحبا بك</h2><p>هذه دورة تدريبية كاملة لتجربة الاستوديو من منظور الإدارة والمدرب والمتعلم.</p><ul><li>ستتعرف على إنشاء الأقسام والدروس.</li><li>ستشاهد فيديو تدريبي.</li><li>ستحل اختبارا قصيرا وتسلم مشروعا.</li></ul>', 8, 1, true, true, creator_user_id, 'lesson', 'article')
      RETURNING id INTO lesson_intro_id;
    ELSE
      UPDATE public.lms_lessons SET section_id = section_intro_id, description = 'نظرة عامة على ما ستتعلمه في الدورة.', lesson_type = 'text', content = '<h2>مرحبا بك</h2><p>هذه دورة تدريبية كاملة لتجربة الاستوديو من منظور الإدارة والمدرب والمتعلم.</p><ul><li>ستتعرف على إنشاء الأقسام والدروس.</li><li>ستشاهد فيديو تدريبي.</li><li>ستحل اختبارا قصيرا وتسلم مشروعا.</li></ul>', duration_minutes = 8, sort_order = 1, is_required = true, is_active = true, learning_unit_type = 'lesson', display_mode = 'article', updated_at = now() WHERE id = lesson_intro_id;
    END IF;

    SELECT l.id INTO lesson_video_id FROM public.lms_lessons l WHERE l.org_id = org_record.id AND l.course_id = course_id AND l.title = 'فيديو: بناء تجربة تعلم احترافية' LIMIT 1;
    IF lesson_video_id IS NULL THEN
      INSERT INTO public.lms_lessons (org_id, course_id, section_id, title, description, lesson_type, content_url, duration_minutes, sort_order, is_required, is_active, created_by, learning_unit_type, display_mode)
      VALUES (org_record.id, course_id, section_intro_id, 'فيديو: بناء تجربة تعلم احترافية', 'درس فيديو خارجي لتجربة تشغيل الفيديو داخل الدورة.', 'video', '${youtubeUrl}', 12, 2, true, true, creator_user_id, 'lesson', 'video')
      RETURNING id INTO lesson_video_id;
    ELSE
      UPDATE public.lms_lessons SET section_id = section_intro_id, description = 'درس فيديو خارجي لتجربة تشغيل الفيديو داخل الدورة.', lesson_type = 'video', content_url = '${youtubeUrl}', duration_minutes = 12, sort_order = 2, is_required = true, is_active = true, learning_unit_type = 'lesson', display_mode = 'video', updated_at = now() WHERE id = lesson_video_id;
    END IF;

    SELECT l.id INTO lesson_document_id FROM public.lms_lessons l WHERE l.org_id = org_record.id AND l.course_id = course_id AND l.title = 'دليل سريع: أين أجد كل شيء؟' LIMIT 1;
    IF lesson_document_id IS NULL THEN
      INSERT INTO public.lms_lessons (org_id, course_id, section_id, title, description, lesson_type, content, duration_minutes, sort_order, is_required, is_active, created_by, learning_unit_type, display_mode)
      VALUES (org_record.id, course_id, section_intro_id, 'دليل سريع: أين أجد كل شيء؟', 'دليل نصي قصير للتنقل داخل الدورة.', 'text', '<h2>خريطة سريعة</h2><p>افتح تبويب البناء لإدارة الهيكل. استخدم الإعدادات لضبط بيانات الدورة. استخدم المصادر والروبرك والمجتمع لتجهيز التجربة كاملة.</p>', 10, 3, true, true, creator_user_id, 'resource', 'article')
      RETURNING id INTO lesson_document_id;
    ELSE
      UPDATE public.lms_lessons SET section_id = section_intro_id, description = 'دليل نصي قصير للتنقل داخل الدورة.', lesson_type = 'text', content = '<h2>خريطة سريعة</h2><p>افتح تبويب البناء لإدارة الهيكل. استخدم الإعدادات لضبط بيانات الدورة. استخدم المصادر والروبرك والمجتمع لتجهيز التجربة كاملة.</p>', duration_minutes = 10, sort_order = 3, is_required = true, is_active = true, learning_unit_type = 'resource', display_mode = 'article', updated_at = now() WHERE id = lesson_document_id;
    END IF;

    SELECT l.id INTO lesson_builder_id FROM public.lms_lessons l WHERE l.org_id = org_record.id AND l.course_id = course_id AND l.title = 'إضافة الأقسام والدروس والأنشطة' LIMIT 1;
    IF lesson_builder_id IS NULL THEN
      INSERT INTO public.lms_lessons (org_id, course_id, section_id, title, description, lesson_type, content, duration_minutes, sort_order, is_required, is_active, created_by, learning_unit_type, display_mode)
      VALUES (org_record.id, course_id, section_content_id, 'إضافة الأقسام والدروس والأنشطة', 'طريقة بناء هيكل الدورة من داخل الاستوديو.', 'text', '<h2>إضافة قسم</h2><p>اضغط <strong>إضافة نشاط</strong> ثم اختر <strong>قسم جديد</strong> أو استخدم زر + داخل خريطة الدورة.</p><h2>إضافة درس</h2><p>اختر صفحة نصية أو فيديو أو مستند أو رابط ثم حرر التفاصيل من اللوحة الرئيسية.</p>', 15, 1, true, true, creator_user_id, 'lesson', 'article')
      RETURNING id INTO lesson_builder_id;
    ELSE
      UPDATE public.lms_lessons SET section_id = section_content_id, description = 'طريقة بناء هيكل الدورة من داخل الاستوديو.', lesson_type = 'text', content = '<h2>إضافة قسم</h2><p>اضغط <strong>إضافة نشاط</strong> ثم اختر <strong>قسم جديد</strong> أو استخدم زر + داخل خريطة الدورة.</p><h2>إضافة درس</h2><p>اختر صفحة نصية أو فيديو أو مستند أو رابط ثم حرر التفاصيل من اللوحة الرئيسية.</p>', duration_minutes = 15, sort_order = 1, is_required = true, is_active = true, learning_unit_type = 'lesson', display_mode = 'article', updated_at = now() WHERE id = lesson_builder_id;
    END IF;

    SELECT l.id INTO lesson_storage_id FROM public.lms_lessons l WHERE l.org_id = org_record.id AND l.course_id = course_id AND l.title = 'الملفات الخاصة ومسارات التخزين' LIMIT 1;
    IF lesson_storage_id IS NULL THEN
      INSERT INTO public.lms_lessons (org_id, course_id, section_id, title, description, lesson_type, content, duration_minutes, sort_order, is_required, is_active, created_by, learning_unit_type, display_mode)
      VALUES (org_record.id, course_id, section_content_id, 'الملفات الخاصة ومسارات التخزين', 'شرح عملي لفكرة مسار التخزين الخاص.', 'text', '<h2>مسار التخزين الخاص</h2><p>هذا الحقل يمتلئ تلقائيا بعد رفع ملف إلى bucket خاص. لا تكتب فيه يدويا إلا إذا كنت تعرف المسار.</p><p>الملفات تظهر للمتعلم عبر signed URL فقط.</p>', 10, 2, true, true, creator_user_id, 'lesson', 'article')
      RETURNING id INTO lesson_storage_id;
    ELSE
      UPDATE public.lms_lessons SET section_id = section_content_id, description = 'شرح عملي لفكرة مسار التخزين الخاص.', lesson_type = 'text', content = '<h2>مسار التخزين الخاص</h2><p>هذا الحقل يمتلئ تلقائيا بعد رفع ملف إلى bucket خاص. لا تكتب فيه يدويا إلا إذا كنت تعرف المسار.</p><p>الملفات تظهر للمتعلم عبر signed URL فقط.</p>', duration_minutes = 10, sort_order = 2, is_required = true, is_active = true, learning_unit_type = 'lesson', display_mode = 'article', updated_at = now() WHERE id = lesson_storage_id;
    END IF;

    SELECT l.id INTO lesson_quiz_id FROM public.lms_lessons l WHERE l.org_id = org_record.id AND l.course_id = course_id AND l.title = 'الاختبارات الآمنة داخل LMS' LIMIT 1;
    IF lesson_quiz_id IS NULL THEN
      INSERT INTO public.lms_lessons (org_id, course_id, section_id, title, description, lesson_type, content, duration_minutes, sort_order, is_required, is_active, created_by, learning_unit_type, display_mode)
      VALUES (org_record.id, course_id, section_assessment_id, 'الاختبارات الآمنة داخل LMS', 'شرح منع تسريب الإجابات قبل التسليم.', 'text', '<p>الاختبار يخزن الإجابات الصحيحة في قاعدة البيانات، لكن واجهات المتعلم لا تعرضها قبل التسليم.</p>', 8, 1, true, true, creator_user_id, 'lesson', 'article')
      RETURNING id INTO lesson_quiz_id;
    ELSE
      UPDATE public.lms_lessons SET section_id = section_assessment_id, description = 'شرح منع تسريب الإجابات قبل التسليم.', lesson_type = 'text', content = '<p>الاختبار يخزن الإجابات الصحيحة في قاعدة البيانات، لكن واجهات المتعلم لا تعرضها قبل التسليم.</p>', duration_minutes = 8, sort_order = 1, is_required = true, is_active = true, learning_unit_type = 'lesson', display_mode = 'article', updated_at = now() WHERE id = lesson_quiz_id;
    END IF;

    SELECT l.id INTO lesson_project_id FROM public.lms_lessons l WHERE l.org_id = org_record.id AND l.course_id = course_id AND l.title = 'المشروع النهائي ومعايير التقييم' LIMIT 1;
    IF lesson_project_id IS NULL THEN
      INSERT INTO public.lms_lessons (org_id, course_id, section_id, title, description, lesson_type, content, duration_minutes, sort_order, is_required, is_active, created_by, learning_unit_type, display_mode)
      VALUES (org_record.id, course_id, section_assessment_id, 'المشروع النهائي ومعايير التقييم', 'مقدمة عن المشروع النهائي.', 'text', '<p>في نهاية الدورة ستسلم خطة قصيرة لدورة داخلية. سيراجعها المدرب باستخدام rubrics واضحة.</p>', 7, 2, true, true, creator_user_id, 'lesson', 'article')
      RETURNING id INTO lesson_project_id;
    ELSE
      UPDATE public.lms_lessons SET section_id = section_assessment_id, description = 'مقدمة عن المشروع النهائي.', lesson_type = 'text', content = '<p>في نهاية الدورة ستسلم خطة قصيرة لدورة داخلية. سيراجعها المدرب باستخدام rubrics واضحة.</p>', duration_minutes = 7, sort_order = 2, is_required = true, is_active = true, learning_unit_type = 'lesson', display_mode = 'article', updated_at = now() WHERE id = lesson_project_id;
    END IF;

    SELECT l.id INTO lesson_community_id FROM public.lms_lessons l WHERE l.org_id = org_record.id AND l.course_id = course_id AND l.title = 'المجتمع والشهادات' LIMIT 1;
    IF lesson_community_id IS NULL THEN
      INSERT INTO public.lms_lessons (org_id, course_id, section_id, title, description, lesson_type, content, duration_minutes, sort_order, is_required, is_active, created_by, learning_unit_type, display_mode)
      VALUES (org_record.id, course_id, section_community_id, 'المجتمع والشهادات', 'استخدام المجتمع وإصدار الشهادة.', 'text', '<p>استخدم مجتمع الدورة للأسئلة والإعلانات. عند اكتمال الدروس والاختبار والمشروع، يتم إصدار الشهادة مرة واحدة.</p>', 10, 1, true, true, creator_user_id, 'lesson', 'article')
      RETURNING id INTO lesson_community_id;
    ELSE
      UPDATE public.lms_lessons SET section_id = section_community_id, description = 'استخدام المجتمع وإصدار الشهادة.', lesson_type = 'text', content = '<p>استخدم مجتمع الدورة للأسئلة والإعلانات. عند اكتمال الدروس والاختبار والمشروع، يتم إصدار الشهادة مرة واحدة.</p>', duration_minutes = 10, sort_order = 1, is_required = true, is_active = true, learning_unit_type = 'lesson', display_mode = 'article', updated_at = now() WHERE id = lesson_community_id;
    END IF;

    SELECT q.id INTO quiz_id FROM public.lms_quizzes q WHERE q.org_id = org_record.id AND q.course_id = course_id AND q.title = 'اختبار فهم LMS Studio' LIMIT 1;
    IF quiz_id IS NULL THEN
      INSERT INTO public.lms_quizzes (org_id, course_id, lesson_id, title, description, passing_score, max_attempts, time_limit_minutes, is_required, is_active, created_by)
      VALUES (org_record.id, course_id, lesson_quiz_id, 'اختبار فهم LMS Studio', 'اختبار قصير للتأكد من فهم أساسيات الاستوديو.', 70, 3, 20, true, true, creator_user_id)
      RETURNING id INTO quiz_id;
    ELSE
      UPDATE public.lms_quizzes SET lesson_id = lesson_quiz_id, description = 'اختبار قصير للتأكد من فهم أساسيات الاستوديو.', passing_score = 70, max_attempts = 3, time_limit_minutes = 20, is_required = true, is_active = true, updated_at = now() WHERE id = quiz_id;
    END IF;

    SELECT qq.id INTO item_id FROM public.lms_quiz_questions qq WHERE qq.org_id = org_record.id AND qq.quiz_id = quiz_id AND qq.question_text = 'من أين تضيف قسما جديدا في Course Studio؟' LIMIT 1;
    IF item_id IS NULL THEN
      INSERT INTO public.lms_quiz_questions (org_id, quiz_id, question_text, question_type, options_json, correct_answer_json, points, sort_order)
      VALUES (org_record.id, quiz_id, 'من أين تضيف قسما جديدا في Course Studio؟', 'single_choice', '[{"label":"من زر إضافة نشاط أو زر + في خريطة الدورة","value":"a"},{"label":"من صفحة الرواتب","value":"b"},{"label":"من صفحة الحضور","value":"c"}]'::jsonb, to_jsonb('a'::text), 1, 1);
    ELSE
      UPDATE public.lms_quiz_questions SET question_type = 'single_choice', options_json = '[{"label":"من زر إضافة نشاط أو زر + في خريطة الدورة","value":"a"},{"label":"من صفحة الرواتب","value":"b"},{"label":"من صفحة الحضور","value":"c"}]'::jsonb, correct_answer_json = to_jsonb('a'::text), points = 1, sort_order = 1, updated_at = now() WHERE id = item_id;
    END IF;

    SELECT qq.id INTO item_id FROM public.lms_quiz_questions qq WHERE qq.org_id = org_record.id AND qq.quiz_id = quiz_id AND qq.question_text = 'هل يجب كتابة مسار التخزين الخاص يدويا عادة؟' LIMIT 1;
    IF item_id IS NULL THEN
      INSERT INTO public.lms_quiz_questions (org_id, quiz_id, question_text, question_type, options_json, correct_answer_json, points, sort_order)
      VALUES (org_record.id, quiz_id, 'هل يجب كتابة مسار التخزين الخاص يدويا عادة؟', 'true_false', '[{"label":"صح","value":"true"},{"label":"خطأ","value":"false"}]'::jsonb, to_jsonb('false'::text), 1, 2);
    ELSE
      UPDATE public.lms_quiz_questions SET question_type = 'true_false', options_json = '[{"label":"صح","value":"true"},{"label":"خطأ","value":"false"}]'::jsonb, correct_answer_json = to_jsonb('false'::text), points = 1, sort_order = 2, updated_at = now() WHERE id = item_id;
    END IF;

    SELECT qq.id INTO item_id FROM public.lms_quiz_questions qq WHERE qq.org_id = org_record.id AND qq.quiz_id = quiz_id AND qq.question_text = 'ما العناصر التي يمكن إدارتها من الاستوديو؟' LIMIT 1;
    IF item_id IS NULL THEN
      INSERT INTO public.lms_quiz_questions (org_id, quiz_id, question_text, question_type, options_json, correct_answer_json, points, sort_order)
      VALUES (org_record.id, quiz_id, 'ما العناصر التي يمكن إدارتها من الاستوديو؟', 'multiple_choice', '[{"label":"الدروس","value":"lessons"},{"label":"الاختبارات","value":"quizzes"},{"label":"المشاريع","value":"projects"},{"label":"المجتمع","value":"community"}]'::jsonb, '["lessons","quizzes","projects","community"]'::jsonb, 2, 3);
    ELSE
      UPDATE public.lms_quiz_questions SET question_type = 'multiple_choice', options_json = '[{"label":"الدروس","value":"lessons"},{"label":"الاختبارات","value":"quizzes"},{"label":"المشاريع","value":"projects"},{"label":"المجتمع","value":"community"}]'::jsonb, correct_answer_json = '["lessons","quizzes","projects","community"]'::jsonb, points = 2, sort_order = 3, updated_at = now() WHERE id = item_id;
    END IF;

    SELECT t.id INTO task_id FROM public.lms_tasks t WHERE t.org_id = org_record.id AND t.course_id = course_id AND t.title = 'مشروع: صمم هيكل دورة داخلية' LIMIT 1;
    IF task_id IS NULL THEN
      INSERT INTO public.lms_tasks (org_id, course_id, lesson_id, title, description, task_type, instructions, max_score, pass_score, is_required, allow_resubmission, late_submission_allowed, status, created_by, why_it_matters, estimated_minutes)
      VALUES (org_record.id, course_id, lesson_project_id, 'مشروع: صمم هيكل دورة داخلية', 'مشروع تطبيقي قصير لاختبار تسليمات المتعلم ومراجعة المدرب.', 'mixed', '<h2>المطلوب</h2><p>اكتب خطة مختصرة لدورة داخلية تشمل: الأقسام، درس فيديو، اختبار، مشروع، ومجتمع الدورة.</p><p>يمكنك تسليم نص أو رابط أو ملف.</p>', 100, 70, true, true, true, 'published', creator_user_id, 'This project proves that the learner can use the LMS Studio workflow in a real internal training scenario.', 35)
      RETURNING id INTO task_id;
    ELSE
      UPDATE public.lms_tasks SET lesson_id = lesson_project_id, description = 'مشروع تطبيقي قصير لاختبار تسليمات المتعلم ومراجعة المدرب.', task_type = 'mixed', instructions = '<h2>المطلوب</h2><p>اكتب خطة مختصرة لدورة داخلية تشمل: الأقسام، درس فيديو، اختبار، مشروع، ومجتمع الدورة.</p><p>يمكنك تسليم نص أو رابط أو ملف.</p>', max_score = 100, pass_score = 70, is_required = true, allow_resubmission = true, late_submission_allowed = true, status = 'published', why_it_matters = 'This project proves that the learner can use the LMS Studio workflow in a real internal training scenario.', estimated_minutes = 35, updated_at = now() WHERE id = task_id;
    END IF;

    SELECT r.id INTO rubric_id
    FROM public.lms_project_rubrics r
    WHERE r.org_id = org_record.id
      AND r.task_id = task_id
    ORDER BY r.created_at
    LIMIT 1;

    IF rubric_id IS NULL THEN
      INSERT INTO public.lms_project_rubrics (org_id, task_id, course_id, title, description, total_points, pass_points, created_by)
      VALUES (org_record.id, task_id, course_id, 'معايير تقييم مشروع LMS Studio', 'Rubric seeded for instructor review testing.', 100, 70, creator_user_id)
      RETURNING id INTO rubric_id;
    ELSE
      UPDATE public.lms_project_rubrics
      SET
        course_id = course_id,
        title = 'معايير تقييم مشروع LMS Studio',
        description = 'Rubric seeded for instructor review testing.',
        total_points = 100,
        pass_points = 70,
        updated_at = now()
      WHERE id = rubric_id;
    END IF;

    SELECT ri.id INTO item_id FROM public.lms_project_rubric_items ri WHERE ri.org_id = org_record.id AND ri.rubric_id = rubric_id AND ri.title = 'هيكل الدورة' LIMIT 1;
    IF item_id IS NULL THEN
      INSERT INTO public.lms_project_rubric_items (org_id, rubric_id, task_id, course_id, title, description, passing_criteria, points, sort_order)
      VALUES (org_record.id, rubric_id, task_id, course_id, 'هيكل الدورة', 'Course structure quality.', 'يتضمن 3 أقسام على الأقل وترتيبا واضحا للدروس.', 30, 1);
    ELSE
      UPDATE public.lms_project_rubric_items SET description = 'Course structure quality.', passing_criteria = 'يتضمن 3 أقسام على الأقل وترتيبا واضحا للدروس.', points = 30, sort_order = 1, updated_at = now() WHERE id = item_id;
    END IF;

    SELECT ri.id INTO item_id FROM public.lms_project_rubric_items ri WHERE ri.org_id = org_record.id AND ri.rubric_id = rubric_id AND ri.title = 'التقييمات والمهام' LIMIT 1;
    IF item_id IS NULL THEN
      INSERT INTO public.lms_project_rubric_items (org_id, rubric_id, task_id, course_id, title, description, passing_criteria, points, sort_order)
      VALUES (org_record.id, rubric_id, task_id, course_id, 'التقييمات والمهام', 'Assessment design.', 'يتضمن اختبارا ومهمة واضحة مع درجة نجاح.', 35, 2);
    ELSE
      UPDATE public.lms_project_rubric_items SET description = 'Assessment design.', passing_criteria = 'يتضمن اختبارا ومهمة واضحة مع درجة نجاح.', points = 35, sort_order = 2, updated_at = now() WHERE id = item_id;
    END IF;

    SELECT ri.id INTO item_id FROM public.lms_project_rubric_items ri WHERE ri.org_id = org_record.id AND ri.rubric_id = rubric_id AND ri.title = 'وضوح تجربة المتعلم' LIMIT 1;
    IF item_id IS NULL THEN
      INSERT INTO public.lms_project_rubric_items (org_id, rubric_id, task_id, course_id, title, description, passing_criteria, points, sort_order)
      VALUES (org_record.id, rubric_id, task_id, course_id, 'وضوح تجربة المتعلم', 'Learner experience clarity.', 'المتعلم يعرف ماذا يقرأ ويشاهد ويسلم وكيف يحصل على الشهادة.', 35, 3);
    ELSE
      UPDATE public.lms_project_rubric_items SET description = 'Learner experience clarity.', passing_criteria = 'المتعلم يعرف ماذا يقرأ ويشاهد ويسلم وكيف يحصل على الشهادة.', points = 35, sort_order = 3, updated_at = now() WHERE id = item_id;
    END IF;

    SELECT wc.id INTO workspace_config_id
    FROM public.lms_workspace_configs wc
    WHERE wc.org_id = org_record.id
      AND wc.course_id = course_id
      AND wc.task_id = task_id
    ORDER BY wc.created_at
    LIMIT 1;

    IF workspace_config_id IS NULL THEN
      INSERT INTO public.lms_workspace_configs (org_id, course_id, task_id, workspace_type, external_url, instructions, created_by)
      VALUES (org_record.id, course_id, task_id, 'external_link', 'https://docs.google.com/', 'استخدم أي مستند خارجي لصياغة خطة الدورة ثم أرسل الرابط في المشروع.', creator_user_id);
    ELSE
      UPDATE public.lms_workspace_configs
      SET
        workspace_type = 'external_link',
        external_url = 'https://docs.google.com/',
        instructions = 'استخدم أي مستند خارجي لصياغة خطة الدورة ثم أرسل الرابط في المشروع.',
        updated_at = now()
      WHERE id = workspace_config_id;
    END IF;

    SELECT cr.id INTO item_id FROM public.lms_course_resources cr WHERE cr.org_id = org_record.id AND cr.course_id = course_id AND cr.title = 'رابط فيديو الدورة' LIMIT 1;
    IF item_id IS NULL THEN
      INSERT INTO public.lms_course_resources (org_id, course_id, lesson_id, title, description, resource_type, external_url, sort_order, is_active, created_by)
      VALUES (org_record.id, course_id, lesson_video_id, 'رابط فيديو الدورة', 'YouTube video used by the seeded LMS course.', 'video', '${youtubeUrl}', 1, true, creator_user_id);
    ELSE
      UPDATE public.lms_course_resources SET lesson_id = lesson_video_id, description = 'YouTube video used by the seeded LMS course.', resource_type = 'video', external_url = '${youtubeUrl}', sort_order = 1, is_active = true, updated_at = now() WHERE id = item_id;
    END IF;

    SELECT cr.id INTO item_id FROM public.lms_course_resources cr WHERE cr.org_id = org_record.id AND cr.course_id = course_id AND cr.title = 'Handout: Using the LMS Course Studio' LIMIT 1;
    IF item_id IS NULL THEN
      INSERT INTO public.lms_course_resources (org_id, course_id, title, description, resource_type, external_url, sort_order, is_active, created_by)
      VALUES (org_record.id, course_id, 'Handout: Using the LMS Course Studio', 'Open the repository handout document for trainers and admins.', 'external_link', '/documentations/lms-course-studio-handout.md', 2, true, creator_user_id);
    ELSE
      UPDATE public.lms_course_resources SET description = 'Open the repository handout document for trainers and admins.', resource_type = 'external_link', external_url = '/documentations/lms-course-studio-handout.md', sort_order = 2, is_active = true, updated_at = now() WHERE id = item_id;
    END IF;

    SELECT a.id INTO announcement_id FROM public.lms_course_announcements a WHERE a.org_id = org_record.id AND a.course_id = course_id AND a.title = 'مرحبا بكم في دورة LMS Studio' LIMIT 1;
    IF announcement_id IS NULL THEN
      INSERT INTO public.lms_course_announcements (org_id, course_id, title, body, pinned, created_by)
      VALUES (org_record.id, course_id, 'مرحبا بكم في دورة LMS Studio', 'تم تجهيز هذه الدورة للتجربة الكاملة: شاهد الفيديو، أكمل الاختبار، وسلم المشروع.', true, creator_user_id);
    ELSE
      UPDATE public.lms_course_announcements SET body = 'تم تجهيز هذه الدورة للتجربة الكاملة: شاهد الفيديو، أكمل الاختبار، وسلم المشروع.', pinned = true, published_at = now(), updated_at = now() WHERE id = announcement_id;
    END IF;

    IF instructor_employee_id IS NOT NULL THEN
      SELECT cp.id INTO post_id FROM public.lms_community_posts cp WHERE cp.org_id = org_record.id AND cp.course_id = course_id AND cp.title = 'سؤال نقاش: كيف ستستخدم الاستوديو؟' LIMIT 1;
      IF post_id IS NULL THEN
        INSERT INTO public.lms_community_posts (org_id, course_id, employee_id, post_type, title, body, is_pinned)
        VALUES (org_record.id, course_id, instructor_employee_id, 'question', 'سؤال نقاش: كيف ستستخدم الاستوديو؟', 'شارك مثالا لدورة داخلية تريد بناءها باستخدام Course Studio.', true);
      ELSE
        UPDATE public.lms_community_posts SET employee_id = instructor_employee_id, body = 'شارك مثالا لدورة داخلية تريد بناءها باستخدام Course Studio.', is_pinned = true, updated_at = now() WHERE id = post_id;
      END IF;
    END IF;

    SELECT id INTO assignment_rule_id
    FROM public.lms_assignment_rules ar
    WHERE ar.org_id = org_record.id
      AND ar.course_id = course_id
      AND ar.assignment_type = 'all'
      AND ar.target_id IS NULL
      AND ar.is_active = true
    LIMIT 1;

    IF assignment_rule_id IS NULL THEN
      INSERT INTO public.lms_assignment_rules (org_id, course_id, assignment_type, target_id, due_date, assigned_by, is_active)
      VALUES (org_record.id, course_id, 'all', null, current_date + 14, creator_user_id, true);
    ELSE
      UPDATE public.lms_assignment_rules SET due_date = current_date + 14, assigned_by = creator_user_id, updated_at = now() WHERE id = assignment_rule_id;
    END IF;

    INSERT INTO public.lms_enrollments (org_id, course_id, employee_id, assigned_by, assigned_at, due_date, status, progress_percent)
    SELECT org_record.id, course_id, e.id, creator_user_id, now(), current_date + 14, 'assigned', 0
    FROM public.employees e
    WHERE e.org_id = org_record.id
      AND coalesce(e.status, 'Active') ILIKE 'active'
    ON CONFLICT DO NOTHING;

    INSERT INTO public.lms_learning_deadlines (org_id, enrollment_id, course_id, employee_id, source_type, source_id, label, due_at, status)
    SELECT en.org_id, en.id, en.course_id, en.employee_id, 'course', en.course_id, '${courseTitle}', (current_date + 14)::timestamptz, 'upcoming'
    FROM public.lms_enrollments en
    WHERE en.org_id = org_record.id
      AND en.course_id = course_id
      AND en.status <> 'cancelled'
      AND NOT EXISTS (
        SELECT 1
        FROM public.lms_learning_deadlines d
        WHERE d.org_id = en.org_id
          AND d.enrollment_id = en.id
          AND d.source_type = 'course'
          AND d.source_id = en.course_id
      );

    INSERT INTO public.notifications (org_id, user_id, title, body, type, link, is_read)
    SELECT org_record.id, e.user_id, 'تم تكليفك بدورة LMS Studio', '${courseTitle}', 'lms'::public.notification_type, '/learn', false
    FROM public.employees e
    WHERE e.org_id = org_record.id
      AND e.user_id IS NOT NULL
      AND coalesce(e.status, 'Active') ILIKE 'active'
      AND NOT EXISTS (
        SELECT 1
        FROM public.notifications n
        WHERE n.org_id = org_record.id
          AND n.user_id = e.user_id
          AND n.title = 'تم تكليفك بدورة LMS Studio'
          AND n.link = '/learn'
      );
  END LOOP;
END $$;

SELECT
  o.name AS organization,
  c.id AS course_id,
  c.title,
  c.status,
  c.visibility,
  (
    SELECT count(*)
    FROM public.employees e
    WHERE e.org_id = c.org_id
      AND coalesce(e.status, 'Active') ILIKE 'active'
  )::int AS active_employees,
  (
    SELECT count(*)
    FROM public.lms_enrollments en
    WHERE en.org_id = c.org_id
      AND en.course_id = c.id
      AND en.status <> 'cancelled'
  )::int AS active_enrollments,
  (
    SELECT count(*)
    FROM public.lms_lessons l
    WHERE l.org_id = c.org_id
      AND l.course_id = c.id
      AND l.is_active = true
  )::int AS lessons,
  (
    SELECT count(*)
    FROM public.lms_quizzes q
    WHERE q.org_id = c.org_id
      AND q.course_id = c.id
      AND q.is_active = true
  )::int AS quizzes,
  (
    SELECT count(*)
    FROM public.lms_tasks t
    WHERE t.org_id = c.org_id
      AND t.course_id = c.id
      AND t.status = 'published'
  )::int AS published_tasks
FROM public.lms_courses c
JOIN public.organizations o ON o.id = c.org_id
WHERE c.title = '${courseTitle}'
ORDER BY o.name;
`;

const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ query: sql }),
});

const text = await response.text();
if (!response.ok) {
  console.error(`LMS course seed failed (${response.status}): ${text}`);
  process.exit(1);
}

let payload;
try {
  payload = JSON.parse(text);
} catch {
  payload = text;
}

console.log("LMS Studio full course seed completed.");
if (Array.isArray(payload)) {
  console.table(payload);
} else if (Array.isArray(payload?.result)) {
  console.table(payload.result);
} else {
  console.log(typeof payload === "string" ? payload : JSON.stringify(payload, null, 2));
}
