import type { SupabaseClient } from "@supabase/supabase-js";
import { createGradingAlert } from "./alerts";
import type { GradingSourceItem } from "./prompt";
import type { ValidatedScore } from "./parser";
import { validateGradingLog, type GradingLogRow } from "./grading-log";

export type GradingJob = {
  id: string; runId: string; attemptId: string; chunkIndex: number;
  questionIds: string[]; tries: number;
};

export interface GradingRepository {
  resetStuck(): Promise<number>;
  pendingJobs(limit: number): Promise<GradingJob[]>;
  claim(job: GradingJob, label: string, model: string): Promise<boolean>;
  loadItems(job: GradingJob): Promise<GradingSourceItem[]>;
  saveScores(job: GradingJob, scores: ValidatedScore[], model: string, keyLabel: string): Promise<void>;
  complete(job: GradingJob, error?: string | null): Promise<void>;
  fail(job: GradingJob, code: string, chargeTry: boolean, maxTries: number): Promise<void>;
  failPermanently(job: GradingJob, code: string): Promise<void>;
  requeue(job: GradingJob, questionIds?: string[]): Promise<void>;
  split(job: GradingJob, maxTries: number): Promise<void>;
  recompute(attemptId: string): Promise<void>;
  log(row: Record<string, unknown>): Promise<void>;
  pauseRun(runId: string, reason: "keys_exhausted" | "all_keys_disabled" | "model_not_found", resumeAt?: string): Promise<boolean>;
  pauseAll(reason: "model_not_found"): Promise<number>;
  updateKey(label: string, status: "active" | "cooldown" | "disabled", cooldownUntil?: string | null, lastError?: string | null): Promise<void>;
  alert(input: { type: string; severity: "info" | "warning" | "critical"; message: string; uniqueKey: string }): Promise<void>;
  resumeDue(): Promise<number>;
  finishRuns(): Promise<number>;
  usageSince(iso: string): Promise<Record<string, number>>;
  hasWork(): Promise<boolean>;
  queueCounts(): Promise<{ pending: number; running: number; failed: number }>;
}

type QueryError = { code?: string; message?: string } | null;
function failed(error: QueryError): void { if (error) throw new Error("database_error"); }

type GradingInputRow = {
  question_id: string;
  questions?: unknown;
  answers?: unknown;
};

