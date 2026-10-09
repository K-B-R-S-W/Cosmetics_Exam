import { notFound } from "next/navigation";
import Link from "next/link";
import { AttemptReview } from "@/components/admin/AttemptReview";
import { requireAdmin } from "@/lib/auth";
import { loadAttemptReview } from "@/lib/grading/attempt-review";
import { createServiceRoleClient } from "@/lib/supabase/server";

export default async function AttemptResultsPage({ params }: { params: Promise<{ attempt: string }> }) {
  await requireAdmin();
  const { attempt } = await params;
  const review = await loadAttemptReview(createServiceRoleClient(), attempt);
  if (!review) notFound();
  return <main><p className="text-muted">Results</p><div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-title font-bold">{review.candidate.mer_code} — {review.candidate.full_name}</h1><Link className="inline-flex min-h-11 items-center rounded-control border border-line bg-surface px-5 font-bold" href={`/admin/results/${attempt}/print`}>Print</Link></div><AttemptReview attemptId={attempt} items={review.items} questionNumbers={review.question_numbers} /></main>;
}
