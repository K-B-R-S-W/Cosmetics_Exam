import { ApiError, apiErrorResponse, jsonResponse, readJson } from "@/lib/api";
import { broadcastSchema, uniqueIds } from "@/lib/admin-controls";
import { recordAdminAction } from "@/lib/admin-server";
import { requireAdmin } from "@/lib/auth";
import { publishExamBroadcast } from "@/lib/broadcast-server";
import { examIdSchema } from "@/lib/exams";
import { assertSameOrigin } from "@/lib/origin";
import { createServiceRoleClient } from "@/lib/supabase/server";

const ROUTE = "/api/admin/exams/[id]/broadcast";
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context): Promise<Response> {
  try {
    await requireAdmin();
    const id = examIdSchema.parse((await context.params).id);
    const { data, error } = await createServiceRoleClient().from("broadcasts").select("id,message,audience,sent_at,broadcast_recipients(count)").eq("exam_id", id).order("sent_at", { ascending: false });
    if (error) throw new Error("broadcast_history_failed");
    return jsonResponse({ items: (data ?? []).map((row) => ({ id: row.id, message: row.message, audience: row.audience, sent_at: row.sent_at, recipient_count: Array.isArray(row.broadcast_recipients) ? Number(row.broadcast_recipients[0]?.count ?? 0) : 0 })) });
  } catch (error) { return apiErrorResponse(error, ROUTE); }
}

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const id = examIdSchema.parse((await context.params).id);
    const input = broadcastSchema.parse(await readJson(request));
    const candidateIds = uniqueIds(input.candidate_ids);
    const client = createServiceRoleClient();
    const { data, error } = await client.rpc("create_broadcast", { p_exam_id: id, p_message: input.message, p_audience: input.audience, p_candidate_ids: candidateIds });
    if (error) {
      const code = error.message;
      if (code.includes("no_recipients")) throw new ApiError("no_recipients", 400, "Select at least one candidate.");
      if (code.includes("invalid_recipient")) throw new ApiError("invalid_recipient", 409, "One or more selected candidates are no longer assigned to this exam. Refresh and try again.");
      if (code.includes("exam_not_found")) throw new ApiError("not_found", 404, "Exam not found.");
      throw new ApiError("validation_failed", 400, "Check the message and recipients.");
    }
    const row = (Array.isArray(data) ? data[0] : data) as { out_broadcast_id: string; out_recipient_count: number } | undefined;
    if (!row) throw new Error("create_broadcast_empty");
    await recordAdminAction(client, admin, "broadcast", id, { audience: input.audience, recipient_count: row.out_recipient_count, candidate_ids: input.audience === "custom" ? candidateIds : null });
    await publishExamBroadcast(id, { type: "message" });
    return jsonResponse({ id: row.out_broadcast_id, recipient_count: row.out_recipient_count });
  } catch (error) { return apiErrorResponse(error, ROUTE); }
}