function rows<T>(value: T[] | T | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

export async function loadGradingItems(client: SupabaseClient, job: GradingJob): Promise<GradingSourceItem[]> {
  const assignmentsResult = await client.from("attempt_questions")
    .select("question_id")
    .eq("attempt_id", job.attemptId)
    .in("question_id", job.questionIds);
  failed(assignmentsResult.error);
  const assignments = rows(assignmentsResult.data as GradingInputRow[] | GradingInputRow | null);
  const questionIds = assignments.map((row) => row.question_id);
  if (questionIds.length === 0) return [];

  const [questionsResult, keysResult, answersResult] = await Promise.all([
    client.from("questions").select("id,body_html,marks,image_path,image_alt_text").in("id", questionIds),
    client.from("answer_keys").select("question_id,model_answer,grading_notes,calibration").in("question_id", questionIds),
    client.from("answers").select("question_id,answer_text").eq("attempt_id", job.attemptId).in("question_id", questionIds),
  ]);
  failed(questionsResult.error);
  failed(keysResult.error);
  failed(answersResult.error);

  const questions = new Map(rows(questionsResult.data).map((row) => [row.id, row]));
  const keys = new Map(rows(keysResult.data).map((row) => [row.question_id, row]));
  const answers = new Map(rows(answersResult.data).map((row) => [row.question_id, row]));
  return assignments.map((assignment) => {
    const question = questions.get(assignment.question_id);
    const key = keys.get(assignment.question_id);
    if (!question || !key) throw new Error("grading_input_incomplete");
    const answer = answers.get(assignment.question_id);
    return {
      questionId: assignment.question_id,
      questionHtml: question.body_html,
      questionImageDescription: question.image_path ? question.image_alt_text : undefined,
      answerText: answer?.answer_text ?? "",
      modelAnswer: key.model_answer ?? "",
      maxMarks: Number(question.marks),
      gradingNotes: key.grading_notes,
      calibration: key.calibration,
    };
  });
}

export async function insertScoreRowsIdempotently(
  insert: (rows: Record<string, unknown> | Record<string, unknown>[]) => PromiseLike<{ error: QueryError }>,
  rows: Record<string, unknown>[],
): Promise<void> {
  const batch = await insert(rows);
  if (!batch.error) return;
  if (batch.error.code !== "23505") throw new Error("database_error");
  for (const row of rows) {
    const result = await insert(row);
    if (result.error && result.error.code !== "23505") throw new Error("database_error");
  }
}

export function createGradingRepository(client: SupabaseClient): GradingRepository {
  return {
    async resetStuck() {
      const cutoff = new Date(Date.now() - 120_000).toISOString();
      const { data, error } = await client.from("grading_jobs").update({ status: "pending", locked_at: null, error: null }).eq("status", "running").lt("locked_at", cutoff).select("id"); failed(error); return data?.length ?? 0;
    },
    async pendingJobs(limit) {
      const { data, error } = await client.from("grading_jobs").select("id,run_id,attempt_id,chunk_index,question_ids,tries,grading_runs!inner(status)").eq("status", "pending").eq("grading_runs.status", "running").order("created_at").order("id").limit(limit); failed(error);
      return (data ?? []).map((row) => ({ id: row.id, runId: row.run_id, attemptId: row.attempt_id, chunkIndex: row.chunk_index, questionIds: row.question_ids as string[], tries: row.tries }));
    },
    async claim(job, label, model) {
      const { data, error } = await client.from("grading_jobs").update({ status: "running", locked_at: new Date().toISOString(), key_label: label, model, tries: job.tries + 1 }).eq("id", job.id).eq("status", "pending").eq("tries", job.tries).select("id"); failed(error); return (data?.length ?? 0) === 1;
    },
    async loadItems(job) {
      return loadGradingItems(client, job);
    },
    async saveScores(job, scores, model, keyLabel) {
      if (!scores.length) return;
      const rows = scores.map((score) => ({ attempt_id: job.attemptId, question_id: score.questionId, source: "ai", marks: score.marks, max_marks: score.maxMarks, reason: score.reason, needs_review: score.needsReview, details: { ...score.details, model, key_label: keyLabel }, job_id: job.id }));
      // PostgREST cannot target migration 002's partial unique index with
      // on_conflict. Fall back per row only on a crash-retry collision.
      await insertScoreRowsIdempotently((value) => client.from("question_scores").insert(value), rows);
    },
    async complete(job, completionError = null) { const { error } = await client.from("grading_jobs").update({ status: "done", finished_at: new Date().toISOString(), error: completionError }).eq("id", job.id); failed(error); },
    async fail(job, code, chargeTry, maxTries) { const chargedTries = chargeTry ? job.tries + 1 : job.tries; const { error } = await client.from("grading_jobs").update({ status: chargeTry && chargedTries >= maxTries ? "failed" : "pending", tries: chargedTries, error: code, locked_at: null }).eq("id", job.id); failed(error); },
    async failPermanently(job, code) { const { error } = await client.from("grading_jobs").update({ status: "failed", tries: job.tries + 1, error: code, locked_at: null, finished_at: new Date().toISOString() }).eq("id", job.id); failed(error); },
    async requeue(job, questionIds) {
      if (!questionIds?.length) { const { error } = await client.from("grading_jobs").update({ status: "pending", tries: job.tries, locked_at: null }).eq("id", job.id); failed(error); return; }
      for (let retry = 0; retry < 3; retry += 1) {
        const { data, error: maxError } = await client.from("grading_jobs").select("chunk_index").eq("run_id", job.runId).eq("attempt_id", job.attemptId).order("chunk_index", { ascending: false }).limit(1); failed(maxError);
        const { error } = await client.from("grading_jobs").insert({ run_id: job.runId, attempt_id: job.attemptId, chunk_index: (data?.[0]?.chunk_index ?? -1) + 1, question_ids: questionIds, tries: job.tries + 1 });
        if (!error) return; if (error.code !== "23505" || retry === 2) throw new Error("database_error");
      }
    },
    async split(job, maxTries) {
      if (job.questionIds.length < 2 || job.tries + 1 >= maxTries) { await this.fail(job, "unparseable", true, maxTries); return; }
      const half = Math.ceil(job.questionIds.length / 2);
      await this.requeue(job, job.questionIds.slice(0, half)); await this.requeue(job, job.questionIds.slice(half));
      await this.complete(job);
    },
    async recompute(attemptId) { const { error } = await client.rpc("recompute_results", { p_attempt_id: attemptId }); failed(error); },
    async log(row) { const { error } = await client.from("grading_log").insert(validateGradingLog(row as GradingLogRow)); failed(error); },
    async pauseRun(runId, reason, resumeAt) { const { data, error } = await client.from("grading_runs").update({ status: "paused", pause_reason: reason, resume_at: resumeAt ?? null }).eq("id", runId).eq("status", "running").select("id"); failed(error); if (!data?.length) return false; await this.log({ run_id: runId, event: "paused", detail: `reason=${reason}` }); return true; },
    async pauseAll(reason) { const { data, error } = await client.from("grading_runs").update({ status: "paused", pause_reason: reason, resume_at: null }).eq("status", "running").select("id"); failed(error); for (const row of data ?? []) await this.log({ run_id: row.id, event: "paused", detail: `reason=${reason}` }); return data?.length ?? 0; },
    async updateKey(label, status, cooldownUntil = null, lastError = null) { const { error } = await client.from("api_key_state").update({ status, cooldown_until: cooldownUntil, last_error: lastError, updated_at: new Date().toISOString() }).eq("label", label); failed(error); },
    async alert(input) { await createGradingAlert(client, input); },
    async resumeDue() {
      const { data, error } = await client.from("grading_runs").select("id").eq("status", "paused").eq("pause_reason", "keys_exhausted").lte("resume_at", new Date().toISOString()); failed(error);
      let count = 0; for (const row of data ?? []) { const result = await client.rpc("resume_grading_run", { p_run_id: row.id, p_failed_only: false }); if (!result.error) count += 1; } return count;
    },
    async finishRuns() {
      const { data, error } = await client.from("grading_runs").select("id,grading_jobs(status)").eq("status", "running"); failed(error); let count = 0;
      for (const run of data ?? []) {
        const jobs = run.grading_jobs as unknown as { status: string }[];
        if (jobs.length && jobs.every((job) => job.status === "done" || job.status === "failed")) {
          const status = jobs.some((job) => job.status === "failed") ? "failed" : "done";
          const result = await client.from("grading_runs").update({ status, finished_at: new Date().toISOString() }).eq("id", run.id).eq("status", "running").select("id");
          if (!result.error && result.data?.length) {
            count += 1;
            await this.log({ run_id: run.id, event: status === "done" ? "run_done" : "run_failed", detail: `status=${status}` });
            await this.alert({ type: "grading", severity: status === "done" ? "info" : "warning", message: status === "done" ? "A grading run finished." : "A grading run finished with failed jobs.", uniqueKey: `${status === "done" ? "run_done" : "jobs_failed"}:${run.id}` });
          }
        }
      }
      return count;
    },
    async usageSince(iso) { const { data, error } = await client.from("grading_log").select("key_label").eq("event", "call").gte("at", iso); failed(error); return (data ?? []).reduce<Record<string, number>>((out, row) => { if (row.key_label) out[row.key_label] = (out[row.key_label] ?? 0) + 1; return out; }, {}); },
    async hasWork() { const { count, error } = await client.from("grading_jobs").select("id", { head: true, count: "exact" }).in("status", ["pending", "running"]); failed(error); return (count ?? 0) > 0; },
    async queueCounts() {
      const { data, error } = await client.from("grading_jobs").select("status").in("status", ["pending", "running", "failed"]); failed(error);
      return (data ?? []).reduce((out, row) => { const status = row.status as "pending" | "running" | "failed"; out[status] += 1; return out; }, { pending: 0, running: 0, failed: 0 });
    },
  };
}
