import { ProjectExperience } from "@/components/lms/classroom/ProjectExperience";

export default async function ClassroomProjectPage({ params }: { params: Promise<{ enrollmentId: string; taskId: string }> }) {
  const { enrollmentId, taskId } = await params;
  return <ProjectExperience enrollmentId={enrollmentId} taskId={taskId} />;
}
