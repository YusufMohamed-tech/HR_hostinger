import { ClassroomShell } from "@/components/lms/classroom/ClassroomShell";

export default async function ClassroomLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ enrollmentId: string }>;
}) {
  const { enrollmentId } = await params;
  return <ClassroomShell enrollmentId={enrollmentId}>{children}</ClassroomShell>;
}
