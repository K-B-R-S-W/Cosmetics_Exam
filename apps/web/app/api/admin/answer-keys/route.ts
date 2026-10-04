import { ApiError, apiErrorResponse, jsonResponse } from "@/lib/api";
import { recordAdminAction } from "@/lib/admin-server";
import { requireAdmin } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/origin";
import { readQuestionJson, throwQuestionRpcError } from "@/lib/question-server";
import { answerKeyMutationSchema, examIdQuerySchema } from "@/lib/questions";
import { createServiceRoleClient } from "@/lib/supabase/server";

const ROUTE = "/api/admin/answer-keys";

export async function GET(request: Request): Promise<Response> {
  try {
    await requireAdmin();
    const examId = examIdQuerySchema.safeParse(new URL(request.url).searchParams.get("exam_id"));
    if (!examId.success) throw new ApiError("validation_failed", 400, "Provide a valid exam_id.");
    const client = createServiceRoleClient();
    const { data, error } = await client
      .from("questions")
      .select("id, answer_keys(question_id, correct_option_id, model_answer, grading_notes, calibration)")
      .eq("exam_id", examId.data)
      .order("position");
    if (error) throw error;
    const items = (data ?? []).map((row) => {
      const relation = (row as { answer_keys?: unknown }).answer_keys;
      const key = Array.isArray(relation) ? relation[0] : relation;
      return key ?? {
        question_id: row.id,
        correct_option_id: null,
        model_answer: null,
        grading_notes: null,
        calibration: [],
      };
    });
    return jsonResponse({ items });
  } catch (error) {
    return apiErrorResponse(error, ROUTE);
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const body = answerKeyMutationSchema.parse(await readQuestionJson(request));
    const client = createServiceRoleClient();
    const { data: question, error: questionError } = await client
      .from("questions")
      .select("id, exam_id, type, marks, mcq_options(id)")
      .eq("id", body.question_id)
      .maybeSingle();
    if (questionError) throw questionError;
    if (!question) throw new ApiError("not_found", 404, "Question not found.");
    const options = ((question as { mcq_options?: Array<{ id: string }> }).mcq_options ?? []).map((option) => option.id);
    if (question.type === "mcq") {
      if (!body.correct_option_id || !options.includes(body.correct_option_id) || body.model_answer !== null || body.grading_notes !== null || body.calibration.length > 0) {
        throw new ApiError("validation_failed", 400, "Check the highlighted fields and try again.");
      }
    } else if (body.correct_option_id !== null) {
      throw new ApiError("validation_failed", 400, "Written questions cannot have a correct option.");
    }
    const maxMarks = Number(question.marks);
    if (body.calibration.some((example) => example.marks > maxMarks)) {
      throw new ApiError("validation_failed", 400, "Calibration marks cannot exceed the question marks.");
    }
    const { data, error } = await client.rpc("save_answer_key", {
      p_question_id: body.question_id,
      p_correct_option_id: body.correct_option_id,
      p_model_answer: body.model_answer,
      p_grading_notes: body.grading_notes,
      p_calibration: body.calibration,
    });
    if (error) throwQuestionRpcError(error);
    const regradeNeeded = data === true;
    await recordAdminAction(client, admin, "answer_key_save", body.question_id, {
      exam_id: question.exam_id,
      question_id: body.question_id,
      calibration_count: body.calibration.length,
    });
    return jsonResponse({
      answer_key: body,
      regrade_needed: regradeNeeded,
    });
  } catch (error) {
    return apiErrorResponse(error, ROUTE);
  }
}
