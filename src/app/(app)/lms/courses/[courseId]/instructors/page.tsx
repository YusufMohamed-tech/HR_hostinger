import { LmsCourseInstructorsScreen } from "@/components/lms/LmsScreens";

export default function LmsCourseInstructorsPage({ params }: { params: { courseId: string } }) {
  return <LmsCourseInstructorsScreen courseId={params.courseId} />;
}
