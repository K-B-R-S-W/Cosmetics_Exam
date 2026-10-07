import { z } from "zod";
import { ApiError, apiErrorResponse, jsonResponse, readJson } from "@/lib/api";
import { confirmSchema } from "@/lib/admin-controls";
import { recordAdminAction } from "@/lib/admin-server";
import { requireAdmin } from "@/lib/auth";
import { publishExamBroadcast } from "@/lib/broadcast-server";
import { assertSameOrigin } from "@/lib/origin";
import { createServiceRoleClient } from "@/lib/supabase/server";

const ROUTE = "/api/admin/attempts/[id]/force-submit";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const id = z.uuid().parse((await context.params).id);
    confirmSchema.parse(await readJson(request));
    const client = createServiceRoleClient();
    const { data: attempt, error: lookupError } = await client.from("attempts").select("id,exam_id").eq("id", id).maybeSingle();
    if (lookupError) throw new Error("force_submit_lookup_failed");
    if (!attempt) throw new ApiError("not_found", 404, "Attempt not found.");
    const { data, error } = await client.rpc("submit_attempt", { p_attempt_id: id, p_reason: "forced" });
    if (error) throw new Error("force_submit_failed");
    const submitted = data === true;
    if (submitted) {
      await recordAdminAction(client, admin, "force_submit", id, { exam_id: attempt.exam_id });
      await publishExamBroadcast(attempt.exam_id, { type: "attempt_changed", attempt_id: id });
    }
    return jsonResponse({ submitted });
  } catch (error) { return apiErrorResponse(error, ROUTE); }
}
