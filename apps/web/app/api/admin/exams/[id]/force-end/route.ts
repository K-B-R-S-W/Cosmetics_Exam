import { ApiError, apiErrorResponse, jsonResponse, readJson } from "@/lib/api";
import { confirmSchema } from "@/lib/admin-controls";
import { recordAdminAction } from "@/lib/admin-server";
import { requireAdmin } from "@/lib/auth";
import { publishExamBroadcast } from "@/lib/broadcast-server";
import { examIdSchema } from "@/lib/exams";
import { assertSameOrigin } from "@/lib/origin";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const maxDuration = 30;
const ROUTE = "/api/admin/exams/[id]/force-end";
type Row = { out_result: string; out_status: string | null; out_ends_at: string | null; out_force_ended_at: string | null; out_collection_deadline: string | null; out_collecting: number; out_already_submitted: number };

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const id = examIdSchema.parse((await context.params).id);
    confirmSchema.parse(await readJson(request));
    const client = createServiceRoleClient();
    const { data, error } = await client.rpc("force_end_exam", { p_exam_id: id });
    if (error) throw new Error("force_end_exam_failed");
    const row = (Array.isArray(data) ? data[0] : data) as Row | undefined;
    if (!row) throw new Error("force_end_exam_empty");
    if (row.out_result === "not_found") throw new ApiError("not_found", 404, "Exam not found.");
    if (row.out_result === "invalid_status") throw new ApiError("invalid_status", 409, "Only a live exam can be ended.");
    const body = { exam: { status: row.out_status, ends_at: row.out_ends_at, force_ended_at: row.out_force_ended_at }, collection_deadline: row.out_collection_deadline, collecting: row.out_collecting, already_submitted: row.out_already_submitted };
    if (row.out_result === "already_ended") {
      const { data: actions, error: lookupError } = await client.from("admin_actions").select("id").eq("action", "force_end").eq("target", id).limit(1);
      if (lookupError) throw new Error("force_end_audit_lookup_failed");
      if ((actions?.length ?? 0) === 0) {
        await recordAdminAction(client, admin, "force_end", id, { collecting: row.out_collecting, already_submitted: row.out_already_submitted });
        await publishExamBroadcast(id, { type: "exam_ended" });
      }
      return jsonResponse({ ...body, already_ended: true });
    }
    if (row.out_result !== "ended") throw new Error("force_end_exam_unexpected");
    await recordAdminAction(client, admin, "force_end", id, { collecting: row.out_collecting, already_submitted: row.out_already_submitted });
    await publishExamBroadcast(id, { type: "exam_ended" });
    return jsonResponse({ ...body, already_ended: false }, { status: 202 });
  } catch (error) { return apiErrorResponse(error, ROUTE); }
}
