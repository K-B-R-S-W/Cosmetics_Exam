import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "@/lib/api";
import type { CandidateAuthContext } from "@/lib/candidate-session";
import type {
  CandidateQuestion,
  PaperBody,
  SavedAnswer,
  StateBody,
} from "@/lib/candidate-types";
import { attemptDeadline, examPhase } from "@/lib/exam-state";
import { sanitizeOptionHtml, sanitizeQuestionHtml } from "@/lib/questions";
import { createServiceRoleClient } from "@/lib/supabase/server";

type ExamRow = {
  id: string;
  status: StateBody["exam"]["status"];
  navigation_mode: PaperBody["navigation_mode"];
  ends_at: string | null;
  force_ended_at: string | null;
};

type AssignmentRow = {
  attempt_id: string;
  question_id: string;
  position: number;
  option_order: string[] | null;
};

type QuestionRow = {
  id: string;
  type: CandidateQuestion["type"];
  body_html: string;
  image_path: string | null;
  image_alt_text: string | null;
  marks: number | string;
  mcq_options: Array<{ id: string; text_html: string }> | null;
};

type AnswerRow = SavedAnswer & { question_id: string };

const RPC_ERRORS: Record<string, ApiError> = {
  attempt_not_found: new ApiError("not_found", 404, "The attempt was not found."),
  not_acknowledged: new ApiError("not_acknowledged", 403, "Accept the exam rules first."),
  attempt_closed: new ApiError("attempt_closed", 409, "This attempt is already closed."),
  exam_not_live: new ApiError("exam_not_live", 409, "The exam hasn't started yet."),
  exam_has_no_questions: new ApiError("exam_has_no_questions", 409, "This exam has no questions yet."),
};

function mapRpcError(error: { message?: string } | null): never {
  const message = error?.message ?? "";
  for (const [databaseCode, apiError] of Object.entries(RPC_ERRORS)) {
    if (message.includes(databaseCode)) throw apiError;
  }
  throw error ?? new Error("paper_generation_failed");
}

function assertAttemptCanOpen(auth: CandidateAuthContext): void {
  if (auth.attemptStatus === "not_started") throw RPC_ERRORS.not_acknowledged;
  if (auth.attemptStatus === "submitted" || auth.attemptStatus === "finalized") {
    throw RPC_ERRORS.attempt_closed;
  }
}

function asOptions(value: QuestionRow["mcq_options"]): Array<{ id: string; text_html: string }> {
  return Array.isArray(value) ? value : [];
}

export async function loadCandidatePaper(
  auth: CandidateAuthContext,
  options: { supabase?: SupabaseClient; now?: Date } = {},
): Promise<PaperBody> {
  assertAttemptCanOpen(auth);
  const supabase = options.supabase ?? createServiceRoleClient();
  const now = options.now ?? new Date();

  const { data: examData, error: examError } = await supabase
    .from("exams")
    .select("id,status,navigation_mode,ends_at,force_ended_at")
    .eq("id", auth.examId)
    .single();
  if (examError) throw examError;
  const exam = examData as ExamRow;

  if (exam.status === "draft" || exam.status === "scheduled") {
    throw RPC_ERRORS.exam_not_live;
  }
  if (
    exam.status === "ended" ||
    exam.status === "finalized" ||
    exam.force_ended_at !== null
  ) {
    throw new ApiError("exam_closed", 409, "The exam has ended.");
  }
  const deadline = attemptDeadline(exam.ends_at, auth.extraMinutes ?? 0);
  if (
    examPhase(
      auth.attemptStatus,
      exam.status,
      exam.force_ended_at !== null,
      deadline,
      now,
    ) !== "live"
  ) {
    throw new ApiError("exam_closed", 409, "The exam has ended.");
  }

  const { data: assignmentData, error: rpcError } = await supabase.rpc(
    "generate_paper",
    { p_attempt_id: auth.attemptId },
  );
  if (rpcError) mapRpcError(rpcError);
  const assignments = (assignmentData ?? []) as AssignmentRow[];
  const visibleAssignments = exam.navigation_mode === "sequential"
    ? assignments.filter((row) => row.position === auth.currentPosition)
    : assignments;
  const visibleQuestionIds = visibleAssignments.map((row) => row.question_id);

  const questionRequest = supabase
    .from("questions")
    .select("id,type,body_html,image_path,image_alt_text,marks,mcq_options(id,text_html)")
    .in("id", visibleQuestionIds);
  const answerRequest = supabase
    .from("answers")
    .select("question_id,answer_text,selected_option_id,flagged,revision")
    .eq("attempt_id", auth.attemptId)
    .in("question_id", visibleQuestionIds);
  const [questionResult, answerResult] = await Promise.all([questionRequest, answerRequest]);
  if (questionResult.error) throw questionResult.error;
  if (answerResult.error) throw answerResult.error;

  const questionsById = new Map(
    ((questionResult.data ?? []) as QuestionRow[]).map((question) => [question.id, question]),
  );
  const questions = visibleAssignments.map((assignment): CandidateQuestion => {
    const question = questionsById.get(assignment.question_id);
    if (!question) throw new Error("paper_question_missing");
    const optionById = new Map(asOptions(question.mcq_options).map((option) => [option.id, option]));
    const orderedOptions = question.type === "mcq"
      ? (assignment.option_order ?? []).map((id) => {
          const option = optionById.get(id);
          if (!option) throw new Error("paper_option_missing");
          return { id: option.id, text_html: sanitizeOptionHtml(option.text_html) };
        })
      : undefined;
    return {
      id: question.id,
      position: assignment.position,
      type: question.type,
      body_html: sanitizeQuestionHtml(question.body_html),
      image: question.image_path && question.image_alt_text
        ? { url: `/api/question-images/${question.id}`, alt_text: question.image_alt_text }
        : null,
      marks: Number(question.marks),
      ...(orderedOptions ? { options: orderedOptions } : {}),
    };
  });

  const visibleIds = new Set(visibleQuestionIds);
  const answers = Object.fromEntries(
    ((answerResult.data ?? []) as AnswerRow[])
      .filter((answer) => visibleIds.has(answer.question_id))
      .map(({ question_id, answer_text, selected_option_id, flagged, revision }) => [
        question_id,
        { answer_text, selected_option_id, flagged, revision },
      ]),
  );

  return {
    server_time: now.toISOString(),
    navigation_mode: exam.navigation_mode,
    total_questions: assignments.length,
    current_position: exam.navigation_mode === "sequential" ? auth.currentPosition : null,
    questions,
    answers,
  };
}
