import { apiErrorResponse, jsonResponse } from "@/lib/api";
import { recordAdminAction } from "@/lib/admin-server";
import { requireAdmin } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/origin";
import { readQuestionJson, throwQuestionRpcError } from "@/lib/question-server";
import { reorderQuestionsSchema } from "@/lib/questions";
import { createServiceRoleClient } from "@/lib/supabase/server";

const ROUTE = "/api/admin/questions/reorder";

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const body = reorderQuestionsSchema.parse(await readQuestionJson(request));
    const client = createServiceRoleClient();
    const { data, error } = await client.rpc("reorder_questions", { p_exam_id: body.exam_id, p_ordered_ids: body.ordered_ids });
    if (error) throwQuestionRpcError(error);
    await recordAdminAction(client, admin, "question_reorder", body.exam_id, {
      exam_id: body.exam_id,
      question_count: body.ordered_ids.length,
    });
    return jsonResponse({ updated: Number(data ?? body.ordered_ids.length) });
  } catch (error) {
    return apiErrorResponse(error, ROUTE);
  }
}
