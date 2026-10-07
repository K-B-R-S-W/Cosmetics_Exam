import { z } from "zod";

import { jsonResponse } from "@/lib/api";
import { candidateRoute, readCandidateJson } from "@/lib/candidate-api";
import { requireCandidate } from "@/lib/candidate-session";
import { assertSameOrigin } from "@/lib/origin";
import { rpcRow } from "@/lib/proctoring-contract";
import { createServiceRoleClient } from "@/lib/supabase/server";

const idSchema = z.uuid();
const claimSchema = z.strictObject({
  claim_token: z.uuid().refine((value) => value[14] === "4", "Use a UUID v4 claim token."),
});
type ClaimRow = { out_display: boolean; out_message: string | null; out_sent_at: string | null };

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return candidateRoute("POST /api/exam/announcements/[id]/claim", async (routeContext) => {
    assertSameOrigin(request);
    const auth = await requireCandidate();
    routeContext.setCandidateId(auth.candidateId);
    const id = idSchema.parse((await context.params).id);
    const input = claimSchema.parse(await readCandidateJson(request));
    const { data, error } = await createServiceRoleClient().rpc("claim_broadcast", {
      p_broadcast_id: id,
      p_candidate_id: auth.candidateId,
      p_claim_token: input.claim_token,
    });
    if (error) throw new Error("claim_broadcast_failed");
    const row = rpcRow(data as ClaimRow | ClaimRow[] | null);
    if (!row) throw new Error("claim_broadcast_empty");
    if (!row.out_display) return jsonResponse({ display: false });
    if (row.out_message === null || row.out_sent_at === null) throw new Error("claim_broadcast_invalid");
    return jsonResponse({
      display: true,
      announcement: { id, message: row.out_message, sent_at: new Date(row.out_sent_at).toISOString() },
    });
  });
}
