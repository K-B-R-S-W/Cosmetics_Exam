import { ExamCandidates } from "@/components/admin/exams/ExamCandidates";
import { requireAdmin } from "@/lib/auth";

export default async function ExamCandidatesPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  return <ExamCandidates examId={id} />;
}
