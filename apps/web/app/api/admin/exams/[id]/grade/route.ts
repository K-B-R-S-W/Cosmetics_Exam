import { ApiError, apiErrorResponse, jsonResponse } from "@/lib/api";
import { recordAdminAction } from "@/lib/admin-server";
import { requireAdmin } from "@/lib/auth";
import { gradeStartSchema } from "@/lib/grading/contracts";
import { throwGradingRpcError } from "@/lib/grading/server";
import { assertSameOrigin } from "@/lib/origin";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { z } from "zod";

const ROUTE = "/api/admin/exams/[id]/grade";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    assertSameOrigin(request); const admin = await requireAdmin();
    const examId = z.uuid().parse((await context.params).id);
    const text = await request.text();
    let input: unknown = {};
    try { if (text) input = JSON.parse(text); } catch { throw new ApiError("validation_failed", 400, "Send a valid JSON body."); }
    const body = gradeStartSchema.parse(input);
    const client = createServiceRoleClient();
    const { data: keyRows, error: keyError } = await client.from("api_key_state").select("label,status").eq("status", "active");
    if (keyError) throw new Error("grading_key_lookup_failed");
    if (!keyRows?.length) throw new ApiError("no_grading_keys", 409, "No grading key is available.");
    const { data, error } = await client.rpc("start_grading", { p_exam_id: examId, p_started_by: admin.id, p_chunk_size: body.chunk_size, p_mcq_only: body.mcq_only });
    if (error) throwGradingRpcError(error);
    await recordAdminAction(client, admin, "grade_start", examId, { run_id: data.run_id, jobs: data.jobs, mcq_only: body.mcq_only });
    return jsonResponse({ ...data, quota_reminder: "Confirm current limits in AI Studio before grading." }, { status: 202 });
  } catch (error) { return apiErrorResponse(error, ROUTE); }
}
