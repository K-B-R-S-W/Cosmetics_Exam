import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { ApiError } from "@/lib/api";
import type { AnswerInput, SaveAnswerResult } from "@/lib/candidate-types";

const nullableUuid = z.uuid().nullable();

export const answerInputSchema = z.object({
  question_id: z.uuid(),
  answer_text: z.string().max(20_000).nullable(),
  selected_option_id: nullableUuid,
  flagged: z.boolean(),
  revision: z.number().int().min(1),
}).strict();

export const nextInputSchema = z.object({
  expected_position: z.number().int().min(0),
  question_id: z.uuid(),
  answer_text: z.string().max(20_000).nullable(),
  selected_option_id: nullableUuid,
  revision: z.number().int().min(1),
}).strict();

export const submitInputSchema = z.object({
  reason: z.enum(["manual", "auto"]).default("manual"),
  pending_answers: z.array(answerInputSchema).max(200).default([]),
}).strict();

const SAVE_ERRORS: Record<string, ApiError> = {
  closed: new ApiError("exam_closed", 409, "The exam has ended."),
  wrong_position: new ApiError("wrong_position", 409, "The server is on a different question."),
  not_in_paper: new ApiError("not_in_paper", 400, "That question is not in this paper."),
  bad_option: new ApiError("bad_option", 400, "That option does not belong to this question."),
  not_found: new ApiError("not_found", 404, "The attempt was not found."),
};

export type SaveAnswerOutcome = SaveAnswerResult & { sent_revision: number };

export async function saveCandidateAnswer(
  supabase: SupabaseClient,
  attemptId: string,
  input: AnswerInput,
  now = new Date(),
): Promise<SaveAnswerOutcome> {
  const { data, error } = await supabase.rpc("save_answer", {
    p_attempt_id: attemptId,
    p_question_id: input.question_id,
    p_answer_text: input.answer_text,
    p_selected_option_id: input.selected_option_id,
    p_flagged: input.flagged,
    p_revision: input.revision,
  });
  if (error) throw error;
  const result = data as string;
  if (result === "saved") {
    return { result, server_time: now.toISOString(), sent_revision: input.revision };
  }
  if (result === "stale_revision") {
    const { data: answer, error: answerError } = await supabase
      .from("answers")
      .select("revision")
      .eq("attempt_id", attemptId)
      .eq("question_id", input.question_id)
      .maybeSingle();
    if (answerError) throw answerError;
    if (!answer || typeof answer.revision !== "number") throw new Error("stale_revision_missing_answer");
    return {
      result,
      server_revision: answer.revision,
      server_time: now.toISOString(),
      sent_revision: input.revision,
    };
  }
  const mapped = SAVE_ERRORS[result];
  if (mapped) throw mapped;
  throw new Error("unexpected_save_answer_result");
}

export function publicSaveResult(outcome: SaveAnswerOutcome): SaveAnswerResult {
  if (outcome.result === "stale_revision") {
    return {
      result: outcome.result,
      server_revision: outcome.server_revision,
      server_time: outcome.server_time,
    };
  }
  return { result: outcome.result, server_time: outcome.server_time };
}
