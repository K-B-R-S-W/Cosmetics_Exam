import { ExamForm } from "@/components/admin/exams/ExamForm";
import { requireAdmin } from "@/lib/auth";

export default async function ExamPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  return <ExamForm examId={id === "new" ? null : id} />;
}
