import type { SupabaseClient } from "@supabase/supabase-js";
import { questionNumbers } from "./question-numbers";

const PAGE_SIZE = 1000;
const ID_CHUNK_SIZE = 100;

export type ResultsSummaryRow = {
  attempt_id: string;
  mer_code: string;
  full_name: string;
  outlet: string | null;
  attempt_status: string;
  submit_reason: string | null;
  violations_counted: number;
  violations_logged: number;
  question_numbers: number[];
  mcq_marks: number | null;
  written_marks: number | null;
  total_marks: number | null;
  total_percent: number | null;
  needs_review_count: number;
  unscored_count: number;
  is_final: boolean;
  is_absent: boolean;
};

export type ResultsSummaryData = {
  exam: { id: string; title: string; flag_threshold: number };
  rows: ResultsSummaryRow[];
};

type SafeLogger = (event: string, context: { error_code: string }) => void;
type DbResult = { data: unknown; error: unknown };
type RangeQuery = { range(from: number, to: number): PromiseLike<DbResult> };

function defaultLogger(event: string, context: { error_code: string }): void {
  console.error(JSON.stringify({ level: "error", event, ...context }));
}

function fail(stage: string, logger: SafeLogger): never {
  const errorCode = `results_summary_${stage}_failed`;
  logger("results_summary_query_failed", { error_code: errorCode });
  throw new Error(errorCode);
}

function rows<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : value ? [value as T] : [];
}

function chunks<T>(values: readonly T[]): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += ID_CHUNK_SIZE) output.push(values.slice(index, index + ID_CHUNK_SIZE));
  return output;
}

async function paged<T>(factory: () => RangeQuery, stage: string, logger: SafeLogger): Promise<T[]> {
  const output: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const result = await factory().range(from, from + PAGE_SIZE - 1);
    if (result.error) fail(stage, logger);
    const page = rows<T>(result.data);
    output.push(...page);
    if (page.length < PAGE_SIZE) return output;
  }
}

async function pagedForIds<T>(
  ids: readonly string[],
  stage: string,
  logger: SafeLogger,
  factory: (ids: string[]) => RangeQuery,
): Promise<T[]> {
  const output: T[] = [];
  for (const part of chunks(ids)) output.push(...await paged<T>(() => factory(part), stage, logger));
  return output;
}

export function resolveResultsExamParam(params: { exam?: string; exam_id?: string }): string | undefined {
  return params.exam ?? params.exam_id;
}

