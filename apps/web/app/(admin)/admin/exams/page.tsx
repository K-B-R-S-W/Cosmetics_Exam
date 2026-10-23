import { ExamList } from "@/components/admin/exams/ExamList";
import { requireAdmin } from "@/lib/auth";

export default async function ExamsPage() {
  const admin = await requireAdmin();
  return <ExamList canDeleteFinalized={admin.role === "super_admin"} />;
}
