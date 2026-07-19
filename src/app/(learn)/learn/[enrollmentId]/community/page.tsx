import { CommunityView } from "@/components/lms/classroom/ClassroomExtras";

export default async function ClassroomCommunityPage({ params }: { params: Promise<{ enrollmentId: string }> }) {
  const { enrollmentId } = await params;
  return <CommunityView enrollmentId={enrollmentId} />;
}
