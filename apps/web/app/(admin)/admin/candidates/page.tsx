import { CandidateList } from "@/components/admin/candidates/CandidateList";
import { requireAdmin } from "@/lib/auth";

export default async function CandidatesPage() {
  await requireAdmin();

  return <CandidateList />;
}
