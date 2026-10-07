import { z } from "zod";
import { ApiError, apiErrorResponse, jsonResponse } from "@/lib/api";
import { recordAdminAction } from "@/lib/admin-server";
import { requireAdmin } from "@/lib/auth";
import { publishExamBroadcast } from "@/lib/broadcast-server";
import { removeCandidateParticipant } from "@/lib/livekit-server";
import { assertSameOrigin } from "@/lib/origin";
import { createServiceRoleClient } from "@/lib/supabase/server";

const ROUTE = "/api/admin/attempts/[id]/kick";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const id = z.uuid().parse((await context.params).id);
    const client = createServiceRoleClient();
    const { data: attempt, error: lookupError } = await client.from("attempts").select("id,exam_id,candidate_id").eq("id", id).maybeSingle();
    if (lookupError) throw new Error("kick_lookup_failed");
    if (!attempt) throw new ApiError("not_found", 404, "Attempt not found.");
    const revokedAt = new Date().toISOString();
    const { data: revoked, error: revokeError } = await client.from("sessions").update({ revoked_at: revokedAt }).eq("candidate_id", attempt.candidate_id).is("revoked_at", null).select("id");
    if (revokeError) throw new Error("kick_revoke_failed");
    const livekitRemoved = await removeCandidateParticipant(attempt.exam_id, id);
    await recordAdminAction(client, admin, "kick", id, { exam_id: attempt.exam_id, revoked_sessions: revoked?.length ?? 0, livekit_removed: livekitRemoved });
    await publishExamBroadcast(attempt.exam_id, { type: "attempt_changed", attempt_id: id });
    return jsonResponse({ revoked_sessions: revoked?.length ?? 0, livekit_removed: livekitRemoved });
  } catch (error) { return apiErrorResponse(error, ROUTE); }
}
