import { jsonResponse } from "@/lib/api";
import { answerInputSchema, publicSaveResult, saveCandidateAnswer } from "@/lib/candidate-answers";
import { candidateRoute, readCandidateJson } from "@/lib/candidate-api";
import { requireCandidate } from "@/lib/candidate-session";
import { assertSameOrigin } from "@/lib/origin";
import { createServiceRoleClient } from "@/lib/supabase/server";

export async function POST(request: Request): Promise<Response> {
  return candidateRoute("POST /api/answers", async (context) => {
    assertSameOrigin(request);
    const auth = await requireCandidate();
    context.setCandidateId(auth.candidateId);
    const input = answerInputSchema.parse(await readCandidateJson(request, 24 * 1024));
    const outcome = await saveCandidateAnswer(createServiceRoleClient(), auth.attemptId, input);
    return jsonResponse(publicSaveResult(outcome));
  });
}
