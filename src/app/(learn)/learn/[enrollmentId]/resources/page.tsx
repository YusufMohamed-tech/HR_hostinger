import { ResourcesView } from "@/components/lms/classroom/ClassroomExtras";

export default function ClassroomResourcesPage({ params }: { params: { enrollmentId: string } }) {
  return <ResourcesView enrollmentId={params.enrollmentId} />;
}
