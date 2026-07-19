import { WorkspaceView } from "@/components/lms/classroom/ClassroomExtras";

export default async function ClassroomWorkspacePage({ params }: { params: Promise<{ enrollmentId: string }> }) {
  const { enrollmentId } = await params;
  return <WorkspaceView enrollmentId={enrollmentId} />;
}
