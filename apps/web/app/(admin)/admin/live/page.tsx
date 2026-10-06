import { LiveGrid } from "@/components/admin/LiveGrid";
import { requireAdmin } from "@/lib/auth";

export default async function AdminLivePage({ searchParams }: { searchParams: Promise<{ exam?: string }> }) {
  await requireAdmin();
  const { exam } = await searchParams;
  return <LiveGrid requestedExamId={exam} />;
}
