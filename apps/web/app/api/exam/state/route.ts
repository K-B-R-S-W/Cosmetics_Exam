import { jsonResponse } from "@/lib/api";
import { candidateRoute } from "@/lib/candidate-api";
import { requireCandidate } from "@/lib/candidate-session";
import { buildStateBody } from "@/lib/exam-state";

export async function GET(): Promise<Response> {
  return candidateRoute("GET /api/exam/state", async (context) => {
    const auth = await requireCandidate();
    context.setCandidateId(auth.candidateId);
    return jsonResponse(await buildStateBody(auth));
  });
}
