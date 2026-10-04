import { CandidateForm } from "@/components/admin/candidates/CandidateForm";
import { requireAdmin } from "@/lib/auth";

interface CandidatePageProps {
  params: Promise<{ id: string }>;
}

export default async function CandidatePage({ params }: CandidatePageProps) {
  await requireAdmin();
  const { id } = await params;

  return <CandidateForm candidateId={id === "new" ? null : id} />;
}
