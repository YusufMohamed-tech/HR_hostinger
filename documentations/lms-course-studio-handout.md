# LMS Course Studio Handout

This handout explains how to use the professional LMS Course Studio to build, publish, assign, and review an internal corporate training course.

## 1. Open the Studio

1. Go to **إدارة التعلم**.
2. Open **إدارة الدورات**.
3. Click **إنشاء دورة** to create a new course shell.
4. After creation, the system opens:
   `/lms/courses/[courseId]/studio`

For an existing course, use **الاستوديو** from the course list. The old HR-style course form is no longer the main editing surface.

## 2. Main Studio Layout

The Studio has three working areas:

- **خريطة الدورة**: the course structure on the side. It shows sections, lessons, quizzes, projects, resources, and announcements.
- **لوحة العمل**: the main editor for the selected item.
- **لوحة الخصائص**: quick settings such as required/optional, visibility, sort order, duplicate, hide, and publish readiness.

The top tabs are:

- **البناء**: build sections, lessons, quizzes, and tasks.
- **الإعدادات**: title, description, outcomes, difficulty, visibility, completion rules, and certificates.
- **المدربون**: assign course-level instructors.
- **المصادر**: course-level resources and external links.
- **معايير التقييم**: project rubric setup.
- **المجتمع**: announcements and course discussion.
- **التكليفات**: assign the course to employees or groups.
- **معاينة المتعلم**: preview the learner structure.
- **قائمة النشر**: check readiness before publishing.

## 3. Add a Section

To add a section:

1. Click **إضافة نشاط** at the top of the Studio, or click the **+** button in **خريطة الدورة**.
2. Choose **قسم جديد** when available.
3. If using the current advanced options, choose **قسم مقفل** or **مرحلة** to create a section-like structure.
4. Select the new section from the course map and continue adding lessons inside it.

Recommended section examples:

- مقدمة الدورة
- المحتوى الرئيسي
- الاختبار النهائي
- المشروع النهائي
- المجتمع والشهادة

## 4. Add Lessons

Click **إضافة نشاط** and choose one of:

- **صفحة نصية**
- **فيديو**
- **مستند / PDF**
- **ملف للتحميل**
- **رابط خارجي**
- **محتوى مضمّن**

For a text lesson, use the rich document editor. It supports:

- headings
- bold
- italic
- underline
- larger/smaller text
- bullet and numbered lists
- quote blocks
- right/center/left alignment
- undo/redo
- clear formatting

## 5. Video Lessons

For a video lesson:

1. Add **فيديو** from **إضافة نشاط**.
2. Open the video lesson from the course map.
3. Put the video URL in **رابط المحتوى**.

Example seeded video:

`https://youtu.be/hWLntHwHBMA?si=lL0hNF1XvDbThIcs`

## 6. Private Files and Storage Path

The field **مسار التخزين الخاص** is for private Supabase Storage paths.

Do not type this manually in normal use.

Expected flow:

1. Select a file from **رفع ملف**.
2. Click **رفع**.
3. The system uploads the file to the private `lms-content` bucket.
4. The storage path is filled automatically.

Learners should receive files through signed URLs only.

## 7. Quizzes

To create a quiz:

1. Click **إضافة نشاط**.
2. Choose **اختبار**.
3. Select the quiz from the course map.
4. Set:
   - title
   - linked lesson
   - passing score
   - max attempts
   - time limit
5. Add questions.

Question types:

- single choice
- multiple choice
- true/false
- short answer

Correct answers are stored for scoring but must not be shown to learners before submission.

## 8. Projects and Tasks

To create a project:

1. Click **إضافة نشاط**.
2. Choose **مشروع / واجب**.
3. Add instructions.
4. Set task type:
   - text response
   - file upload
   - link submission
   - mixed
5. Publish the task when ready.

Required tasks can block course completion until accepted by an instructor or reviewer.

## 9. Rubrics

Use **معايير التقييم** for project review criteria.

Each rubric item should include:

- title
- passing criteria
- points

Example rubric:

- هيكل الدورة
- التقييمات والمهام
- وضوح تجربة المتعلم

## 10. Instructors

Use **المدربون** to assign course-level instructors.

Permissions:

- edit content
- review tasks
- moderate community

This does not create a new global role. It only grants permissions for the selected course.

## 11. Community and Announcements

Use **المجتمع** to:

- post instructor announcements
- create discussions
- ask questions
- pin important posts

Announcements notify enrolled learners.

## 12. Assign the Course

Use **التكليفات** to assign the course to:

- all active employees
- one employee
- department
- location/team

After assignment, learners should see the course in:

- `/learn`
- `/lms/my`

## 13. Publish Checklist

Before publishing, open **قائمة النشر**.

Typical required checks:

- course title exists
- course has at least one section
- required lessons exist
- required lessons contain content
- required quizzes have questions
- completion rules are valid

When critical checks pass, click **نشر**.

## 14. Learner Flow

Learner steps:

1. Open `/learn`.
2. Select the assigned course.
3. Review syllabus.
4. Open lessons.
5. Watch video.
6. Complete lessons.
7. Submit quiz.
8. Submit project/task.
9. Participate in community.
10. Receive certificate after completion rules are satisfied.

## 15. Instructor Review Flow

Instructor steps:

1. Open the instructor dashboard or course Studio.
2. Review task submissions.
3. Score using the rubric.
4. Add feedback.
5. Mark accepted, rejected, or needs revision.

Learners receive LMS notifications when reviews are completed.

## 16. Seeded QA Course

The seeded QA course is:

**LMS Studio Masterclass - Complete Corporate Training**

It includes:

- 4 sections
- text lessons
- a video lesson using the requested YouTube URL
- course resources
- quiz with questions
- required project
- rubric
- workspace config
- announcement
- community question
- course assignment to all active employees
- LMS notifications

Run the seed with:

```bash
npm run seed:lms-studio-course
```

The seed is designed to be rerunnable without duplicating active enrollments.
