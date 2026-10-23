import { ExamForm } from "@/components/admin/exams/ExamForm";
import { requireAdmin } from "@/lib/auth";

export default async function ExamPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const { id } = await params;
  return <ExamForm examId={id === "new" ? null : id} canDeleteFinalized={admin.role === "super_admin"} />;
}
