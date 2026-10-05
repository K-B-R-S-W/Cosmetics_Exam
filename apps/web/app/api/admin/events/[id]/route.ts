import { ApiError, apiErrorResponse, jsonResponse, readJson } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/origin";
import { dismissEventSchema, rpcRow } from "@/lib/proctoring-contract";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { z } from "zod";

const ROUTE = "/api/admin/events/[id]";
type DismissRow = { out_result: string; out_counts: boolean; out_violation_count: number };

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const id = z.string().uuid().parse((await context.params).id);
    const input = dismissEventSchema.parse(await readJson(request));
    const { data, error } = await createServiceRoleClient().rpc("dismiss_violation_event", {
      p_event_id: id, p_admin_id: admin.id, p_dismissed: input.dismissed, p_note: input.note,
    });
    if (error) throw new Error("dismiss_violation_event_failed");
    const row = rpcRow(data as DismissRow | DismissRow[] | null);
    if (!row) throw new Error("dismiss_violation_event_empty");
    if (row.out_result === "not_found") throw new ApiError("not_found", 404, "Incident not found.");
    if (row.out_result === "not_dismissable") throw new ApiError("not_dismissable", 409, "This incident cannot be dismissed.");
    if (row.out_result === "not_restorable") throw new ApiError("not_restorable", 409, "This incident cannot be restored.");
    if (row.out_result === "note_required") throw new ApiError("validation_failed", 400, "Add a review note.");
    if (row.out_result === "forbidden") throw new ApiError("forbidden", 403, "You don't have permission to do that.");
    if (row.out_result !== "updated") throw new Error("dismiss_violation_event_unexpected");
    return jsonResponse({ event: { id, counts: row.out_counts }, violation_count: row.out_violation_count });
  } catch (error) { return apiErrorResponse(error, ROUTE); }
}
