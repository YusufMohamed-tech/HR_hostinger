import { ProjectExperience } from "@/components/lms/classroom/ProjectExperience";

export default function ClassroomProjectPage({ params }: { params: { enrollmentId: string; taskId: string } }) {
  return <ProjectExperience enrollmentId={params.enrollmentId} taskId={params.taskId} />;
}
