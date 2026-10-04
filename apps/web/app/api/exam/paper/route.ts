import { jsonResponse } from "@/lib/api";
import { candidateRoute } from "@/lib/candidate-api";
import { loadCandidatePaper } from "@/lib/candidate-paper";
import { requireCandidate } from "@/lib/candidate-session";

export async function GET(): Promise<Response> {
  return candidateRoute("GET /api/exam/paper", async (context) => {
    const auth = await requireCandidate();
    context.setCandidateId(auth.candidateId);
    return jsonResponse(await loadCandidatePaper(auth));
  });
}
