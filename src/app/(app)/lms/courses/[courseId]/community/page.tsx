import { LmsCommunityScreen } from "@/components/lms/LmsScreens";

export default async function LmsCourseCommunityPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  return <LmsCommunityScreen courseId={courseId} />;
}
