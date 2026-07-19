import { ResourcesView } from "@/components/lms/classroom/ClassroomExtras";

export default async function ClassroomResourcesPage({ params }: { params: Promise<{ enrollmentId: string }> }) {
  const { enrollmentId } = await params;
  return <ResourcesView enrollmentId={enrollmentId} />;
}
