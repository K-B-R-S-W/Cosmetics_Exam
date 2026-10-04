import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "@/lib/api";
import { saveCandidateAnswer } from "@/lib/candidate-answers";
import type { CandidateAuthContext } from "@/lib/candidate-session";
import type { AnswerInput } from "@/lib/candidate-types";
import { attemptDeadline } from "@/lib/exam-state";
import { logger } from "@/lib/logger";
import { createServiceRoleClient } from "@/lib/supabase/server";

const COLLECTION_GRACE_MS = 15_000;
const MAX_SAVE_CONCURRENCY = 8;

type SaveResult = { question_id: string; result: string; server_revision?: number };

async function mapConcurrent<T, R>(values: T[], limit: number, operation: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  async function worker() {
    while (next < values.length) {
      const index = next;
      next += 1;
      results[index] = await operation(values[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()));
  return results;
}

function resultCode(error: unknown): string {
  return error instanceof ApiError ? error.code : "internal_error";
}

export async function submitCandidateAttempt(
  auth: CandidateAuthContext,
  input: { reason: "manual" | "auto"; pending_answers: AnswerInput[] },
  options: { supabase?: SupabaseClient; now?: Date } = {},
) {
  const supabase = options.supabase ?? createServiceRoleClient();
  const now = options.now ?? new Date();
  if (auth.attemptStatus === "not_started" || auth.attemptStatus === "acknowledged") {
    throw new ApiError("not_started", 409, "The exam has not started for this candidate.");
  }
  if (auth.attemptStatus === "submitted" || auth.attemptStatus === "finalized") {
    return { submitted: true, already_submitted: true, save_results: [], server_time: now.toISOString() };
  }

  const { data, error } = await supabase
    .from("exams")
    .select("status,ends_at,force_ended_at")
    .eq("id", auth.examId)
    .single();
  if (error) throw error;
  const exam = data as { status: string; ends_at: string | null; force_ended_at: string | null };
  let effectiveReason: "manual" | "auto" | "forced";
  let collectionEnd: number;
  if (exam.force_ended_at) {
    effectiveReason = "forced";
    collectionEnd = new Date(exam.force_ended_at).getTime() + COLLECTION_GRACE_MS;
  } else {
    if (exam.status !== "live") {
      throw new ApiError("collection_closed", 409, "The answer collection window has closed.");
    }
    const deadline = attemptDeadline(exam.ends_at, auth.extraMinutes);
    if (!deadline) throw new ApiError("collection_closed", 409, "The answer collection window has closed.");
    const deadlineMs = new Date(deadline).getTime();
    effectiveReason = now.getTime() > deadlineMs ? "auto" : "manual";
    collectionEnd = deadlineMs + COLLECTION_GRACE_MS;
  }
  if (now.getTime() > collectionEnd) {
    throw new ApiError("collection_closed", 409, "The answer collection window has closed.");
  }

  const saveResults = await mapConcurrent(input.pending_answers, MAX_SAVE_CONCURRENCY, async (answer): Promise<SaveResult> => {
    try {
      const saved = await saveCandidateAnswer(supabase, auth.attemptId, answer, now);
      return saved.result === "stale_revision"
        ? { question_id: answer.question_id, result: saved.result, server_revision: saved.server_revision }
        : { question_id: answer.question_id, result: saved.result };
    } catch (saveError) {
      return { question_id: answer.question_id, result: resultCode(saveError) };
    }
  });
  const failureCount = saveResults.filter((result) => result.result !== "saved" && result.result !== "stale_revision").length;
  logger.info("candidate_submit_pending_answers", {
    actorId: auth.candidateId,
    itemCount: saveResults.length,
    successCount: saveResults.length - failureCount,
    failureCount,
  });

  const { data: submitted, error: submitError } = await supabase.rpc("submit_attempt", {
    p_attempt_id: auth.attemptId,
    p_reason: effectiveReason,
  });
  if (submitError) throw submitError;
  return {
    submitted: true,
    already_submitted: submitted === false,
    save_results: saveResults,
    server_time: now.toISOString(),
  };
}
