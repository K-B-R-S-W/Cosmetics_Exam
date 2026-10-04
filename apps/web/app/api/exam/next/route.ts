import { jsonResponse } from "@/lib/api";
import { nextInputSchema } from "@/lib/candidate-answers";
import { candidateRoute, readCandidateJson } from "@/lib/candidate-api";
import { advanceCandidatePosition } from "@/lib/candidate-next";
import { requireCandidate } from "@/lib/candidate-session";
import { assertSameOrigin } from "@/lib/origin";

export async function POST(request: Request): Promise<Response> {
  return candidateRoute("POST /api/exam/next", async (context) => {
    assertSameOrigin(request);
    const auth = await requireCandidate();
    context.setCandidateId(auth.candidateId);
    const input = nextInputSchema.parse(await readCandidateJson(request, 96 * 1024));
    return jsonResponse(await advanceCandidatePosition(auth, input));
  });
}
