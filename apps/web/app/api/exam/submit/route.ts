import { jsonResponse } from "@/lib/api";
import { submitInputSchema } from "@/lib/candidate-answers";
import { candidateRoute, readCandidateJson } from "@/lib/candidate-api";
import { requireCandidate } from "@/lib/candidate-session";
import { submitCandidateAttempt } from "@/lib/candidate-submit";
import { assertSameOrigin } from "@/lib/origin";

export async function POST(request: Request): Promise<Response> {
  return candidateRoute("POST /api/exam/submit", async (context) => {
    assertSameOrigin(request);
    const auth = await requireCandidate();
    context.setCandidateId(auth.candidateId);
    const input = submitInputSchema.parse(await readCandidateJson(request, 4 * 1024 * 1024));
    return jsonResponse(await submitCandidateAttempt(auth, input));
  });
}
