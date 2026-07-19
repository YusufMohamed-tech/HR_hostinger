import { LmsCourseTasksScreen } from "@/components/lms/LmsScreens";

export default async function LmsCourseTasksPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  return <LmsCourseTasksScreen courseId={courseId} />;
}
