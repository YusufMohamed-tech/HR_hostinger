import { LmsPlayerScreen } from "@/components/lms/LmsScreens";

export default function LmsPlayerPage({ params }: { params: { enrollmentId: string } }) {
  return <LmsPlayerScreen enrollmentId={params.enrollmentId} />;
}
