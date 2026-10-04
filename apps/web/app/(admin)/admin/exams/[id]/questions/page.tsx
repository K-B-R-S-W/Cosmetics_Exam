import { QuestionBuilder } from "@/components/admin/questions/QuestionBuilder";
import { requireAdmin } from "@/lib/auth";

export default async function ExamQuestionsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  return <QuestionBuilder examId={id} />;
}
