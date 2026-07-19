import { LmsPlayerScreen } from "@/components/lms/LmsScreens";

export default async function LmsPlayerPage({ params }: { params: Promise<{ enrollmentId: string }> }) {
  const { enrollmentId } = await params;
  return <LmsPlayerScreen enrollmentId={enrollmentId} />;
}
