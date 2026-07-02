import { ClassroomShell } from "@/components/lms/classroom/ClassroomShell";

export default function ClassroomLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { enrollmentId: string };
}) {
  return <ClassroomShell enrollmentId={params.enrollmentId}>{children}</ClassroomShell>;
}
