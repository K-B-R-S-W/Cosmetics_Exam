import { notFound } from "next/navigation";
import { PrintResult } from "@/components/admin/PrintResult";
import { requireAdmin } from "@/lib/auth";
import { loadAttemptReview } from "@/lib/grading/attempt-review";
import { createServiceRoleClient } from "@/lib/supabase/server";

export default async function AttemptPrintPage({ params }: { params: Promise<{ attempt: string }> }) {
  await requireAdmin();
  const { attempt } = await params;
  const review = await loadAttemptReview(createServiceRoleClient(), attempt, undefined, { includePrintData: true });
  if (!review) notFound();
  if (!review.print) throw new Error("attempt_review_print_data_failed");
  return <PrintResult attemptId={attempt} candidate={review.candidate} print={review.print} items={review.items} />;
}
