import { LmsCourseTasksScreen } from "@/components/lms/LmsScreens";

export default function LmsCourseTasksPage({ params }: { params: { courseId: string } }) {
  return <LmsCourseTasksScreen courseId={params.courseId} />;
}
