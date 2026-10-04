import { ApiError, apiErrorResponse, jsonResponse } from "@/lib/api";
import { recordAdminAction } from "@/lib/admin-server";
import { requireAdmin } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/origin";
import {
  QUESTION_COLUMNS,
  addPreviewUrl,
  loadQuestion,
  readQuestionJson,
  saveQuestionArgs,
  throwQuestionRpcError,
  toQuestionItem,
  verifyQuestionImage,
} from "@/lib/question-server";
import { createQuestionSchema, examIdQuerySchema, sanitizeCompleteQuestion } from "@/lib/questions";
import { createServiceRoleClient } from "@/lib/supabase/server";

const ROUTE = "/api/admin/questions";

export async function GET(request: Request): Promise<Response> {
  try {
    await requireAdmin();
    const examId = examIdQuerySchema.safeParse(new URL(request.url).searchParams.get("exam_id"));
    if (!examId.success) throw new ApiError("validation_failed", 400, "Provide a valid exam_id.");
    const client = createServiceRoleClient();
    const { data, error } = await client.from("questions").select(QUESTION_COLUMNS).eq("exam_id", examId.data).order("position");
    if (error) throw error;
    const items = await Promise.all((data ?? []).map((row) => addPreviewUrl(client, toQuestionItem(row as never))));
    return jsonResponse({ items });
  } catch (error) {
    return apiErrorResponse(error, ROUTE);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const document = sanitizeCompleteQuestion(createQuestionSchema.parse(await readQuestionJson(request)));
    const client = createServiceRoleClient();
    await verifyQuestionImage(client, document.image, document.id);
    const { error } = await client.rpc("save_question", saveQuestionArgs(document));
    if (error) throwQuestionRpcError(error);
    await recordAdminAction(client, admin, "question_save", document.id, {
      exam_id: document.exam_id,
      question_id: document.id,
      option_count: document.options.length,
    });
    const question = await addPreviewUrl(client, await loadQuestion(client, document.id));
    return jsonResponse({ question }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, ROUTE);
  }
}
