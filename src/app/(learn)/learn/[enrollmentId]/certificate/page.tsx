import { CertificateView } from "@/components/lms/classroom/ClassroomExtras";

export default async function ClassroomCertificatePage({ params }: { params: Promise<{ enrollmentId: string }> }) {
  const { enrollmentId } = await params;
  return <CertificateView enrollmentId={enrollmentId} />;
}
