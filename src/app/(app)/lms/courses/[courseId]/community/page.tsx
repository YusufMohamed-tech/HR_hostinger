import { LmsCommunityScreen } from "@/components/lms/LmsScreens";

export default function LmsCourseCommunityPage({ params }: { params: { courseId: string } }) {
  return <LmsCommunityScreen courseId={params.courseId} />;
}
