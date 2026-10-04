import { ApiError, apiErrorResponse, jsonResponse } from "@/lib/api";
import { recordAdminAction } from "@/lib/admin-server";
import { requireAdmin } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/origin";
import {
  addPreviewUrls,
  loadQuestion,
  readQuestionJson,
  removeQuestionImageWithRetry,
  saveQuestionArgs,
  throwQuestionRpcError,
  verifyQuestionImage,
} from "@/lib/question-server";
import { createQuestionSchema, questionIdSchema, sanitizeCompleteQuestion, updateQuestionSchema } from "@/lib/questions";
import { createServiceRoleClient } from "@/lib/supabase/server";

const ROUTE = "/api/admin/questions/[id]";
interface RouteContext { params: Promise<{ id: string }> }

async function routeId(context: RouteContext): Promise<string> {
  const parsed = questionIdSchema.safeParse((await context.params).id);
  if (!parsed.success) throw new ApiError("not_found", 404, "Question not found.");
  return parsed.data;
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const id = await routeId(context);
    const patch = updateQuestionSchema.parse(await readQuestionJson(request));
    const client = createServiceRoleClient();
    const current = await loadQuestion(client, id);
    if (patch.type && patch.type !== current.type) {
      throw new ApiError("type_immutable", 400, "Delete and recreate the question to change its type.");
    }
    const document = sanitizeCompleteQuestion(createQuestionSchema.parse({
      ...current,
      ...patch,
      id: current.id,
      exam_id: current.exam_id,
      type: current.type,
      position: current.position,
      image: patch.image === undefined ? current.image : patch.image,
      options: patch.options ?? current.options.map(({ id: optionId, text_html }) => ({ id: optionId, text_html })),
      answer_key: patch.answer_key ?? current.answer_key,
    }));
    if (document.image?.path !== current.image?.path) {
      await verifyQuestionImage(client, document.image, id);
    }
    const { error } = await client.rpc("save_question", saveQuestionArgs(document));
    if (error) throwQuestionRpcError(error);
    if (current.image?.path && current.image.path !== document.image?.path) {
      await removeQuestionImageWithRetry(client, current.image.path, admin.id);
    }
    await recordAdminAction(client, admin, "question_save", id, {
      exam_id: document.exam_id,
      question_id: id,
      option_count: document.options.length,
    });
    const [question] = await addPreviewUrls(client, [await loadQuestion(client, id)]);
    return jsonResponse({ question });
  } catch (error) {
    return apiErrorResponse(error, ROUTE);
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const id = await routeId(context);
    const client = createServiceRoleClient();
    const current = await loadQuestion(client, id);
    const { error } = await client.rpc("delete_question", { p_exam_id: current.exam_id, p_question_id: id });
    if (error) throwQuestionRpcError(error);
    if (current.image?.path) await removeQuestionImageWithRetry(client, current.image.path, admin.id);
    await recordAdminAction(client, admin, "question_delete", id, {
      exam_id: current.exam_id,
      question_id: id,
      option_count: current.options.length,
    });
    return jsonResponse({ deleted: true });
  } catch (error) {
    return apiErrorResponse(error, ROUTE);
  }
}
