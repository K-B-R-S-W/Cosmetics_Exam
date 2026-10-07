import { ApiError, apiErrorResponse, jsonResponse } from "@/lib/api";
import { recordAdminAction } from "@/lib/admin-server";
import { requireAdmin } from "@/lib/auth";
import { publishExamBroadcast } from "@/lib/broadcast-server";
import { startExam } from "@/lib/exam-lifecycle";
import { examIdSchema } from "@/lib/exams";
import { assertSameOrigin } from "@/lib/origin";
import { createServiceRoleClient } from "@/lib/supabase/server";

const ROUTE = "/api/admin/exams/[id]/start";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const id = examIdSchema.parse((await context.params).id);
    const client = createServiceRoleClient();
    const result = await startExam(client, id, false);
    if (result.out_result === "not_found") throw new ApiError("not_found", 404, "Exam not found.");
    if (result.out_result === "not_ready") {
      const code = result.out_missing.includes("questions") ? "exam_has_no_questions" : "no_candidates_assigned";
      throw new ApiError(code, 409, code === "exam_has_no_questions" ? "Add at least one question first." : "Assign at least one candidate first.");
    }
    if (result.out_result === "invalid_status") {
      if (result.out_status === "live") {
        const { data, error } = await client.from("admin_actions").select("id").eq("action", "start").eq("target", id).limit(1);
        if (error) throw new Error("start_audit_lookup_failed");
        if ((data?.length ?? 0) > 0) return jsonResponse({ already_started: true, exam: { status: "live", started_at: result.out_started_at, ends_at: result.out_ends_at } });
      }
      throw new ApiError("invalid_status", 409, "The exam has already started or ended. Reload the page.");
    }
    if (result.out_result !== "started") throw new Error("start_exam_unexpected");
    await recordAdminAction(client, admin, "start", id, { started_at: result.out_started_at, ends_at: result.out_ends_at });
    await publishExamBroadcast(id, { type: "exam_started" });
    return jsonResponse({ already_started: false, exam: { status: "live", started_at: result.out_started_at, ends_at: result.out_ends_at } });
  } catch (error) { return apiErrorResponse(error, ROUTE); }
}
