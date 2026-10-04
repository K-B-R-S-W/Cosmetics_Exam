import { ExamList } from "@/components/admin/exams/ExamList";
import { requireAdmin } from "@/lib/auth";

export default async function ExamsPage() {
  await requireAdmin();
  return <ExamList />;
}
