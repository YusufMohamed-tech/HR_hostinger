import { LmsSubmissionsScreen } from "@/components/lms/LmsScreens";

export default function LmsCourseSubmissionsPage({ params }: { params: { courseId: string } }) {
  return <LmsSubmissionsScreen courseId={params.courseId} />;
}
