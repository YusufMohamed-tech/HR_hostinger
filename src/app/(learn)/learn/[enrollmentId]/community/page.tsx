import { CommunityView } from "@/components/lms/classroom/ClassroomExtras";

export default function ClassroomCommunityPage({ params }: { params: { enrollmentId: string } }) {
  return <CommunityView enrollmentId={params.enrollmentId} />;
}
