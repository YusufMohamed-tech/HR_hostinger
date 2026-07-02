import { LmsCourseEditorScreen } from "@/components/lms/LmsScreens";

export default function EditLmsCoursePage({ params }: { params: { courseId: string } }) {
  return <LmsCourseEditorScreen courseId={params.courseId} />;
}