export async function loadResultsSummary(
  client: SupabaseClient,
  examId: string,
  logger: SafeLogger = defaultLogger,
): Promise<ResultsSummaryData | null> {
  const examResult = await client.from("exams").select("id,title,flag_threshold").eq("id", examId).maybeSingle();
  if (examResult.error) fail("exam", logger);
  if (!examResult.data) return null;
  const exam = examResult.data as { id: string; title: string; flag_threshold: number };

  const attempts = await paged<{
    id: string; candidate_id: string; status: string; submit_reason: string | null; violation_count: number;
  }>(() => client.from("attempts").select("id,candidate_id,status,submit_reason,violation_count").eq("exam_id", examId).order("id") as unknown as RangeQuery, "attempts", logger);
  const attemptIds = attempts.map((attempt) => attempt.id);
  const candidateIds = [...new Set(attempts.map((attempt) => attempt.candidate_id))];

  const candidates = await pagedForIds<{ id: string; mer_code: string; full_name: string; outlet: string | null }>(candidateIds, "candidates", logger,
    (ids) => client.from("candidates").select("id,mer_code,full_name,outlet").in("id", ids).order("id") as unknown as RangeQuery);
  const results = await pagedForIds<{ attempt_id: string; mcq_marks: number; written_marks: number; total_marks: number; total_percent: number }>(attemptIds, "results", logger,
    (ids) => client.from("results").select("attempt_id,mcq_marks,written_marks,total_marks,total_percent").in("attempt_id", ids).order("attempt_id") as unknown as RangeQuery);
  const paper = await pagedForIds<{ attempt_id: string; question_id: string }>(attemptIds, "paper", logger,
    (ids) => client.from("attempt_questions").select("attempt_id,question_id").in("attempt_id", ids).order("attempt_id").order("position") as unknown as RangeQuery);
  const questionIds = [...new Set(paper.map((entry) => entry.question_id))];
  const questions = await pagedForIds<{ id: string; position: number; type: "mcq" | "written" }>(questionIds, "questions", logger,
    (ids) => client.from("questions").select("id,position,type").in("id", ids).order("id") as unknown as RangeQuery);
  const scores = await pagedForIds<{ attempt_id: string; question_id: string; needs_review: boolean }>(attemptIds, "scores", logger,
    (ids) => client.from("current_scores").select("attempt_id,question_id,needs_review").in("attempt_id", ids).order("attempt_id").order("question_id") as unknown as RangeQuery);
  const events = await pagedForIds<{ attempt_id: string }>(attemptIds, "events", logger,
    (ids) => client.from("violation_events").select("attempt_id").in("attempt_id", ids).order("id") as unknown as RangeQuery);

  const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const resultsByAttempt = new Map(results.map((result) => [result.attempt_id, result]));
  const positions = new Map(questions.map((question) => [question.id, Number(question.position)]));
  const types = new Map(questions.map((question) => [question.id, question.type]));
  const paperByAttempt = new Map<string, string[]>();
  for (const entry of paper) paperByAttempt.set(entry.attempt_id, [...(paperByAttempt.get(entry.attempt_id) ?? []), entry.question_id]);
  const scoresByAttempt = new Map<string, Map<string, boolean>>();
  for (const score of scores) {
    const attemptScores = scoresByAttempt.get(score.attempt_id) ?? new Map<string, boolean>();
    attemptScores.set(score.question_id, score.needs_review);
    scoresByAttempt.set(score.attempt_id, attemptScores);
  }
  const eventsByAttempt = new Map<string, number>();
  for (const event of events) eventsByAttempt.set(event.attempt_id, (eventsByAttempt.get(event.attempt_id) ?? 0) + 1);

  return {
    exam: { id: exam.id, title: exam.title, flag_threshold: Number(exam.flag_threshold) },
    rows: attempts.map((attempt) => {
      const candidate = candidatesById.get(attempt.candidate_id);
      if (!candidate) fail("candidate", logger);
      const questionIdsForAttempt = paperByAttempt.get(attempt.id) ?? [];
      const result = resultsByAttempt.get(attempt.id);
      const attemptScores = scoresByAttempt.get(attempt.id) ?? new Map<string, boolean>();
      const needsReviewCount = [...attemptScores.values()].filter(Boolean).length;
      const unscoredCount = questionIdsForAttempt.filter((questionId) => types.get(questionId) === "written" && !attemptScores.has(questionId)).length;
      const isAbsent = questionIdsForAttempt.length === 0 && !result;
      return {
        attempt_id: attempt.id,
        mer_code: candidate.mer_code,
        full_name: candidate.full_name,
        outlet: candidate.outlet,
        attempt_status: attempt.status,
        submit_reason: attempt.submit_reason,
        violations_counted: Number(attempt.violation_count),
        violations_logged: eventsByAttempt.get(attempt.id) ?? 0,
        question_numbers: questionNumbers(questionIdsForAttempt, positions),
        mcq_marks: result ? Number(result.mcq_marks) : null,
        written_marks: result ? Number(result.written_marks) : null,
        total_marks: result ? Number(result.total_marks) : null,
        total_percent: result ? Number(result.total_percent) : null,
        needs_review_count: needsReviewCount,
        unscored_count: unscoredCount,
        is_final: !isAbsent && Boolean(result) && unscoredCount === 0 && needsReviewCount === 0,
        is_absent: isAbsent,
      };
    }),
  };
}
