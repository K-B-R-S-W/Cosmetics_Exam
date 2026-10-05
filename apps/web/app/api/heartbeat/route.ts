import { ApiError, jsonResponse } from "@/lib/api";
import { candidateRoute } from "@/lib/candidate-api";
import { requireCandidate } from "@/lib/candidate-session";
import { assertSameOrigin } from "@/lib/origin";
import { heartbeatInputSchema, normalizeHeartbeatState, rpcRow, throwHeartbeatResult } from "@/lib/proctoring-contract";
import { createServiceRoleClient } from "@/lib/supabase/server";

type HeartbeatRpcRow = { out_result: string; out_state: unknown };

export async function POST(request: Request): Promise<Response> {
  return candidateRoute("POST /api/heartbeat", async (context) => {
    assertSameOrigin(request);
    const auth = await requireCandidate();
    context.setCandidateId(auth.candidateId);
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 1024) throw new ApiError("payload_too_large", 413, "The request is too large.");
    let input: unknown = {};
    if (raw.trim()) {
      try { input = JSON.parse(raw) as unknown; }
      catch { throw new ApiError("validation_failed", 400, "Send a valid JSON body."); }
    }
    heartbeatInputSchema.parse(input);
    const { data, error } = await createServiceRoleClient().rpc("candidate_heartbeat", { p_session_id: auth.sessionId });
    if (error) throw new Error("candidate_heartbeat_failed");
    const row = rpcRow(data as HeartbeatRpcRow | HeartbeatRpcRow[] | null);
    if (!row) throw new Error("candidate_heartbeat_empty");
    if (row.out_result !== "ok") throwHeartbeatResult(row.out_result);
    return jsonResponse(normalizeHeartbeatState(row.out_state));
  });
}
