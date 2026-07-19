import { CourseStudio } from "@/components/lms/builder/CourseStudio";

export default async function CourseStudioPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  return <CourseStudio courseId={courseId} />;
}
