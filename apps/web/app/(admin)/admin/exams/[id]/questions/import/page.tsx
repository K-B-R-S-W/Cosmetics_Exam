import { QuestionImport } from "@/components/admin/questions/QuestionImport";
import { requireAdmin } from "@/lib/auth";

export default async function QuestionImportPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  return <QuestionImport examId={id} />;
}
