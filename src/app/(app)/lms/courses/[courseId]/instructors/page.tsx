import { LmsCourseInstructorsScreen } from "@/components/lms/LmsScreens";

export default async function LmsCourseInstructorsPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  return <LmsCourseInstructorsScreen courseId={courseId} />;
}
