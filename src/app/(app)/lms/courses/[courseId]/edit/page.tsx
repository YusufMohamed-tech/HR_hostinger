import { redirect } from "next/navigation";

export default async function EditLmsCoursePage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  redirect(`/lms/courses/${courseId}/studio`);
}
