import { WorkspaceView } from "@/components/lms/classroom/ClassroomExtras";

export default function ClassroomWorkspacePage({ params }: { params: { enrollmentId: string } }) {
  return <WorkspaceView enrollmentId={params.enrollmentId} />;
}
