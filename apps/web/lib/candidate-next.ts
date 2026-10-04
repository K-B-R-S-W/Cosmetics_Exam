import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "@/lib/api";
import { saveCandidateAnswer } from "@/lib/candidate-answers";
import { toCandidateQuestion, type CandidateQuestionRow } from "@/lib/candidate-paper";
import type { CandidateAuthContext } from "@/lib/candidate-session";
import type { NextQuestionBody, SavedAnswer, StateBody } from "@/lib/candidate-types";
import { attemptDeadline, examPhase } from "@/lib/exam-state";
import { createServiceRoleClient } from "@/lib/supabase/server";

export interface NextInput {
  expected_position: number;
  question_id: string;
  answer_text: string | null;
  selected_option_id: string | null;
  revision: number;
}

type NextRpcRow = { out_result: string; out_position: number };
type AssignmentWithQuestion = {
  question_id: string;
  position: number;
  option_order: string[] | null;
  questions: CandidateQuestionRow | CandidateQuestionRow[] | null;
};
type AnswerRow = Omit<SavedAnswer, "saved_at"> & { updated_at: string };

function nextError(result: string, position: number): ApiError {
  if (result === "closed") return new ApiError("exam_closed", 409, "The exam has ended.");
  if (result === "wrong_question" || result === "not_sequential") {
    return new ApiError("invalid_state", 409, "Reload the current question.", { position });
  }
  if (result === "wrong_position") return new ApiError("wrong_position", 409, "The server is on a different question.");
  if (result === "bad_option" || result === "not_in_paper") {
    return new ApiError(result, 400, result === "bad_option" ? "That option does not belong to this question." : "That question is not in this paper.");
  }
  if (result === "not_found") return new ApiError("not_found", 404, "The attempt was not found.");
  return new ApiError("internal_error", 500, "Something went wrong. Try again.");
}

async function assertNextIsOpen(
  supabase: SupabaseClient,
  auth: CandidateAuthContext,
  now: Date,
): Promise<void> {
  const { data, error } = await supabase
    .from("exams")
    .select("status,ends_at,force_ended_at")
    .eq("id", auth.examId)
    .single();
  if (error) throw error;
  const exam = data as { status: StateBody["exam"]["status"]; ends_at: string | null; force_ended_at: string | null };
  const deadline = attemptDeadline(exam.ends_at, auth.extraMinutes);
  if (examPhase(auth.attemptStatus, exam.status, exam.force_ended_at !== null, deadline, now) !== "live") {
    throw new ApiError("exam_closed", 409, "The exam has ended.");
  }
}

async function loadPosition(
  supabase: SupabaseClient,
  attemptId: string,
  position: number,
  result: NextQuestionBody["result"],
  now: Date,
): Promise<NextQuestionBody> {
  const assignmentsRequest = supabase
    .from("attempt_questions")
    .select("question_id,position,option_order,questions!inner(id,type,body_html,image_path,image_alt_text,marks,mcq_options(id,text_html))")
    .eq("attempt_id", attemptId)
    .order("position");
  const answerRequest = supabase
    .from("answers")
    .select("question_id,answer_text,selected_option_id,flagged,revision,updated_at")
    .eq("attempt_id", attemptId);
  const [assignmentResult, answerResult] = await Promise.all([assignmentsRequest, answerRequest]);
  if (assignmentResult.error) throw assignmentResult.error;
  if (answerResult.error) throw answerResult.error;
  const assignments = (assignmentResult.data ?? []) as AssignmentWithQuestion[];
  const assignment = assignments.find((row) => row.position === position);
  if (!assignment) throw new Error("paper_question_missing");
  const question = Array.isArray(assignment.questions) ? assignment.questions[0] : assignment.questions;
  if (!question) throw new Error("paper_question_missing");
  const answerRow = ((answerResult.data ?? []) as Array<AnswerRow & { question_id: string }>).find(
    (answer) => answer.question_id === assignment.question_id,
  );
  const answer = answerRow ? {
    answer_text: answerRow.answer_text,
    selected_option_id: answerRow.selected_option_id,
    flagged: answerRow.flagged,
    revision: answerRow.revision,
    saved_at: answerRow.updated_at,
  } : null;
  return {
    result,
    position,
    total_questions: assignments.length,
    question: toCandidateQuestion(question, assignment),
    answer,
    server_time: now.toISOString(),
  };
}

export async function advanceCandidatePosition(
  auth: CandidateAuthContext,
  input: NextInput,
  options: { supabase?: SupabaseClient; now?: Date } = {},
): Promise<NextQuestionBody | { result: "last_question"; position: number; server_time: string }> {
  const supabase = options.supabase ?? createServiceRoleClient();
  const now = options.now ?? new Date();
  await assertNextIsOpen(supabase, auth, now);
  const { data, error } = await supabase.rpc("advance_position", {
    p_attempt_id: auth.attemptId,
    p_expected_position: input.expected_position,
    p_question_id: input.question_id,
    p_answer_text: input.answer_text,
    p_selected_option_id: input.selected_option_id,
    p_revision: input.revision,
  });
  if (error) throw error;
  const row = ((data ?? []) as NextRpcRow[])[0];
  if (!row) throw new Error("advance_position_empty_result");
  if (row.out_result === "last_question") {
    if ((input.answer_text !== null && input.answer_text.trim() !== "") || input.selected_option_id !== null) {
      await saveCandidateAnswer(supabase, auth.attemptId, { ...input, flagged: false }, now);
    }
    return { result: "last_question", position: row.out_position, server_time: now.toISOString() };
  }
  if (row.out_result === "advanced" || row.out_result === "already_advanced" || row.out_result === "out_of_sync") {
    return loadPosition(supabase, auth.attemptId, row.out_position, row.out_result, now);
  }
  throw nextError(row.out_result, row.out_position);
}
