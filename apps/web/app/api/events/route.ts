import { ApiError, jsonResponse } from "@/lib/api";
import { candidateRoute, readCandidateJson } from "@/lib/candidate-api";
import { requireCandidate } from "@/lib/candidate-session";
import { assertSameOrigin } from "@/lib/origin";
import { candidateEventSchema, rpcRow } from "@/lib/proctoring-contract";
import { createServiceRoleClient } from "@/lib/supabase/server";

const MAX_REQUEST_BYTES = 200 * 1024;
const MAX_SNAPSHOT_BYTES = 100 * 1024;

type EventRpcRow = { out_result: string; out_event_id: string; out_counts: boolean; out_snapshot_path: string | null };

function snapshotBytes(value: string | null | undefined): Uint8Array | null {
  if (!value) return null;
  let bytes: Buffer;
  try { bytes = Buffer.from(value, "base64"); } catch { throw new ApiError("validation_failed", 400, "Send a valid JPEG snapshot."); }
  if (bytes.length === 0 || bytes.length > MAX_SNAPSHOT_BYTES || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) {
    throw new ApiError("validation_failed", 400, "Send a valid JPEG snapshot.");
  }
  return bytes;
}

export async function POST(request: Request): Promise<Response> {
  return candidateRoute("POST /api/events", async (context) => {
    assertSameOrigin(request);
    const auth = await requireCandidate();
    context.setCandidateId(auth.candidateId);
    const input = candidateEventSchema.parse(await readCandidateJson(request, MAX_REQUEST_BYTES));
    const snapshot = snapshotBytes(input.snapshot_jpeg_base64);
    const client = createServiceRoleClient();
    const { data, error } = await client.rpc("record_candidate_event", {
      p_session_id: auth.sessionId,
      p_event_id: input.id,
      p_type: input.type,
      p_merged_types: input.merged_types,
      p_occurred_ago_ms: input.occurred_ago_ms,
      p_duration_ms: input.duration_ms,
      p_meta: input.meta,
      p_snapshot_requested: snapshot !== null,
    });
    if (error) throw new Error("record_candidate_event_failed");
    const row = rpcRow(data as EventRpcRow | EventRpcRow[] | null);
    if (!row) throw new Error("record_candidate_event_empty");
    if (row.out_result === "unauthenticated") throw new ApiError("unauthenticated", 401, "Please sign in to continue.");
    if (row.out_result === "session_revoked") throw new ApiError("session_revoked", 401, "This session is no longer active.");
    if (row.out_result === "invalid_type" || row.out_result === "validation_failed") throw new ApiError("validation_failed", 400, "Check the event and try again.");
    if (row.out_result === "rate_limited") throw new ApiError("rate_limited", 429, "Too many events. Try again shortly.");
    if (row.out_result === "ignored") return jsonResponse({ ignored: true });
    if (row.out_result === "duplicate") return jsonResponse({ id: input.id, duplicate: true, snapshot_saved: false });
    if (row.out_result !== "inserted") throw new Error("record_candidate_event_unexpected");

    let snapshotSaved = false;
    if (snapshot && row.out_snapshot_path) {
      const { error: uploadError } = await client.storage.from("snapshots").upload(row.out_snapshot_path, snapshot, {
        contentType: "image/jpeg", upsert: false,
      });
      snapshotSaved = !uploadError || uploadError.message.toLowerCase().includes("already exists");
      if (!snapshotSaved) await client.rpc("mark_violation_snapshot_failed", { p_event_id: input.id });
    }
    return jsonResponse({ id: input.id, snapshot_saved: snapshotSaved });
  });
}
