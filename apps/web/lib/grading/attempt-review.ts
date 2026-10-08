import type { SupabaseClient } from "@supabase/supabase-js";
import { gradingHtmlToText } from "./html-to-text";

export type AttemptReviewItem = {
  question_id: string;
  type: "mcq" | "written";
  question: string;
  answer: string;
  model_answer: string;
  selected_option: { label: string; text: string } | null;
  correct_option: { label: string; text: string } | null;
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
type QuestionRow = { id: string; type: "mcq" | "written"; body_html: string; marks: number };
type PaperRow = { question_id: string; position: number; questions: QuestionRow | QuestionRow[] | null };
type KeyRow = { question_id: string; correct_option_id: string | null; model_answer: string | null };
type AnswerRow = { question_id: string; answer_text: string | null; selected_option_id: string | null };
type OptionRow = { id: string; question_id: string; label: string; text_html: string };
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
    .select("question_id,position,questions!inner(id,type,body_html,marks)")
    .eq("attempt_id", attemptId)
    .order("position");
  if (paperResult.error) fail("paper", logger);
  const paper = rows<PaperRow>(paperResult.data as unknown as PaperRow[] | PaperRow | null).map((row) => {
    const question = one(row.questions);
    if (!question) fail("question", logger);
    return { ...row, question };
  });
  const questionIds = paper.map((row) => row.question_id);
  const mcqQuestionIds = paper.filter((row) => row.question.type === "mcq").map((row) => row.question_id);

  const empty = { data: [], error: null };
  const [keysResult, answersResult, scoresResult, optionsResult] = questionIds.length > 0 ? await Promise.all([
    client.from("answer_keys").select("question_id,correct_option_id,model_answer").in("question_id", questionIds),
    client.from("answers").select("question_id,answer_text,selected_option_id").eq("attempt_id", attemptId).in("question_id", questionIds),
    client.from("current_scores").select("question_id,source,marks,reason,needs_review,details").eq("attempt_id", attemptId).in("question_id", questionIds),
    mcqQuestionIds.length > 0
      ? client.from("mcq_options").select("id,question_id,label,text_html").in("question_id", mcqQuestionIds)
      : Promise.resolve(empty),
  ]) : [empty, empty, empty, empty];
  if (keysResult.error) fail("keys", logger);
  if (answersResult.error) fail("answers", logger);
  if (scoresResult.error) fail("scores", logger);
  if (optionsResult.error) fail("options", logger);

  const keys = new Map(rows<KeyRow>(keysResult.data as unknown as KeyRow[] | KeyRow | null).map((row) => [row.question_id, row]));
  const answers = new Map(rows<AnswerRow>(answersResult.data as unknown as AnswerRow[] | AnswerRow | null).map((row) => [row.question_id, row]));
  const scores = new Map(rows<ScoreRow>(scoresResult.data as unknown as ScoreRow[] | ScoreRow | null).map((row) => [row.question_id, row]));
  const options = new Map(rows<OptionRow>(optionsResult.data as unknown as OptionRow[] | OptionRow | null).map((row) => [row.id, row]));
  const candidate = one(attemptResult.data.candidates as unknown as { mer_code: string; full_name: string } | Array<{ mer_code: string; full_name: string }>);
  if (!candidate) fail("candidate", logger);

  return {
    attemptId,
    status: attemptResult.data.status,
    candidate,
    items: paper.map((row) => {
      const question = row.question;
      const key = keys.get(row.question_id);
      const answer = answers.get(row.question_id);
      const score = scores.get(row.question_id);
      const option = (id: string | null | undefined) => {
        if (!id) return null;
        const value = options.get(id);
        if (!value || value.question_id !== row.question_id) return null;
        return { label: value.label, text: gradingHtmlToText(value.text_html) };
      };
      return {
        question_id: row.question_id,
        type: question.type,
        question: gradingHtmlToText(question.body_html),
        answer: answer?.answer_text ?? "",
        model_answer: key?.model_answer ?? "",
        selected_option: question.type === "mcq" ? option(answer?.selected_option_id) : null,
        correct_option: question.type === "mcq" ? option(key?.correct_option_id) : null,
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
