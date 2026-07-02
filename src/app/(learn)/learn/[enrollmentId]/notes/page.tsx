import { NotesView } from "@/components/lms/classroom/ClassroomExtras";

export default function ClassroomNotesPage({ params }: { params: { enrollmentId: string } }) {
  return <NotesView enrollmentId={params.enrollmentId} />;
}
