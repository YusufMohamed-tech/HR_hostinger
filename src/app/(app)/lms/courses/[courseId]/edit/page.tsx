import { redirect } from "next/navigation";

export default function EditLmsCoursePage({ params }: { params: { courseId: string } }) {
  redirect(`/lms/courses/${params.courseId}/studio`);
}
