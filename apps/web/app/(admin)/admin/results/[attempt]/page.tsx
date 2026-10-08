import { notFound } from "next/navigation";
import { AttemptReview, type ReviewItem } from "@/components/admin/AttemptReview";
import { requireAdmin } from "@/lib/auth";
import { gradingHtmlToText } from "@/lib/grading/html-to-text";
import { createServiceRoleClient } from "@/lib/supabase/server";

export default async function AttemptResultsPage({ params }: { params: Promise<{ attempt: string }> }) {
  await requireAdmin(); const { attempt } = await params; const client = createServiceRoleClient();
  const { data, error } = await client.from("attempts").select("id,candidates!inner(mer_code,full_name),attempt_questions(question_id,position,questions!inner(body_html,marks,answer_keys(model_answer)),answers(answer_text))").eq("id", attempt).maybeSingle();
  if (error || !data) notFound();
  const { data: scores } = await client.from("current_scores").select("question_id,source,marks,reason,needs_review,details").eq("attempt_id", attempt);
  const scoreByQuestion = new Map((scores ?? []).map((score) => [score.question_id, score]));
  const items: ReviewItem[] = data.attempt_questions.sort((a, b) => a.position - b.position).map((row) => { const question = row.questions as unknown as { body_html: string; marks: number; answer_keys: Array<{ model_answer: string | null }> }; const answers = row.answers as unknown as Array<{ answer_text: string | null }>; const score = scoreByQuestion.get(row.question_id); return { question_id: row.question_id, question: gradingHtmlToText(question.body_html), answer: answers[0]?.answer_text ?? "", model_answer: question.answer_keys[0]?.model_answer ?? "", max_marks: Number(question.marks), score: score ? { source: score.source, marks: Number(score.marks), reason: score.reason, needs_review: score.needs_review, details: score.details as Record<string, unknown> | null } : null }; });
  const candidate = data.candidates as unknown as { mer_code: string; full_name: string };
  return <main><p className="text-muted">Results</p><h1 className="text-title font-bold">{candidate.mer_code} — {candidate.full_name}</h1><AttemptReview attemptId={attempt} items={items} /></main>;
}
