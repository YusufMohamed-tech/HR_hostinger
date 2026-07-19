import { NotesView } from "@/components/lms/classroom/ClassroomExtras";

export default async function ClassroomNotesPage({ params }: { params: Promise<{ enrollmentId: string }> }) {
  const { enrollmentId } = await params;
  return <NotesView enrollmentId={enrollmentId} />;
}
