import { CandidateImport } from "@/components/admin/candidates/CandidateImport";
import { requireAdmin } from "@/lib/auth";

export default async function CandidateImportPage() {
  await requireAdmin();
  return <CandidateImport />;
}
