import { CourseStudio } from "@/components/lms/builder/CourseStudio";

export default function CourseStudioPage({ params }: { params: { courseId: string } }) {
  return <CourseStudio courseId={params.courseId} />;
}
