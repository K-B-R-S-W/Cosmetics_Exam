import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { PrintResult } from "@/components/admin/PrintResult";
import { requireAdmin } from "@/lib/auth";
import { loadAttemptReview } from "@/lib/grading/attempt-review";
import { createServiceRoleClient } from "@/lib/supabase/server";

type PageProps = { params: Promise<{ attempt: string }> };

const loadPrintReview = cache(async (attempt: string) => {
  return loadAttemptReview(createServiceRoleClient(), attempt, undefined, { includePrintData: true });
});

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  try {
    await requireAdmin();
    const { attempt } = await params;
    const review = await loadPrintReview(attempt);
    if (!review?.print) return { title: "Results" };
    return { title: `${review.candidate.mer_code} - ${review.candidate.full_name} - ${review.print.exam_title}` };
  } catch {
    return { title: "Results" };
  }
}

export default async function AttemptPrintPage({ params }: PageProps) {
  await requireAdmin();
  const { attempt } = await params;
  const review = await loadPrintReview(attempt);
  if (!review) notFound();
  if (!review.print) throw new Error("attempt_review_print_data_failed");
  return <PrintResult attemptId={attempt} candidate={review.candidate} print={review.print} items={review.items} />;
}
