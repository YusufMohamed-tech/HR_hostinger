import { QuizExperience } from "@/components/lms/classroom/QuizExperience";

export default async function ClassroomQuizPage({ params }: { params: Promise<{ enrollmentId: string; quizId: string }> }) {
  const { enrollmentId, quizId } = await params;
  return <QuizExperience enrollmentId={enrollmentId} quizId={quizId} />;
}
