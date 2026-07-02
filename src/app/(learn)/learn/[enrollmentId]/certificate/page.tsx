import { CertificateView } from "@/components/lms/classroom/ClassroomExtras";

export default function ClassroomCertificatePage({ params }: { params: { enrollmentId: string } }) {
  return <CertificateView enrollmentId={params.enrollmentId} />;
}
