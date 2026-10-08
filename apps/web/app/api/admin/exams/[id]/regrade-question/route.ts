import { apiErrorResponse, jsonResponse, readJson } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { questionRegradeSchema } from "@/lib/grading/contracts";
import { throwGradingRpcError } from "@/lib/grading/server";
import { assertSameOrigin } from "@/lib/origin";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { z } from "zod";

const ROUTE = "/api/admin/exams/[id]/regrade-question";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    assertSameOrigin(request); const admin = await requireAdmin(); const examId = z.uuid().parse((await context.params).id);
    const body = questionRegradeSchema.parse(await readJson(request)); const client = createServiceRoleClient();
    const { data, error } = await client.rpc("start_question_regrade", { p_exam_id: examId, p_question_id: body.question_id, p_admin_id: admin.id });
    if (error) throwGradingRpcError(error); return jsonResponse(data, { status: 202 });
  } catch (error) { return apiErrorResponse(error, ROUTE); }
}
