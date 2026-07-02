import { QuizExperience } from "@/components/lms/classroom/QuizExperience";

export default function ClassroomQuizPage({ params }: { params: { enrollmentId: string; quizId: string } }) {
  return <QuizExperience enrollmentId={params.enrollmentId} quizId={params.quizId} />;
}
