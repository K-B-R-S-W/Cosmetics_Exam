import type { SupabaseClient } from "@supabase/supabase-js";
import { gradingHtmlToText } from "./html-to-text";

export type AttemptReviewItem = {
  question_id: string;
  question: string;
  answer: string;
  model_answer: string;
  max_marks: number;
  score: null | {
    source: string;
    marks: number;
    reason: string | null;
    needs_review: boolean;
    details: Record<string, unknown> | null;
  };
};

export type AttemptReviewData = {
  attemptId: string;
  status: string;
  candidate: { mer_code: string; full_name: string };
  items: AttemptReviewItem[];
};

type SafeLogger = (event: string, context: { error_code: string }) => void;
type KeyRow = { question_id: string; model_answer: string | null };
type AnswerRow = { question_id: string; answer_text: string | null };
type ScoreRow = { question_id: string; source: string; marks: number; reason: string | null; needs_review: boolean; details: unknown };

function defaultLogger(event: string, context: { error_code: string }): void {
  console.error(JSON.stringify({ level: "error", event, ...context }));
}

function rows<T>(value: T[] | T | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function one<T>(value: T[] | T | null | undefined): T | undefined {
  return rows(value)[0];
}

function fail(stage: string, logger: SafeLogger): never {
  const errorCode = `attempt_review_${stage}_failed`;
  logger("attempt_review_query_failed", { error_code: errorCode });
  throw new Error(errorCode);
}

export async function loadAttemptReview(
  client: SupabaseClient,
  attemptId: string,
  logger: SafeLogger = defaultLogger,
): Promise<AttemptReviewData | null> {
  const attemptResult = await client.from("attempts")
    .select("id,status,candidates!inner(mer_code,full_name)")
    .eq("id", attemptId)
    .maybeSingle();
  if (attemptResult.error) fail("attempt", logger);
  if (!attemptResult.data) return null;

  const paperResult = await client.from("attempt_questions")
    .select("question_id,position,questions!inner(id,body_html,marks)")
    .eq("attempt_id", attemptId)
    .order("position");
  if (paperResult.error) fail("paper", logger);
  const paper = rows(paperResult.data);
  const questionIds = paper.map((row) => row.question_id);

  const empty = { data: [], error: null };
  const [keysResult, answersResult, scoresResult] = questionIds.length > 0 ? await Promise.all([
    client.from("answer_keys").select("question_id,model_answer").in("question_id", questionIds),
    client.from("answers").select("question_id,answer_text").eq("attempt_id", attemptId).in("question_id", questionIds),
    client.from("current_scores").select("question_id,source,marks,reason,needs_review,details").eq("attempt_id", attemptId).in("question_id", questionIds),
  ]) : [empty, empty, empty];
  if (keysResult.error) fail("keys", logger);
  if (answersResult.error) fail("answers", logger);
  if (scoresResult.error) fail("scores", logger);

  const keys = new Map(rows<KeyRow>(keysResult.data as unknown as KeyRow[] | KeyRow | null).map((row) => [row.question_id, row]));
  const answers = new Map(rows<AnswerRow>(answersResult.data as unknown as AnswerRow[] | AnswerRow | null).map((row) => [row.question_id, row]));
  const scores = new Map(rows<ScoreRow>(scoresResult.data as unknown as ScoreRow[] | ScoreRow | null).map((row) => [row.question_id, row]));
  const candidate = one(attemptResult.data.candidates as unknown as { mer_code: string; full_name: string } | Array<{ mer_code: string; full_name: string }>);
  if (!candidate) fail("candidate", logger);

  return {
    attemptId,
    status: attemptResult.data.status,
    candidate,
    items: paper.map((row) => {
      const question = one(row.questions as unknown as { id: string; body_html: string; marks: number } | Array<{ id: string; body_html: string; marks: number }>);
      if (!question) fail("question", logger);
      const key = keys.get(row.question_id);
      const answer = answers.get(row.question_id);
      const score = scores.get(row.question_id);
      return {
        question_id: row.question_id,
        question: gradingHtmlToText(question.body_html),
        answer: answer?.answer_text ?? "",
        model_answer: key?.model_answer ?? "",
        max_marks: Number(question.marks),
        score: score ? {
          source: score.source,
          marks: Number(score.marks),
          reason: score.reason,
          needs_review: score.needs_review,
          details: score.details as Record<string, unknown> | null,
        } : null,
      };
    }),
  };
}
