import { ApiError, apiErrorResponse, jsonResponse } from "@/lib/api";
import { recordAdminAction } from "@/lib/admin-server";
import { requireAdmin } from "@/lib/auth";
import { resumeRunSchema } from "@/lib/grading/contracts";
import { throwGradingRpcError } from "@/lib/grading/server";
import { assertSameOrigin } from "@/lib/origin";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { z } from "zod";

const ROUTE = "/api/admin/grading/[run]/resume";
export async function POST(request: Request, context: { params: Promise<{ run: string }> }): Promise<Response> {
  try {
    assertSameOrigin(request); const admin = await requireAdmin(); const runId = z.uuid().parse((await context.params).run);
    const text = await request.text(); let input: unknown = {};
    try { if (text) input = JSON.parse(text); } catch { throw new ApiError("validation_failed", 400, "Send a valid JSON body."); }
    const body = resumeRunSchema.parse(input);
    const client = createServiceRoleClient(); const { data, error } = await client.rpc("resume_grading_run", { p_run_id: runId, p_failed_only: body.failed_only });
    if (error) throwGradingRpcError(error); await recordAdminAction(client, admin, "grade_resume", runId, { requeued_jobs: data.requeued_jobs, failed_only: body.failed_only }); return jsonResponse(data);
  } catch (error) { return apiErrorResponse(error, ROUTE); }
}
