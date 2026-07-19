import { LmsSubmissionsScreen } from "@/components/lms/LmsScreens";

export default async function LmsCourseSubmissionsPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  return <LmsSubmissionsScreen courseId={courseId} />;
}
