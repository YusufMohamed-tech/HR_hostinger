import { LessonExperience } from "@/components/lms/classroom/LessonExperience";

export default function ClassroomLessonPage({ params }: { params: { enrollmentId: string; lessonId: string } }) {
  return <LessonExperience enrollmentId={params.enrollmentId} lessonId={params.lessonId} />;
}
