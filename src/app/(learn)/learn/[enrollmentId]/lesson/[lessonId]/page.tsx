import { LessonExperience } from "@/components/lms/classroom/LessonExperience";

export default async function ClassroomLessonPage({ params }: { params: Promise<{ enrollmentId: string; lessonId: string }> }) {
  const { enrollmentId, lessonId } = await params;
  return <LessonExperience enrollmentId={enrollmentId} lessonId={lessonId} />;
}
